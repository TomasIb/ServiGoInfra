# ServiGo Infrastructure — Firebase Backend

> Centralized Firebase infrastructure for the ServiGo platform.
> This repository manages Cloud Functions, Firestore/Storage rules, composite indexes, and operational scripts for both the mobile and web applications.

---

## Stack

| Component         | Technology                                            |
| ----------------- | ----------------------------------------------------- |
| Functions Runtime | Node.js 22                                            |
| SDKs              | `firebase-admin`, `firebase-functions`, `mercadopago`, `expo-server-sdk` |
| Database          | Cloud Firestore (Rules + Composite Indexes)           |
| Storage           | Firebase Storage (Rules)                              |
| Region            | `us-central1`                                         |

---

## Structure

```
ServiGoInfra/
├── firebase.json              # Firebase CLI config (Rules, Indexes, Functions)
├── firestore.indexes.json     # Production composite indexes
├── rules/
│   ├── firestore.rules        # Firestore security rules
│   └── storage.rules          # Storage security rules
├── functions/                 # Backend business logic
│   ├── index.js               # Entry point (exports all functions)
│   ├── config.js              # SDK initialization (MP, Expo, Admin)
│   ├── handlers/              # Feature modules (Payments, Bookings, etc.)
│   └── services/              # Pure business logic layer
└── scripts/                   # DB management & ops tools
```

---

## Deployment

### Prerequisites
- Install Firebase CLI: `npm install -g firebase-tools`
- Login: `firebase login`
- Selected Project: `pruebaapp-11b43`

### Commands
```bash
# Deploy all infrastructure
firebase deploy

# Deploy specific parts
firebase deploy --only functions
firebase deploy --only firestore:rules
firebase deploy --only firestore:indexes
firebase deploy --only storage:rules
```

---

## Cloud Functions

| Function            | Type    | Description                                      |
| ------------------- | ------- | ------------------------------------------------ |
| `createPreference`  | HTTPS   | [Mercado Pago] Create checkout preference        |
| `webhookMP`         | HTTPS   | [Mercado Pago] Webhook listener for IPNs         |
| `verifyPayment`     | HTTPS   | [Mercado Pago] Verify payment status manually    |
| `createEscrow`      | HTTPS   | [Escrow] Hold funds (capture: false)             |
| `releaseFunds`      | HTTPS   | [Escrow] Capture held funds after completion     |
| `autoApprove`       | Cron    | [Escrow] Auto-release after timeout              |
| `onBookingChange`   | DB      | [Lifecycle] Notifications & state transitions   |
| `validateCoupon`    | HTTPS   | [Marketing] Check validity of discount codes     |

---

## Automation Scripts

```bash
# Seed Firestore with demo data
node scripts/seed-firestore.mjs

# Seed test coupons
node scripts/seed-coupons.js

# Setup Firebase project wizard
bash scripts/setup-firebase.sh
```

---

## Configuration

Required environment variables (stored in Firebase Functions config):
- `mercadopago.access_token`: Access token from MP Dashboard

To set:
`firebase functions:config:set mercadopago.access_token="YOUR_TOKEN"`

---

## AI Agent Instructions

### Workflow
- **Infra First**: Any change strictly relating to backend logic, payment processing, or database security MUST happen in this repository.
- **TDD for Logic**: When modifying `functions/services/`, add or update tests in `functions/__tests__` if available (or create them).
- **Security Check**: Never relax Firestore rules without explicitly documenting the reasoning.
- **Synchronicity**: Ensure `firestore.indexes.json` stays in sync with actual query patterns in the apps.

### Deployment Process
1. Modify code.
2. Test locally using Firebase Emulators: `npm run serve` (in `/functions`).
3. Push to `main` (triggering CI if configured).
4. Manual deploy: `firebase deploy`.
