const { functions, cors } = require('../config');
const CouponService = require('../services/CouponService');

/**
 * Validates a coupon code and returns the discount amount.
 */
exports.validateCoupon = functions.https.onRequest(async (req, res) => {
    return cors(req, res, async () => {
        try {
            const { code, amount, userId } = req.body;

            if (!code || !amount || !userId) {
                return res.status(400).send({ error: 'Missing parameters' });
            }

            const validation = await CouponService.validateCoupon(code, amount, userId);
            
            res.status(200).send({
                success: true,
                ...validation
            });

        } catch (error) {
            console.error('COUPON_VALIDATION_ERROR:', error.message);
            res.status(400).send({ error: error.message });
        }
    });
});
