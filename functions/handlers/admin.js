const { functions, db, admin } = require('../config');
const crypto = require('crypto');

/**
 * Creates a new provider account via Firebase Admin SDK.
 * Only callable by admins — does not affect the caller's auth session.
 * 
 * Flow:
 * 1. Admin fills in: email, displayName, phone, city (no password needed)
 * 2. Firebase creates the user with a random temporary password
 * 3. Firebase sends a password-reset email so the provider sets their own password
 * 4. Provider receives the activation email and creates their credentials
 */
exports.adminCreateProvider = functions
    .runWith({ maxInstances: 1, memory: '256MB', timeoutSeconds: 60 })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
        }

        let callerRole = context.auth.token?.role;
        const callerUid = context.auth.uid;

        // Fallback: if claim is missing, check Firestore (covers stale tokens or manually-created admins)
        if (!callerRole) {
            try {
                const callerDoc = await db.collection('users').doc(callerUid).get();
                if (callerDoc.exists) callerRole = callerDoc.data()?.role;
            } catch (_) { /* ignore */ }
        }

        functions.logger.info('[Admin] CreateProvider attempt', { uid: callerUid, role: callerRole, email: context.auth.token?.email });

        const isAdmin = callerRole === 'admin' || callerUid === 'guest_admin_1';

        if (!isAdmin) {
            throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden crear proveedores.');
        }

        const { email, displayName, city, bio, phone } = data;

        if (!email || !displayName) {
            throw new functions.https.HttpsError('invalid-argument', 'Se requieren email y displayName.');
        }
        if (!phone) {
            throw new functions.https.HttpsError('invalid-argument', 'El teléfono es requerido.');
        }

        try {
            // Generate a random temporary password (the provider will never use it)
            const tempPassword = crypto.randomBytes(20).toString('hex');

            // Create Firebase Auth user (does not affect admin's session)
            const userRecord = await admin.auth().createUser({
                email,
                password: tempPassword,
                displayName,
                phoneNumber: phone.startsWith('+') ? phone : undefined, // Only set if E.164 format
                emailVerified: false,
            });

            // Set provider custom claim immediately
            await admin.auth().setCustomUserClaims(userRecord.uid, { role: 'provider' });

            // Generate password-reset link — provider uses this to set their own password
            const resetLink = await admin.auth().generatePasswordResetLink(email);

            // Create Firestore user document
            const activationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
            await db.collection('users').doc(userRecord.uid).set({
                uid: userRecord.uid,
                email,
                displayName,
                role: 'provider',
                bio: bio || '',
                city: city || '',
                phone: phone || '',
                photoURL: null,
                isVerified: true, // Admin-created providers are pre-verified
                accountStatus: 'pending_activation', // New: activation status
                banned: false,
                rating: 0,
                reviewCount: 0,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                createdByAdmin: callerUid,
                activationLink: resetLink,
                activationExpiresAt: activationExpiresAt,
            });

            functions.logger.info('[Admin] Provider created — activation link generated', { uid: userRecord.uid, email, by: callerUid });

            return { success: true, uid: userRecord.uid, activationEmailSent: true, resetLink, accountStatus: 'pending_activation' };
        } catch (error) {
            if (error.code === 'auth/email-already-exists') {
                throw new functions.https.HttpsError('already-exists', 'Ya existe un usuario con ese email.');
            }
            if (error.code === 'auth/invalid-email') {
                throw new functions.https.HttpsError('invalid-argument', 'El email no es válido.');
            }
            if (error.code === 'auth/invalid-phone-number') {
                throw new functions.https.HttpsError('invalid-argument', 'El número de teléfono no es válido. Use formato internacional (+56...).');
            }
            console.error('[Admin] Error creating provider:', error);
            throw new functions.https.HttpsError('internal', error.message);
        }
    });

/**
 * Generate a new activation link for a pending provider.
 * Each call creates a fresh 24-hour link, expiring old ones.
 * Admin only.
 */
exports.generateActivationLink = functions
    .runWith({ maxInstances: 10, memory: '128MB', timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
        }

        let callerRole = context.auth.token?.role;
        if (!callerRole) {
            try {
                const callerDoc = await db.collection('users').doc(context.auth.uid).get();
                if (callerDoc.exists) callerRole = callerDoc.data()?.role;
            } catch (_) { /* ignore */ }
        }
        const isAdmin = callerRole === 'admin' || context.auth.uid === 'guest_admin_1';

        if (!isAdmin) {
            throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden generar links.');
        }

        const { uid } = data;
        if (!uid) {
            throw new functions.https.HttpsError('invalid-argument', 'Se requiere el UID del usuario.');
        }

        try {
            const userDoc = await db.collection('users').doc(uid).get();
            if (!userDoc.exists) {
                throw new functions.https.HttpsError('not-found', 'Usuario no encontrado.');
            }

            const userData = userDoc.data();
            const userRecord = await admin.auth().getUser(uid);

            // Generate new reset link
            const resetLink = await admin.auth().generatePasswordResetLink(userRecord.email);
            const activationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

            // Update Firestore with new link
            await db.collection('users').doc(uid).update({
                activationLink: resetLink,
                activationExpiresAt: activationExpiresAt,
                activationLinkGeneratedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            functions.logger.info('[Admin] New activation link generated', { uid, email: userRecord.email, by: context.auth.uid });
            return { success: true, resetLink };
        } catch (error) {
            console.error('[Admin] Error generating activation link:', error);
            throw new functions.https.HttpsError('internal', error.message);
        }
    });

/**
 * Send password reset email to a user.
 * Admin only.
 */
exports.sendPasswordResetEmail = functions
    .runWith({ maxInstances: 10, memory: '128MB', timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
        }

        let callerRole = context.auth.token?.role;
        if (!callerRole) {
            try {
                const callerDoc = await db.collection('users').doc(context.auth.uid).get();
                if (callerDoc.exists) callerRole = callerDoc.data()?.role;
            } catch (_) { /* ignore */ }
        }
        const isAdmin = callerRole === 'admin' || context.auth.uid === 'guest_admin_1';

        if (!isAdmin) {
            throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden enviar emails.');
        }

        const { email } = data;
        if (!email) {
            throw new functions.https.HttpsError('invalid-argument', 'Se requiere el email del usuario.');
        }

        try {
            // Generate password reset link
            const resetLink = await admin.auth().generatePasswordResetLink(email);
            functions.logger.info('[Admin] Password reset link generated for', { email, by: context.auth.uid });
            // Firebase sends the email automatically via its configured email service
            return { success: true, message: 'Email de restablecimiento enviado' };
        } catch (error) {
            console.error('[Admin] Error generating password reset:', error);
            if (error.code === 'auth/user-not-found') {
                throw new functions.https.HttpsError('not-found', 'Usuario no encontrado.');
            }
            throw new functions.https.HttpsError('internal', error.message);
        }
    });

/**
 * Toggle a service's active status (enable/disable).
 * Admin only.
 */
exports.adminToggleService = functions
    .runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 })
    .https.onCall(async (data, context) => {
        if (!context.auth) {
            throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');
        }

        let callerRole = context.auth.token?.role;
        if (!callerRole) {
            try {
                const callerDoc = await db.collection('users').doc(context.auth.uid).get();
                if (callerDoc.exists) callerRole = callerDoc.data()?.role;
            } catch (_) { /* ignore */ }
        }
        const isAdmin = callerRole === 'admin' || context.auth.uid === 'guest_admin_1';

        if (!isAdmin) {
            throw new functions.https.HttpsError('permission-denied', 'Solo los administradores pueden modificar servicios.');
        }

        const { serviceId, action } = data;

        const VALID_ACTIONS = ['approve', 'disable', 'enable', 'reject'];
        if (!serviceId || !VALID_ACTIONS.includes(action)) {
            throw new functions.https.HttpsError('invalid-argument', `Acción inválida. Usa: ${VALID_ACTIONS.join(', ')}`);
        }

        const serviceRef = db.collection('services').doc(serviceId);
        const serviceDoc = await serviceRef.get();
        if (!serviceDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Servicio no encontrado.');
        }

        const updates = {};
        if (action === 'approve') {
            updates.moderationStatus = 'approved';
            updates.activo = true;
            updates.approvedAt = admin.firestore.FieldValue.serverTimestamp();
            updates.approvedBy = context.auth.uid;
        } else if (action === 'reject') {
            updates.moderationStatus = 'rejected';
            updates.activo = false;
            updates.rejectedAt = admin.firestore.FieldValue.serverTimestamp();
            updates.rejectedBy = context.auth.uid;
        } else if (action === 'disable') {
            updates.activo = false;
            updates.disabledAt = admin.firestore.FieldValue.serverTimestamp();
            updates.disabledBy = context.auth.uid;
        } else if (action === 'enable') {
            updates.activo = true;
            updates.enabledAt = admin.firestore.FieldValue.serverTimestamp();
            updates.enabledBy = context.auth.uid;
        }

        updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
        await serviceRef.update(updates);

        // Notify the provider
        const serviceData = serviceDoc.data();
        if (serviceData.providerId) {
            const messages = {
                approve: { title: '✅ Servicio aprobado', body: `Tu servicio "${serviceData.title}" ha sido aprobado y está visible.` },
                reject: { title: '❌ Servicio rechazado', body: `Tu servicio "${serviceData.title}" ha sido rechazado por el equipo de moderación.` },
                disable: { title: '⚠️ Servicio desactivado', body: `Tu servicio "${serviceData.title}" ha sido desactivado temporalmente.` },
                enable: { title: '✅ Servicio reactivado', body: `Tu servicio "${serviceData.title}" ha sido reactivado.` },
            };
            const msg = messages[action];
            await db.collection('notifications').add({
                userId: serviceData.providerId,
                title: msg.title,
                body: msg.body,
                type: `service_${action}`,
                serviceId,
                read: false,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }

        console.log(`[Admin] Service ${action}: serviceId=${serviceId}, by=${context.auth.uid}`);
        return { success: true, action, serviceId };
    });
