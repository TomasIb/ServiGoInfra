const { functions, db, admin, mercadopagoClientId, mercadopagoClientSecret } = require('../config');
const crypto = require('crypto');

/**
 * Sets the Firebase Auth custom claim 'role' for a user.
 * Can only be called by an admin.
 */
exports.setUserRole = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const callerRole = context.auth.token?.role;
    const callerUid = context.auth.uid;
    // Allow demo admin for development
    const isAdmin = callerRole === 'admin' || callerUid === 'guest_admin_1';

    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden cambiar roles.');
    }

    const { uid, role } = data;
    const ALLOWED_ROLES = ['client', 'provider', 'admin'];

    if (!uid || !role) {
        throw new functions.https.HttpsError('invalid-argument', 'Se requieren uid y role.');
    }
    if (!ALLOWED_ROLES.includes(role)) {
        throw new functions.https.HttpsError('invalid-argument', `Rol inválido: ${role}`);
    }

    await admin.auth().setCustomUserClaims(uid, { role });
    // Also update the Firestore document for reference (non-authoritative)
    await db.collection('users').doc(uid).update({ role });

    console.log(`[Auth] Role '${role}' set for user ${uid} by ${callerUid}`);
    return { success: true };
});

/**
 * Automatically sets the default 'client' role on new user creation,
 * UNLESS a role was already assigned (e.g. by adminCreateProvider).
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
    try {
        // Check if a role was already assigned (e.g. by adminCreateProvider)
        const freshUser = await admin.auth().getUser(user.uid);
        const existingRole = freshUser.customClaims?.role;

        if (existingRole) {
            console.log(`[Auth] User ${user.uid} already has role='${existingRole}', skipping default.`);
            return;
        }

        await admin.auth().setCustomUserClaims(user.uid, { role: 'client' });
        console.log(`[Auth] Default 'client' role set for new user: ${user.uid}`);
    } catch (error) {
        console.error(`[Auth] Failed to set default role for ${user.uid}:`, error);
    }
});

/**
 * Marks a provider as 'activated' when they first log in with their activation link.
 * Triggered by checking if accountStatus is 'pending_activation' on login.
 */
exports.activateProviderOnFirstLogin = functions.runWith({ maxInstances: 10, memory: '128MB', timeoutSeconds: 30 }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const { uid } = data;
    if (!uid || uid !== context.auth.uid) {
        throw new functions.https.HttpsError('permission-denied', 'No puedes activar otra cuenta.');
    }

    try {
        const userDoc = await db.collection('users').doc(uid).get();
        if (!userDoc.exists) {
            return { success: false, message: 'Usuario no encontrado' };
        }

        const userData = userDoc.data();
        // Only activate if currently pending_activation
        if (userData.accountStatus === 'pending_activation') {
            await db.collection('users').doc(uid).update({
                accountStatus: 'activated',
                activatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
            console.log(`[Auth] Provider ${uid} activated after first login`);
            return { success: true, accountStatus: 'activated' };
        }

        return { success: true, accountStatus: userData.accountStatus };
    } catch (error) {
        console.error(`[Auth] Failed to activate provider ${uid}:`, error);
        throw new functions.https.HttpsError('internal', 'Error al activar cuenta');
    }
});

/**
 * Initiates the MercadoPago OAuth flow by creating a one-time nonce stored in
 * Firestore. The nonce is passed as the 'state' parameter to MP, then verified
 * on the callback to prevent UID injection attacks.
 */
exports.initiateMpOAuth = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).https.onCall(async (data, context) => {
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
    }

    const uid = context.auth.uid;
    const { webRedirectBase } = data || {};

    // Generate a cryptographically random nonce
    const nonce = crypto.randomBytes(32).toString('hex');
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 60 * 1000); // 10 minutes

    await db.collection('oauth_states').doc(nonce).set({
        providerId: uid,
        expiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Build state: "nonce|redirectBase" or just "nonce"
    const state = webRedirectBase ? `${nonce}|${webRedirectBase}` : nonce;

    const projectId = admin.app().options.projectId || process.env.GCLOUD_PROJECT;
    const redirectUri = `https://us-central1-${projectId}.cloudfunctions.net/oauthMercadoPago`;
    const clientId = mercadopagoClientId.value();

    if (!clientId) {
        throw new functions.https.HttpsError('failed-precondition', 'OAuth not configured: MERCADOPAGO_CLIENT_ID not set');
    }

    const authUrl = `https://auth.mercadopago.cl/authorization?client_id=${clientId}&response_type=code&platform_id=mp&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;

    return { authUrl };
});
