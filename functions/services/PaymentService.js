const BookingRepository = require('../repositories/BookingRepository');
const MercadoPagoService = require('./MercadoPagoService');

/**
 * SERVICE LAYER: Orchestrates the payment workflow.
 */
class PaymentService {
    /**
     * Business Logic for splitting payments.
     * @param {string} bookingId - The Firestore document ID.
     * @param {number} amount - Total amount in CLP.
     * @param {object} provider - The user object from Firestore.
     * @param {object} service - The service object from Firestore.
     */
    async initiateSplitPayment(bookingId, amount, provider, service) {
        if (!provider.mpAccessToken) {
            throw new Error('PROVIDER_NOT_LINKED_MP_OAUTH');
        }

        const marketplaceFee = Math.round(Number(amount) * 0.10); // 10% ServiGo Fee
        
        const preferenceData = {
            items: [{
                id: service.id,
                title: service.title || 'Servicio Profesional',
                quantity: 1,
                currency_id: 'CLP',
                unit_price: Number(amount),
            }],
            back_urls: {
                success: 'servigo://payment/success',
                failure: 'servigo://payment/failure',
                pending: 'servigo://payment/pending',
            },
            auto_return: 'approved',
            external_reference: bookingId,
            marketplace_fee: marketplaceFee,
            binary_mode: true,
            // ESCROW ACTIVATION: Pre-authorize only.
            // Note: In Checkout Pro (Preference API), capture: false is sometimes ignored.
            // If it remains 'True', we will migrate this to the 'Payment Bricks' or 'Payment API' 
            // to have 100% control over the hold/release flow.
            capture: false, 
            operation_type: 'regular_payment',
            marketplace_deferred_release: true,
        };

        const preference = await MercadoPagoService.createSplitPreference(
            provider.mpAccessToken, 
            preferenceData
        );

        // Update booking state in Firestore via Repository
        await BookingRepository.update(bookingId, {
            paymentPreferenceId: preference.id,
            paymentStatus: 'pending',
            collectorType: 'split_payment',
            servigoFee: marketplaceFee,
            providerPayout: Number(amount) - marketplaceFee
        });

        return { initPoint: preference.initPoint, preferenceId: preference.id };
    }

    /**
     * PROFESSIONAL ESCROW: Direct Payment Creation.
     * Use this with card tokens from the frontend.
     */
    async createEscrowPayment(bookingId, amount, provider, paymentData) {
        if (!provider.mpAccessToken) {
            throw new Error('PROVIDER_NOT_LINKED_MP_OAUTH');
        }

        const marketplaceFee = Math.round(Number(amount) * 0.10);

        const body = {
            transaction_amount: Number(amount),
            description: `ServiGo Escrow: Booking ${bookingId}`,
            payment_method_id: paymentData.paymentMethodId,
            token: paymentData.token, // Card token from frontend
            installments: 1,
            payer: {
                email: paymentData.email,
            },
            // THE CRITICAL FIELDS FOR ESCROW (Held in MP)
            capture: false, 
            application_fee: marketplaceFee,
            external_reference: bookingId,
            binary_mode: true
        };

        const payment = await MercadoPagoService.createPayment(provider.mpAccessToken, body);

        // Update booking with the HELD payment ID
        await BookingRepository.update(bookingId, {
            paymentId: payment.id,
            paymentStatus: 'authorized', // Funds are pre-authorized (held)
            escrowStatus: 'held',
            captured: false
        });

        return payment;
    }

    /**
     * ESCROW LIBERATION: Captures the pre-authorized payment.
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

        console.log(`[Escrow] Capturing payment ${booking.paymentId} for booking ${bookingId}`);

        // This effectively completes the escrow: money is taken from client and distributed.
        const response = await paymentClient.capture({ id: booking.paymentId });

        if (response.status === 'approved') {
            await BookingRepository.update(bookingId, {
                paymentStatus: 'approved',
                escrowStatus: 'released',
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
        let escrowStatus = 'none';

        const mpStatus = paymentData.status;

        if (mpStatus === 'authorized') {
            appStatus = 'payment_held';
            isPaid = true;
            escrowStatus = 'held';
        } else if (mpStatus === 'approved') {
            appStatus = 'confirmed';
            isPaid = true;
            escrowStatus = 'released';
        } else if (['rejected', 'cancelled', 'refunded'].includes(mpStatus)) {
            appStatus = 'payment_failed';
            isPaid = false;
            escrowStatus = 'none';
        }

        const updateData = {
            paymentStatus: mpStatus,
            status: appStatus,
            paid: isPaid,
            escrowStatus: escrowStatus,
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
