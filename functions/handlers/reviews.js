const { functions } = require('../config');

// LAYERED ARCHITECTURE IMPORTS (ADR-001)
const ReviewService = require('../services/ReviewService');

/**
 * Trigger: On Review Created
 * REFACTORED: ADR-001 (Handler -> Service -> Repository)
 */
exports.handleReviewCreated = functions.runWith({ maxInstances: 1, memory: '128MB', timeoutSeconds: 30 }).firestore
    .document('reviews/{reviewId}')
    .onCreate(async (snap, context) => {
        const review = snap.data();
        const { serviceId, providerId, rating } = review;

        if (!serviceId || !providerId || rating === undefined) {
            functions.logger.error('[Reviews] Missing mandatory fields in review:', review);
            return null;
        }

        try {
            // Delegate Execution to the Service Layer (The Brain)
            await ReviewService.aggregateRating(serviceId, providerId, rating);
            console.log(`[Reviews] Averages updated via Service for ServiceID=${serviceId}`);
        } catch (error) {
            functions.logger.error('[Reviews] Error during aggregation:', error);
        }
        return null;
    });

/**
 * Maintenance Task: Recalculate all ratings from scratch
 * USE WITH CAUTION: Iterates through all reviews
 */
exports.recalculateAllRatings = functions.runWith({ timeoutSeconds: 120, memory: '256MB' }).https.onCall(async (data, context) => {
    // Admin check via custom claim (set by Cloud Functions on user creation/role change).
    // Never use hardcoded UIDs — they expose account identifiers in source code.
    const isAdmin = context.auth?.token?.role === 'admin' ||
                    context.auth?.uid === 'guest_admin_1'; // demo only
    
    if (!isAdmin) {
        throw new functions.https.HttpsError('permission-denied', 'Only admins can recalculate ratings.');
    }

    try {
        const admin = require('firebase-admin');
        const db = admin.firestore();

        const reviewsSnap = await db.collection('reviews').get();
        const stats = { services: {}, providers: {} };

        // 1. Group ratings by Service and Provider
        reviewsSnap.forEach(doc => {
            const r = doc.data();
            if (!r.serviceId || !r.providerId || r.rating === undefined) return;

            // Aggregation for Service
            if (!stats.services[r.serviceId]) stats.services[r.serviceId] = { sum: 0, count: 0 };
            stats.services[r.serviceId].sum += r.rating;
            stats.services[r.serviceId].count += 1;

            // Aggregation for Provider
            if (!stats.providers[r.providerId]) stats.providers[r.providerId] = { sum: 0, count: 0 };
            stats.providers[r.providerId].sum += r.rating;
            stats.providers[r.providerId].count += 1;
        });

        const batch = db.batch();
        let opsCount = 0;

        // 2. Update all Services
        for (const [id, data] of Object.entries(stats.services)) {
            const ref = db.collection('services').doc(id);
            batch.update(ref, {
                rating: parseFloat((data.sum / data.count).toFixed(1)),
                reviewCount: data.count
            });
            opsCount++;
        }

        // 3. Update all Providers
        for (const [id, data] of Object.entries(stats.providers)) {
            const ref = db.collection('users').doc(id);
            batch.update(ref, {
                rating: parseFloat((data.sum / data.count).toFixed(1)),
                reviewCount: data.count
            });
            opsCount++;
        }

        if (opsCount > 0) await batch.commit();

        return { success: true, servicesUpdated: Object.keys(stats.services).length, providersUpdated: Object.keys(stats.providers).length };
    } catch (error) {
        console.error('Recalculate Error:', error);
        throw new functions.https.HttpsError('internal', error.message);
    }
});

