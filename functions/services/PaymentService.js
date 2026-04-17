const BookingRepository = require('../repositories/BookingRepository');
const { db } = require('../config');

/**
 * SERVICE LAYER: Orchestrates the payment workflow.
 * All payments go through marketplace account — no provider OAuth required.
 */
class PaymentService {
    /**
     * RETENCIÓN DE FONDOS: Sets money_release_date far in the future
     * so funds stay held in MP until ServiGo explicitly releases them.
     *
     * Why: `marketplace_deferred_release` is NOT a valid Preference API field.
     * The only reliable way to hold funds in a marketplace split payment (Checkout Pro)
     * is to PUT money_release_date on the payment AFTER it's approved.
     *
     * Called by: webhookMercadoPago, verifyPayment (after payment sync shows paid=true).
     */
    async holdFundsInMP(bookingId, paymentId) {
        const booking = await BookingRepository.getById(bookingId);
        if (!booking) {
            console.warn(`[Escrow Hold] Booking ${bookingId} not found — skipping hold`);
            return { success: false, reason: 'booking_not_found' };
        }

        // Load provider's OAuth token (payment lives on their account)
        let providerToken = null;
        if (booking.providerId) {
            try {
                const providerDoc = await db.collection('users').doc(booking.providerId).get();
                if (providerDoc.exists) {
                    providerToken = providerDoc.data().mpAccessToken;
                }
            } catch (e) {
                console.warn(`[Escrow Hold] Could not load provider token: ${e.message}`);
            }
        }

        const marketplaceToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
        const holdToken = providerToken || marketplaceToken;

        if (!holdToken) {
            console.warn(`[Escrow Hold] No token available to hold funds for booking=${bookingId}`);
            return { success: false, reason: 'no_token' };
        }

        // Set money_release_date to 30 days from now (safety margin).
        // Actual release happens earlier via releaseBookingFunds (PUT money_release_date = today).
        const holdUntil = new Date();
        holdUntil.setDate(holdUntil.getDate() + 30);
        const holdDateStr = holdUntil.toISOString();

        try {
            const tokenSource = providerToken ? 'provider_oauth' : 'marketplace_fallback';
            console.log(`[Escrow Hold] 🔒 Holding funds: booking=${bookingId}, payment=${paymentId}, until=${holdDateStr} (token=${tokenSource})`);

            const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${holdToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ money_release_date: holdDateStr })
            });

            const result = await response.json();

            if (response.ok) {
                console.log(`[Escrow Hold] ✅ Funds held until ${holdDateStr} for booking=${bookingId}`);
                await BookingRepository.update(bookingId, {
                    retenidoStatus: 'held',
                    moneyReleaseDate: holdDateStr,
                    fundsHeldAt: new Date(),
                });
                return { success: true, holdUntil: holdDateStr };
            } else {
                console.warn(`[Escrow Hold] ⚠️ MP rejected hold request: ${result.message || JSON.stringify(result)}`);
                return { success: false, reason: result.message || 'mp_rejected' };
            }
        } catch (error) {
            console.error(`[Escrow Hold] ❌ Network error holding funds for booking=${bookingId}:`, error.message);
            return { success: false, reason: error.message };
        }
    }

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
            // Money held by MP — booking now awaits provider approval
            appStatus = 'pending_confirmation';
            isPaid = true;
            retenidoStatus = 'held';
        } else if (mpStatus === 'approved') {
            // With marketplace_deferred_release, approved = funds held by MP (not released)
            // Booking awaits provider approval before proceeding
            appStatus = 'pending_confirmation';
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
