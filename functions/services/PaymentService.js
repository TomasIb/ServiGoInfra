const BookingRepository = require('../repositories/BookingRepository');

/**
 * SERVICE LAYER: Orchestrates the payment workflow (Custodial model).
 *
 * En el modelo custodial:
 *   - El dinero va 100% a la cuenta MP del marketplace (ServiGo).
 *   - Los fondos quedan naturalmente retenidos ahí hasta que el cliente apruebe
 *     o se dispare la auto-liberación por categoría.
 *   - El payout al proveedor (86.2%) se encola en la colección `payouts` y se
 *     ejecuta manualmente desde el dashboard MP o vía job de pagos masivos.
 *
 * Por eso NO existe un `holdFundsInMP` ni un `captureAndReleaseFunds` — esos
 * eran intentos de controlar `money_release_date` / `capture` contra MP, que
 * no funcionan para nuestro caso (rechazo de credenciales y/o cap de 5 días).
 */
class PaymentService {
    /**
     * CENTRALIZED SYNC: Maps Mercado Pago status to App status.
     * Ensures Webhooks and Manual Verification are always in sync.
     */
    async updatePaymentStatusSync(bookingId, paymentData) {
        let appStatus = 'pending_payment';
        let isPaid = false;
        let retenidoStatus = 'none';

        const mpStatus = paymentData.status;

        if (mpStatus === 'authorized' || mpStatus === 'approved') {
            // Pago aprobado — fondos retenidos en cuenta marketplace
            // Booking ahora espera que el proveedor inicie el servicio
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
