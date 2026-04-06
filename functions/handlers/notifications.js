const { functions, db, expo } = require('../config');
const { Expo } = require('expo-server-sdk');

/**
 * CAPA 3 - FUNCIÓN 5: Notificaciones Push Globales
 */
exports.notifyOnNewNotification = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).firestore
    .document('notifications/{notificationId}')
    .onCreate(async (snapshot, context) => {
        const notification = snapshot.data();
        const { userId, title, body, type, bookingId, senderData, serviceTitle } = notification;

        if (!userId) return null;

        try {
            const userDoc = await db.collection('users').doc(userId).get();
            if (!userDoc.exists) return null;

            const pushToken = userDoc.data()?.expoPushToken;
            console.log(`[Push] UserID=${userId}, TokenStatus=${pushToken ? 'Present' : 'Missing'}`);

            if (pushToken && Expo.isExpoPushToken(pushToken)) {
                await expo.sendPushNotificationsAsync([{
                    to: pushToken,
                    sound: 'default',
                    title: title || 'ServiGo',
                    body: body || 'Tienes una nueva notificación',
                    data: { type, bookingId, senderData, serviceTitle, userId },
                    priority: 'high'
                }]);
                console.log(`[Push] Notification sent: UserID=${userId}, Type=${type}`);
            }
        } catch (error) {
            console.error(`[Push] Error sending notification: UserID=${userId}`, error);
        }
        return null;
    });
