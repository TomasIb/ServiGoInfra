# ServiGo Infrastructure — Security Test Plan

> Full test coverage for the security hardening implemented in `ServiGoInfra` and `ServiGoWebApp`.
> All tests are read-only or use the Firebase Emulator / MercadoPago Sandbox — no production data is touched.

---

## Prerequisites

```bash
# Start Firebase Emulator (from ServiGoInfra/)
cd ServiGoInfra
npm run serve   # runs: firebase emulators:start

# Emulator ports:
#   Firestore:  8080
#   Functions:  5001
#   Auth:       9099
#   Storage:    9199
#   Emulator UI: 4000
```

Set these in your shell before running curl tests:
```bash
export PROJECT_ID="pruebaapp-11b43"
export FUNCTIONS_BASE="http://127.0.0.1:5001/${PROJECT_ID}/us-central1"
export FIRESTORE_BASE="http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents"
```

---

## T1 — Firestore Security Rules

### T1.1 — Unauthenticated users cannot read users collection
```bash
# Expect: HTTP 403
curl -s "${FIRESTORE_BASE}/users" | jq '.error.status'
# Expected: "PERMISSION_DENIED"
```

### T1.2 — Unauthenticated users cannot read configurations collection
```bash
# Expect: HTTP 403
curl -s "${FIRESTORE_BASE}/configurations/app" | jq '.error.status'
# Expected: "PERMISSION_DENIED"
```

### T1.3 — Unauthenticated users CAN read services (public marketplace)
```bash
# Expect: HTTP 200
curl -s "${FIRESTORE_BASE}/services" | jq '.documents | length'
# Expected: number >= 0 (no error)
```

### T1.4 — Authenticated client cannot read another user's bookings
```js
// In browser console or test script (logged in as client A):
const { getDocs, collection, query, where } = await import('firebase/firestore')
// Attempt to read booking that belongs to a different clientId
const snap = await getDoc(doc(db, 'bookings', 'BOOKING_BELONGING_TO_ANOTHER_USER'))
// Expected: throws FirebaseError: [permission-denied]
```

### T1.5 — Client cannot skip booking state machine (pending → completed)
```js
// Logged in as client, booking in 'pending_confirmation' state:
await updateDoc(doc(db, 'bookings', bookingId), { status: 'completed' })
// Expected: FirebaseError: [permission-denied]
```

### T1.6 — Client cannot modify booking immutable fields
```js
// Logged in as the booking's client:
await updateDoc(doc(db, 'bookings', bookingId), { totalPrice: 1 })
// Expected: FirebaseError: [permission-denied]
```

### T1.7 — Non-admin cannot set service moderationStatus
```js
// Logged in as provider (owner of service):
await updateDoc(doc(db, 'services', serviceId), { moderationStatus: 'approved' })
// Expected: FirebaseError: [permission-denied]
```

### T1.8 — Any authenticated user can read services
```js
// Logged in as any role:
const snap = await getDocs(collection(db, 'services'))
// Expected: success, documents returned
```

### T1.9 — Provider cannot create service as a different provider
```js
// Logged in as providerA:
await addDoc(collection(db, 'services'), {
  ...serviceData,
  providerId: 'PROVIDER_B_UID'  // different UID
})
// Expected: FirebaseError: [permission-denied]
```

### T1.10 — Unauthenticated user cannot create a booking
```js
// Not logged in (signOut first):
await addDoc(collection(db, 'bookings'), { clientId: 'attacker', ... })
// Expected: FirebaseError: [permission-denied]
```

### T1.11 — Valid provider state transition: pending → confirmed
```js
// Logged in as the booking's provider, booking in 'pending_confirmation':
await updateDoc(doc(db, 'bookings', bookingId), { status: 'confirmed' })
// Expected: success
```

### T1.12 — Provider cannot confirm another provider's booking
```js
// Logged in as providerB, booking belongs to providerA:
await updateDoc(doc(db, 'bookings', bookingId), { status: 'confirmed' })
// Expected: FirebaseError: [permission-denied]
```

---

## T2 — Cloud Functions: CORS

### T2.1 — Webhook rejects requests from disallowed origin
```bash
# Expect: CORS error (no Access-Control-Allow-Origin header matching evil.com)
curl -s -I -X OPTIONS \
  -H "Origin: https://evil.com" \
  -H "Access-Control-Request-Method: POST" \
  "${FUNCTIONS_BASE}/webhookMercadoPago"
# Expected: no 'Access-Control-Allow-Origin: https://evil.com' in response
```

### T2.2 — Webhook accepts allowed origin
```bash
curl -s -I -X OPTIONS \
  -H "Origin: https://servigo.cl" \
  -H "Access-Control-Request-Method: POST" \
  "${FUNCTIONS_BASE}/webhookMercadoPago"
# Expected: Access-Control-Allow-Origin: https://servigo.cl
```

### T2.3 — Function accepts localhost (dev)
```bash
curl -s -I -X OPTIONS \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: POST" \
  "${FUNCTIONS_BASE}/webhookMercadoPago"
# Expected: Access-Control-Allow-Origin: http://localhost:5173
```

---

## T3 — Webhook Signature Verification

### T3.1 — Webhook without x-signature header returns 403
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${FUNCTIONS_BASE}/webhookMercadoPago" \
  -H "Content-Type: application/json" \
  -H "Origin: https://servigo.cl" \
  -d '{"type":"payment","data":{"id":"12345"}}'
# Expected: 403
```

### T3.2 — Webhook with invalid signature returns 403
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "${FUNCTIONS_BASE}/webhookMercadoPago" \
  -H "Content-Type: application/json" \
  -H "Origin: https://servigo.cl" \
  -H "x-signature: ts=1234567890;v1=invalidsignature" \
  -H "x-request-id: test-request-id" \
  -d '{"type":"payment","data":{"id":"12345"}}'
# Expected: 403
```

### T3.3 — Webhook with valid signature processes normally
```bash
# Generate valid signature (Node.js):
node -e "
  const crypto = require('crypto');
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const ts = Date.now();
  const dataId = '12345';
  const reqId = 'test-id';
  const manifest = \`id:\${dataId};request-id:\${reqId};ts:\${ts};\`;
  const sig = crypto.createHmac('sha256', secret).update(manifest).digest('hex');
  console.log('ts=' + ts + ';v1=' + sig);
"
# Use that output as x-signature header — expect 200
```

---

## T4 — Payment Amount Server-Side Verification

### T4.1 — createPreference ignores client-provided amount
```js
// Logged in as the booking's client. Booking has totalPrice: 50000 in Firestore.
const createPref = httpsCallable(functions, 'createPreference')
const result = await createPref({
  bookingId: 'BOOKING_ID',
  serviceId: 'SERVICE_ID',
  amount: 100,          // attacker tries to pay 100 CLP instead of 50000
  webAppUrl: 'http://localhost:5173'
})
// Expected: success, but the MP preference is created for 50000 (from Firestore)
// Verify: check the preference in MP sandbox — amount should be 50000
```

### T4.2 — createPreference rejects non-owner client
```js
// Logged in as clientB (not the booking's client):
const createPref = httpsCallable(functions, 'createPreference')
await createPref({ bookingId: 'BOOKING_BELONGING_TO_CLIENT_A', serviceId: '...' })
// Expected: FirebaseError: [permission-denied]
```

### T4.3 — processPayment ignores client amount
```js
// Logged in as booking's client. Booking totalPrice: 50000.
const processPayment = httpsCallable(functions, 'processPayment')
await processPayment({
  bookingId: 'BOOKING_ID',
  token: 'TEST_CARD_TOKEN',
  payment_method_id: 'visa',
  installments: 1,
  amount: 1,            // attacker injects 1 CLP
  email: 'test@test.com'
})
// Expected: payment processed for 50000 CLP (from Firestore), not 1
```

---

## T5 — OAuth Callback Authorization (Nonce)

### T5.1 — OAuth callback rejects invalid nonce
```bash
curl -s -o /dev/null -w "%{http_code}" \
  "${FUNCTIONS_BASE}/oauthMercadoPago?code=testcode&state=FAKE_NONCE"
# Expected: 403
```

### T5.2 — OAuth callback rejects expired nonce
```js
// Manually insert a nonce with expiresAt = 1 minute ago in Firestore emulator:
await setDoc(doc(db, 'oauth_states', 'expired-nonce'), {
  providerId: 'some-uid',
  expiresAt: Timestamp.fromMillis(Date.now() - 60000),
  createdAt: serverTimestamp()
})
// Then call the callback with that nonce:
// Expected: 403
```

### T5.3 — initiateMpOAuth requires authentication
```js
// Not logged in:
const initiate = httpsCallable(functions, 'initiateMpOAuth')
await initiate({})
// Expected: FirebaseError: [unauthenticated]
```

### T5.4 — Valid nonce is consumed after one use
```js
// 1. Generate a nonce via initiateMpOAuth (logged in as provider)
// 2. Call the OAuth callback once — succeeds
// 3. Call the OAuth callback again with the same nonce
// Expected on step 3: 403 (nonce already deleted)
```

---

## T6 — Role & Custom Claims

### T6.1 — New user gets 'client' custom claim on creation
```js
// Create a new user via signUp:
const result = await createUserWithEmailAndPassword(auth, 'newuser@test.com', 'pass123')
// Wait a moment for the onCreate Cloud Function to run
await new Promise(r => setTimeout(r, 2000))
const tokenResult = await result.user.getIdTokenResult(true) // force refresh
console.log(tokenResult.claims.role)
// Expected: 'client'
```

### T6.2 — setUserRole requires admin role
```js
// Logged in as regular client:
const setRole = httpsCallable(functions, 'setUserRole')
await setRole({ uid: 'some-uid', role: 'admin' })
// Expected: FirebaseError: [permission-denied]
```

### T6.3 — setUserRole rejects invalid role values
```js
// Logged in as admin:
const setRole = httpsCallable(functions, 'setUserRole')
await setRole({ uid: 'some-uid', role: 'superuser' })
// Expected: FirebaseError: [invalid-argument]
```

### T6.4 — Frontend reads role from custom claims, not Firestore
```js
// Manually update Firestore users/{uid}.role = 'admin' for a client user
// without calling setUserRole (no custom claim change)
await updateDoc(doc(db, 'users', uid), { role: 'admin' })
// Re-read AuthContext user state:
// Expected: user.role still = 'client' (from claims, not Firestore)
// Navigate to /admin/dashboard:
// Expected: redirected away (ProtectedRoute checks role from AuthContext)
```

---

## T7 — Admin Access Controls

### T7.1 — recalculateAllRatings requires admin
```js
// Logged in as regular client:
const recalc = httpsCallable(functions, 'recalculateAllRatings')
await recalc({})
// Expected: FirebaseError: [permission-denied]
```

### T7.2 — updateBookingStatus rejects invalid status values
```js
// Logged in as booking's provider:
const update = httpsCallable(functions, 'updateBookingStatus')
await update({ bookingId: 'BOOKING_ID', newStatus: 'hacked' })
// Expected: FirebaseError: [invalid-argument] "Estado inválido: hacked"
```

### T7.3 — updateBookingStatus rejects unauthenticated calls
```bash
curl -s -X POST \
  "${FUNCTIONS_BASE}/updateBookingStatus" \
  -H "Content-Type: application/json" \
  -d '{"data":{"bookingId":"X","newStatus":"completed"}}'
# Expected: {"error":{"status":"UNAUTHENTICATED",...}}
```

---

## T8 — Storage Rules

### T8.1 — Unauthenticated upload rejected
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST "http://127.0.0.1:9199/v0/b/${PROJECT_ID}.appspot.com/o?name=services%2FsomeUid%2Ftest.jpg" \
  --data-binary @test.jpg \
  -H "Content-Type: image/jpeg"
# Expected: 403
```

### T8.2 — Provider cannot upload to another user's path
```js
// Logged in as providerA:
const fileRef = ref(storage, `services/PROVIDER_B_UID/image.jpg`)
await uploadBytes(fileRef, file)
// Expected: FirebaseError: [permission-denied]
```

### T8.3 — File size limit enforced (services folder)
```js
// Logged in as provider, uploading a 6 MB file to their own path:
const bigFile = new File([new ArrayBuffer(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' })
const fileRef = ref(storage, `services/${user.uid}/big.jpg`)
await uploadBytes(fileRef, bigFile)
// Expected: FirebaseError: [permission-denied] (exceeds 5 MB limit)
```

### T8.4 — Non-image file rejected from services folder
```js
// Logged in as provider, uploading a JS file:
const jsFile = new File(['alert(1)'], 'evil.js', { type: 'application/javascript' })
const fileRef = ref(storage, `services/${user.uid}/evil.js`)
await uploadBytes(fileRef, jsFile)
// Expected: FirebaseError: [permission-denied] (contentType must match image/.*)
```

---

## T9 — Vercel Security Headers (WebApp)

### T9.1 — Security headers present on all routes
```bash
# Against the deployed Vercel preview URL or local `npm run preview`:
PREVIEW_URL="https://your-preview.vercel.app"

curl -s -I "${PREVIEW_URL}/" | grep -E "x-frame-options|x-content-type|strict-transport|content-security-policy|x-xss-protection"
# Expected output includes all of:
#   x-frame-options: DENY
#   x-content-type-options: nosniff
#   strict-transport-security: max-age=31536000; includeSubDomains
#   content-security-policy: ...
#   x-xss-protection: 1; mode=block
```

### T9.2 — CSP blocks inline script from untrusted origin
```bash
# Check that content-security-policy does NOT contain 'unsafe-eval' for connect-src
curl -s -I "${PREVIEW_URL}/" | grep "content-security-policy" | grep -v "unsafe-eval"
# Expected: line printed (unsafe-eval not in connect-src)
```

---

## T10 — Input Validation (Frontend Forms)

### T10.1 — Service description max length enforced
```js
// In the PublishService form, set description to 5001 characters:
const longDesc = 'a'.repeat(5001)
// Submit the form
// Expected: validation error "Máximo 5000 caracteres"
```

### T10.2 — Service price must be positive
```js
// Set price to -1 or 0 and submit:
// Expected: validation error "El precio debe ser mayor a $0"
```

### T10.3 — Service price max enforced
```js
// Set price to 10000000 and submit:
// Expected: validation error "El precio máximo es $9.999.999"
```

### T10.4 — Chat message max length enforced
```js
// Type a message > 1000 chars and send:
const longMsg = 'x'.repeat(1001)
// Expected: toast.error("El mensaje no puede superar los 1000 caracteres")
// Message NOT sent to Firestore
```

### T10.5 — Provider profile bio max length enforced
```js
// Set bio to 1001 characters and save:
// Expected: toast.error("La biografía no puede superar los 1000 caracteres")
```

### T10.6 — ProviderProfile save does not write MP tokens
```js
// Logged in as provider, call handleSave with a form that includes mpAccessToken:
// Intercept the Firestore write and verify mpAccessToken is NOT in the update payload
// Expected: only { displayName, bio, city, photoURL } written to Firestore
```

---

## Test Execution Checklist

| ID | Area | Test | Status |
|----|------|------|--------|
| T1.1 | Firestore | Unauth cannot read users | ⬜ |
| T1.2 | Firestore | Unauth cannot read configurations | ⬜ |
| T1.3 | Firestore | Unauth CAN read services | ⬜ |
| T1.4 | Firestore | Client cannot read others' bookings | ⬜ |
| T1.5 | Firestore | Client cannot skip state machine | ⬜ |
| T1.6 | Firestore | Client cannot modify immutable fields | ⬜ |
| T1.7 | Firestore | Non-admin cannot set moderationStatus | ⬜ |
| T1.8 | Firestore | Auth user can read services | ⬜ |
| T1.9 | Firestore | Provider cannot impersonate other provider | ⬜ |
| T1.10 | Firestore | Unauth cannot create booking | ⬜ |
| T1.11 | Firestore | Valid provider transition accepted | ⬜ |
| T1.12 | Firestore | Provider cannot confirm others' booking | ⬜ |
| T2.1 | CORS | Evil origin rejected | ⬜ |
| T2.2 | CORS | servigo.cl allowed | ⬜ |
| T2.3 | CORS | localhost:5173 allowed | ⬜ |
| T3.1 | Webhook | No signature = 403 | ⬜ |
| T3.2 | Webhook | Invalid signature = 403 | ⬜ |
| T3.3 | Webhook | Valid signature = 200 | ⬜ |
| T4.1 | Payment | Amount ignored from client | ⬜ |
| T4.2 | Payment | Non-owner cannot pay | ⬜ |
| T4.3 | Payment | processPayment ignores client amount | ⬜ |
| T5.1 | OAuth | Invalid nonce = 403 | ⬜ |
| T5.2 | OAuth | Expired nonce = 403 | ⬜ |
| T5.3 | OAuth | Unauth cannot initiate | ⬜ |
| T5.4 | OAuth | Nonce is one-time use | ⬜ |
| T6.1 | Claims | New user gets 'client' claim | ⬜ |
| T6.2 | Claims | setUserRole requires admin | ⬜ |
| T6.3 | Claims | setUserRole rejects invalid role | ⬜ |
| T6.4 | Claims | Firestore role manipulation has no effect | ⬜ |
| T7.1 | Admin | recalculateAllRatings requires admin | ⬜ |
| T7.2 | Admin | updateBookingStatus rejects invalid status | ⬜ |
| T7.3 | Admin | updateBookingStatus rejects unauth | ⬜ |
| T8.1 | Storage | Unauth upload rejected | ⬜ |
| T8.2 | Storage | Cross-user upload rejected | ⬜ |
| T8.3 | Storage | File size limit enforced | ⬜ |
| T8.4 | Storage | Non-image rejected from services | ⬜ |
| T9.1 | Headers | All security headers present | ⬜ |
| T9.2 | Headers | CSP is restrictive | ⬜ |
| T10.1 | Forms | Description max length | ⬜ |
| T10.2 | Forms | Price must be positive | ⬜ |
| T10.3 | Forms | Price max enforced | ⬜ |
| T10.4 | Forms | Chat message max length | ⬜ |
| T10.5 | Forms | Bio max length | ⬜ |
| T10.6 | Forms | MP tokens not written from frontend | ⬜ |
