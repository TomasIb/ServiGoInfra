const { functions, db, expo, admin } = require('../config');
const { Expo } = require('expo-server-sdk');

/**
 * FUNCIÓN AUXILIAR: Recordatorios de Bookings
 */
exports.sendBookingReminders = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).pubsub
    .schedule('every 1 hours')
    .timeZone('America/Argentina/Buenos_Aires')
    .onRun(async (context) => {
        try {
            const in24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000);
            const in23Hours = new Date(Date.now() + 23 * 60 * 60 * 1000);

            const snapshot = await db.collection('bookings')
                .where('status', '==', 'confirmed')
                .where('paid', '==', true)
                .where('reminderSent', '==', false)
                .get();

            const messages = [];
            for (const doc of snapshot.docs) {
                const booking = doc.data();
                const scheduledDate = new Date(booking.scheduledDate + 'T' + booking.scheduledTime);

                if (scheduledDate >= in23Hours && scheduledDate <= in24Hours) {
                    const userDoc = await db.collection('users').doc(booking.clientId).get();
                    const pushToken = userDoc.data()?.expoPushToken;

                    if (pushToken && Expo.isExpoPushToken(pushToken)) {
                        messages.push({
                            to: pushToken,
                            title: '⏰ Recordatorio de Servicio',
                            body: `Mañana a las ${booking.scheduledTime} tienes "${booking.serviceName || 'tu servicio'}"`,
                            data: { bookingId: doc.id, type: 'reminder' }
                        });
                        await doc.ref.update({ reminderSent: true });
                    }
                }
            }

            if (messages.length > 0) {
                const chunks = expo.chunkPushNotifications(messages);
                for (const chunk of chunks) {
                    await expo.sendPushNotificationsAsync(chunk);
                }
                console.log(`[Reminders] Sent ${messages.length} reminders.`);
            }
        } catch (error) {
            console.error('[Reminders] Error in sendBookingReminders:', error);
        }
    });

/**
 * CAPA 3 - FUNCIÓN 6: Trigger de Cambio de Estado en Reservas
 */
exports.handleBookingStatusChange = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).firestore
    .document('bookings/{bookingId}')
    .onUpdate(async (change, context) => {
        const bookingId = context.params.bookingId;
        const newData = change.after.data();
        const prevData = change.before.get('status');
        if (newData.status === prevData) return null;

        console.log(`[StatusChange] BookingID=${bookingId}, Status=${prevData} -> ${newData.status}`);

        const isClient = newData.lastStatusUpdateBy === newData.clientId;
        const recipientId = isClient ? newData.providerId : newData.clientId;
        const initiatorName = isClient ? (newData.clientName || 'El cliente') : (newData.providerName || 'El profesional');

        const STATUS_LABELS = {
            'confirmed': 'confirmada',
            'declined': 'rechazada',
            'in_progress': 'iniciada',
            'completed': 'completada',
            'cancelled': 'cancelada'
        };

        await db.collection('notifications').add({
            userId: recipientId,
            title: 'Actualización de Reserva',
            body: `${initiatorName} ha marcado la reserva como ${STATUS_LABELS[newData.status] || newData.status}.`,
            type: 'booking_status_change',
            bookingId: context.params.bookingId,
            read: false,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return null;
    });

// LAYERED ARCHITECTURE IMPORTS (ADR-001)
const BookingService = require('../services/BookingService');

/**
 * CAPA 3 - FUNCIÓN 7: Actualizar Estado de Reserva (onCall)
 * REFACTORED: ADR-001 (Handler -> Service -> Repository)
 */
exports.updateBookingStatus = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).https.onCall(async (data, context) => {
    if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Debes iniciar sesión.');

    const { bookingId, newStatus, message } = data;
    if (!bookingId || !newStatus) throw new functions.https.HttpsError('invalid-argument', 'Faltan parámetros.');

    const ALLOWED_STATUSES = [
        'pending_confirmation', 'confirmed', 'payment_held',
        'in_progress', 'completed_pending_release', 'completed',
        'cancelled', 'disputed',
    ];
    if (!ALLOWED_STATUSES.includes(newStatus)) {
        throw new functions.https.HttpsError('invalid-argument', `Estado inválido: ${newStatus}`);
    }

    const uid = context.auth.uid;

    try {
        // Resolve domain context loosely for the Service
        const bookingRef = db.collection('bookings').doc(bookingId);
        const bookingDoc = await bookingRef.get();
        if (!bookingDoc.exists) throw new functions.https.HttpsError('not-found', 'Reserva no encontrada.');
        
        const booking = bookingDoc.data();
        const isClient = booking.clientId === uid;
        const isProvider = booking.providerId === uid;

        // Delegate Execution to the Service Layer (The Brain)
        await BookingService.updateStatus(bookingId, newStatus, uid, isClient, isProvider, message);

        console.log(`[updateBookingStatus] Success: BookingID=${bookingId}, Status=${newStatus}`);
        return { success: true };
    } catch (error) {
        functions.logger.error(`[updateBookingStatus] Error: ${error.message}`, error);
        
        // Map domain errors to HTTPS errors
        if (error.message === 'PERMISSION_DENIED') throw new functions.https.HttpsError('permission-denied', 'No tienes permiso.');
        if (error.message === 'ONLY_PROVIDER_CAN_START') throw new functions.https.HttpsError('permission-denied', 'Solo el profesional puede iniciar el servicio.');
        
        throw new functions.https.HttpsError('internal', error.message);
    }
});

