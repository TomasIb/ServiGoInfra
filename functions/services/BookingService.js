const BookingRepository = require('../repositories/BookingRepository');
const PointsService = require('./PointsService');
const { admin } = require('../config');

/**
 * SERVICE LAYER: Orchestrates the Booking Lifecycle.
 * Implements Pago Retenido and Status transition rules (ADR-001).
 */
class BookingService {
    /**
     * Updates booking status with security and retenido checks.
     */
    async updateStatus(bookingId, newStatus, uid, isClient, isProvider, message) {
        const booking = await BookingRepository.getById(bookingId);
        if (!booking) throw new Error('NOT_FOUND');

        // Security Validation
        if (!isClient && !isProvider) throw new Error('PERMISSION_DENIED');

        // Transition Rule: Only provider can start
        if (newStatus === 'in_progress' && !isProvider) {
            throw new Error('ONLY_PROVIDER_CAN_START');
        }

        const historyItem = {
            status: newStatus,
            message: message || 'Estado actualizado',
            timestamp: admin.firestore.Timestamp.now(),
            userRole: isClient ? 'client' : 'provider',
            uid: uid
        };

        const updateData = {
            status: newStatus,
            statusHistory: admin.firestore.FieldValue.arrayUnion(historyItem),
            lastStatusUpdateBy: uid
        };

        // REWARD POINT RULE
        // Accru points when booking is marked as completed.
        if (newStatus === 'completed') {
            try {
                const earnedPoints = await PointsService.accruePoints(booking.clientId, bookingId, booking.total || 0);
                updateData.pointsEarned = earnedPoints;
                updateData.pointsStatus = 'accrued';
            } catch (err) {
                console.error('LOYALTY_ERROR: Could not accrue points', err.message);
            }
        }

        // ESCROW LIBERATION RULE (ADR-001)
        // If service is completed and was already held, release it.
        if (newStatus === 'completed' && booking.paid && (booking.status === 'payment_held' || booking.status === 'completed_pending_release')) {
            updateData.fundsReleased = true;
            updateData.fundsReleasedAt = admin.firestore.FieldValue.serverTimestamp();

            updateData.statusHistory = admin.firestore.FieldValue.arrayUnion(
                historyItem,
                {
                    status: 'funds_released',
                    message: '💰 Fondos liberados y puestos a disposición del vendedor.',
                    timestamp: admin.firestore.Timestamp.now(),
                    userRole: 'system',
                    uid: 'servigo_autopay'
                }
            );
        }

        await BookingRepository.update(bookingId, updateData);
        return { success: true };
    }
}

module.exports = new BookingService();
