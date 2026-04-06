/**
 * POINTS SERVICE: Core Loyalty Logic
 * Handles accrual, redemption, and audit logs.
 */

const { db } = require('../config');
const admin = require('firebase-admin');

class PointsService {
    /**
     * Accrue points based on booking value.
     * Default Ratio: 1 point per $100 CLP
     */
    async accruePoints(userId, bookingId, amount) {
        const pointsToEarn = Math.floor(amount / 100);
        
        if (pointsToEarn <= 0) return 0;

        const userRef = db.collection('users').doc(userId);
        const historyRef = db.collection('points_history').doc();

        await db.runTransaction(async (transaction) => {
            const userDoc = await transaction.get(userRef);
            if (!userDoc.exists) throw new Error('User not found');

            const currentPoints = userDoc.data().points || 0;
            const newTotal = currentPoints + pointsToEarn;

            // Update User Total
            transaction.update(userRef, { 
                points: newTotal,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            // Log the audit trial
            transaction.set(historyRef, {
                userId,
                bookingId,
                amount: pointsToEarn,
                type: 'ACCRUAL',
                description: `Puntos sumados por reserva #${bookingId.substring(0, 5)}`,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        });

        return pointsToEarn;
    }

    async getBalance(userId) {
        const userDoc = await db.collection('users').doc(userId).get();
        return userDoc.data()?.points || 0;
    }
}

module.exports = new PointsService();
