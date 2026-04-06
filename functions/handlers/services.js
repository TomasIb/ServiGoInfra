const { functions, db } = require('../config');

/**
 * CAPA 1 - FUNCIÓN 3: Prevenir Duplicados
 */
exports.preventDuplicateServices = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).firestore
    .document('services/{serviceId}')
    .onCreate(async (snap, context) => {
        const { providerId, title } = snap.data();
        if (!providerId || !title) return null;

        const duplicatesQuery = await db.collection('services')
            .where('providerId', '==', providerId)
            .get();

        let duplicateFound = false;
        duplicatesQuery.forEach(doc => {
            if (doc.id !== context.params.serviceId && doc.data().title.trim().toLowerCase() === title.trim().toLowerCase()) {
                duplicateFound = true;
            }
        });

        if (duplicateFound) {
            console.log(`[Services] Deleting duplicate: ${context.params.serviceId}`);
            return snap.ref.delete();
        }
        return null;
    });

/**
 * CAPA 2 - FUNCIÓN 4: Limpieza Profunda de Duplicados
 */
exports.cleanupDuplicateServices = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 60 }).pubsub
    .schedule('every 24 hours')
    .onRun(async (context) => {
        const snapshot = await db.collection('services').get();
        const providers = {};

        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.providerId) return;
            if (!providers[data.providerId]) providers[data.providerId] = [];
            providers[data.providerId].push({ id: doc.id, title: (data.title || '').trim().toLowerCase() });
        });

        const batch = db.batch();
        let deleted = 0;

        Object.values(providers).forEach(services => {
            const seen = new Set();
            services.forEach(s => {
                if (seen.has(s.title)) {
                    batch.delete(db.collection('services').doc(s.id));
                    deleted++;
                } else {
                    seen.add(s.title);
                }
            });
        });

        if (deleted > 0) {
            await batch.commit();
            console.log(`[Services] Cleanup complete: Deleted ${deleted} duplicates.`);
        }
        return null;
    });

/**
 * CAPA 4 - FUNCIÓN 6: Notificaciones de Moderación y Estado
 */
exports.handleServiceModeration = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).firestore
    .document('services/{serviceId}')
    .onUpdate(async (change, context) => {
        const newData = change.after.data();
        const prevData = change.before.data();

        const { providerId, title, moderationStatus, activo, moderationReason } = newData;
        if (!providerId) return null;

        let notificationTitle = '';
        let notificationBody = '';
        let triggerNotify = false;

        // 1. Cambio en Moderación (Aprobado, Rechazado, Suspendido)
        if (newData.moderationStatus !== prevData.moderationStatus) {
            triggerNotify = true;
            if (moderationStatus === 'approved') {
                notificationTitle = '¡Servicio Aprobado! 🚀';
                notificationBody = `Tu servicio "${title}" ha sido aprobado y ya está visible para los clientes.`;
            } else if (moderationStatus === 'rejected') {
                notificationTitle = 'Servicio Rechazado ⚠️';
                notificationBody = `Tu servicio "${title}" no pudo ser aprobado. Por favor revisa los detalles en tu panel.`;
            } else if (moderationStatus === 'suspended') {
                notificationTitle = 'Servicio Suspendido 🛑';
                notificationBody = `Tu servicio "${title}" ha sido suspendido por un administrador. Motivo: ${moderationReason || 'Incumplimiento de términos'}.`;
            } else {
                triggerNotify = false; // "pending" no notifica por ahora
            }
        } 
        
        // 2. Cambio en Activación (Solo si está aprobado, notificar si se apaga/prende)
        // Esto ayuda al proveedor a confirmar que su acción tuvo efecto o si el admin lo pausó.
        else if (newData.activo !== prevData.activo && moderationStatus === 'approved') {
            triggerNotify = true;
            notificationTitle = activo ? 'Servicio Activado ✅' : 'Servicio Pausado ⏸️';
            notificationBody = activo 
                ? `Tu servicio "${title}" vuelve a estar visible para recibir reservas.`
                : `Has pausado "${title}". Ya no aparecerá en las búsquedas hasta que lo reactives.`;
        }

        if (triggerNotify) {
            try {
                // Crear notificación en la colección (Esto dispara notifyOnNewNotification)
                await db.collection('notifications').add({
                    userId: providerId,
                    title: notificationTitle,
                    body: notificationBody,
                    type: 'service_status',
                    serviceId: context.params.serviceId,
                    serviceTitle: title,
                    createdAt: new Date(),
                    read: false
                });
                console.log(`[ServiceStatus] Notification created for ProviderID=${providerId}, Status=${moderationStatus}, Activo=${activo}`);
            } catch (error) {
                console.error(`[ServiceStatus] Error creating notification: ProviderID=${providerId}`, error);
            }
        }

        return null;
    });
