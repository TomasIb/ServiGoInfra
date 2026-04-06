const { db } = require('../config');

/**
 * REPOSITORY LAYER: Manages all Firestore queries for Bookings.
 */
class BookingRepository {
    async getById(bookingId) {
        const doc = await db.collection('bookings').doc(bookingId).get();
        if (!doc.exists) return null;
        return { id: doc.id, ...doc.data() };
    }

    async update(bookingId, data) {
        return db.collection('bookings').doc(bookingId).update(data);
    }

    async setPaymentHeld(bookingId, paymentData) {
        return db.collection('bookings').doc(bookingId).update({
            ...paymentData,
            paymentStatus: 'held',
            paid: true,
            escrowStatus: 'held',
            paidAt: new Date()
        });
    }
}

module.exports = new BookingRepository();
