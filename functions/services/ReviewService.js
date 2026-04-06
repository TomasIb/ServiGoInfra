const { db } = require('../config');

/**
 * SERVICE LAYER: Handles calculation and aggregation of ratings.
 */
class ReviewService {
    /**
     * Aggregates a new rating into an existing object (Service or User).
     * Uses a mathematical average formula to avoid fetching all reviews.
     */
    calculateNewAverage(oldRating, oldCount, newRating) {
        const count = (oldCount || 0) + 1;
        const rating = (oldRating || 5);
        const newAverage = ((rating * (oldCount || 0)) + newRating) / count;
        return {
            rating: parseFloat(newAverage.toFixed(1)),
            count: count
        };
    }

    /**
     * Runs a transaction to update both Service and Provider ratings safely.
     */
    async aggregateRating(serviceId, providerId, ratingValue) {
        return db.runTransaction(async (transaction) => {
            const serviceRef = db.collection('services').doc(serviceId);
            const providerRef = db.collection('users').doc(providerId);

            const [serviceDoc, providerDoc] = await Promise.all([
                transaction.get(serviceRef),
                transaction.get(providerRef)
            ]);

            // Aggregation for Service
            if (serviceDoc.exists) {
                const data = serviceDoc.data();
                const result = this.calculateNewAverage(data.rating, data.reviewCount, ratingValue);
                transaction.update(serviceRef, {
                    rating: result.rating,
                    reviewCount: result.count
                });
            }

            // Aggregation for Provider
            if (providerDoc.exists) {
                const data = providerDoc.data();
                const result = this.calculateNewAverage(data.rating, data.reviewCount, ratingValue);
                transaction.update(providerRef, {
                    rating: result.rating,
                    reviewCount: result.count
                });
            }
        });
    }
}

module.exports = new ReviewService();
