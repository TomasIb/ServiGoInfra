/**
 * COUPON SERVICE: Logic to apply and validate discounts.
 */

const { db } = require('../config');
const admin = require('firebase-admin');

class CouponService {
    /**
     * Validates a coupon for a specific purchase.
     */
    async validateCoupon(code, userId, amount) {
        if (!code) throw new Error('Códgio de cupón no proporcionado');

        const couponRef = db.collection('coupons').doc(code.toUpperCase());
        const couponDoc = await couponRef.get();

        if (!couponDoc.exists) throw new Error('El cupón no es válido o no existe');

        const data = couponDoc.data();

        // 1. Check Expiry
        if (data.expiryDate && data.expiryDate.toDate() < new Date()) {
            throw new Error('Lo sentimos, este cupón ha expirado');
        }

        // 2. Check Min Purchase
        if (data.minAmount && amount < data.minAmount) {
            throw new Error(`Este cupón requiere una compra mínima de $${data.minAmount}`);
        }

        // 3. Check Usage Limits
        if (data.usageLimit && data.usedCount >= data.usageLimit) {
            throw new Error('Este cupón ha alcanzado su límite de usos');
        }

        // 4. Check If User Already Used it (One-Time Coupon)
        const usageLog = await db.collection('coupon_usage')
            .where('userId', '==', userId)
            .where('code', '==', code.toUpperCase())
            .get();

        if (data.isOneTime && !usageLog.empty) {
            throw new Error('Ya has utilizado este código anteriormente');
        }

        // 5. Calculate Discount
        let discount = 0;
        if (data.type === 'PERCENTAGE') {
            discount = Math.floor(amount * (data.value / 100));
        } else if (data.type === 'FIXED') {
            discount = data.value;
        }

        return { 
            code: code.toUpperCase(), 
            discount, 
            type: data.type, 
            value: data.value 
        };
    }

    async applyCoupon(code, userId, bookingId) {
        const couponRef = db.collection('coupons').doc(code.toUpperCase());
        
        await db.runTransaction(async (transaction) => {
            transaction.update(couponRef, { 
                usedCount: admin.firestore.FieldValue.increment(1) 
            });

            // Log the usage
            transaction.set(db.collection('coupon_usage').doc(), {
                userId,
                bookingId,
                code: code.toUpperCase(),
                timestamp: admin.firestore.FieldValue.serverTimestamp()
            });
        });
    }
}

module.exports = new CouponService();
