const BookingRepository = require('../repositories/BookingRepository');

/**
 * SERVICE LAYER: Orchestrates the payment workflow.
 * All payments go through marketplace account — no provider OAuth required.
 */
class PaymentService {
    /**
     * LIBERACIÓN DEL PAGO: Captures the pre-authorized payment.
     * Use when the service is accepted/completed.
     */
    async captureAndReleaseFunds(bookingId) {
        const booking = await BookingRepository.getById(bookingId);
        if (!booking || !booking.paymentId) {
            throw new Error('NO_PAYMENT_ID_FOUND');
        }

        // We use the admin client to capture the marketplace payment
        const { Payment } = require('mercadopago');
        const { mpClient } = require('../config');
        const paymentClient = new Payment(mpClient);

        console.log(`[Pago Retenido] Capturing payment ${booking.paymentId} for booking ${bookingId}`);

        // This effectively completes the retenido: money is taken from client and distributed.
        const response = await paymentClient.capture({ id: booking.paymentId });

        if (response.status === 'approved') {
            await BookingRepository.update(bookingId, {
                paymentStatus: 'approved',
                retenidoStatus: 'released',
                captured: true,
                capturedAt: new Date(),
                fundsReleased: true
            });
        }

        return response;
    }

    /**
     * CENTRALIZED SYNC: Maps Mercado Pago status to App status.
     * Ensures Webhooks and Manual Verification are always in sync.
     */
    async updatePaymentStatusSync(bookingId, paymentData) {
        let appStatus = 'pending_payment';
        let isPaid = false;
        let retenidoStatus = 'none';

        const mpStatus = paymentData.status;

        if (mpStatus === 'authorized') {
            appStatus = 'payment_held';
            isPaid = true;
            retenidoStatus = 'held';
        } else if (mpStatus === 'approved') {
            // With marketplace_deferred_release, approved = funds held by MP (not released)
            appStatus = 'payment_held';
            isPaid = true;
            retenidoStatus = 'held';
        } else if (['rejected', 'cancelled', 'refunded'].includes(mpStatus)) {
            appStatus = 'payment_failed';
            isPaid = false;
            retenidoStatus = 'none';
        }

        const updateData = {
            paymentStatus: mpStatus,
            status: appStatus,
            paid: isPaid,
            retenidoStatus: retenidoStatus,
            paymentId: paymentData.id,
            transactionAmount: paymentData.transaction_amount,
            paymentUpdatedAt: new Date(),
        };

        if (isPaid) updateData.paidAt = new Date();

        await BookingRepository.update(bookingId, updateData);
        return { bookingId, ...updateData };
    }
}

module.exports = new PaymentService();
