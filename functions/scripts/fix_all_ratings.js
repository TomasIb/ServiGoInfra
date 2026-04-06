const admin = require('firebase-admin');
const path = require('path');

// 1. Initialize Admin SDK (Assuming local credentials are set via env or default)
// If running locally, you might need: export GOOGLE_APPLICATION_CREDENTIALS="path/to/key.json"
if (admin.apps.length === 0) {
    admin.initializeApp();
}

const db = admin.firestore();

async function recalculateEverything() {
    console.log('🚀 Starting global rating audit...');
    
    // 2. Clear out existing stale map
    const serviceStats = new Map();
    const providerStats = new Map();

    try {
        // 3. Fetch EVERY review in the database
        const reviewsSnap = await db.collection('reviews').get();
        console.log(`📊 Found ${reviewsSnap.size} total reviews to process.`);

        reviewsSnap.forEach(doc => {
            const r = doc.data();
            const { serviceId, providerId, rating } = r;

            if (!serviceId || !providerId || rating === undefined) {
                console.warn(`⚠️ Review ${doc.id} is missing critical data. Skipping.`);
                return;
            }

            // Group by Service
            if (!serviceStats.has(serviceId)) serviceStats.set(serviceId, { sum: 0, count: 0 });
            const s = serviceStats.get(serviceId);
            s.sum += rating;
            s.count += 1;

            // Group by Provider
            if (!providerStats.has(providerId)) providerStats.set(providerId, { sum: 0, count: 0 });
            const p = providerStats.get(providerId);
            p.sum += rating;
            p.count += 1;
        });

        // 4. Batch Update all Services
        const batch = db.batch();
        let ops = 0;

        console.log(`🔄 Updating ${serviceStats.size} services...`);
        for (const [id, stats] of serviceStats.entries()) {
            const finalRating = parseFloat((stats.sum / stats.count).toFixed(1));
            batch.update(db.collection('services').doc(id), {
                rating: finalRating,
                reviewCount: stats.count
            });
            ops++;
            if (ops >= 400) { // Firestore batch limit protection
                 await batch.commit();
                 ops = 0;
            }
        }

        // 5. Batch Update all Providers
        console.log(`🔄 Updating ${providerStats.size} professionals...`);
        for (const [id, stats] of providerStats.entries()) {
            const finalRating = parseFloat((stats.sum / stats.count).toFixed(1));
            batch.update(db.collection('users').doc(id), {
                rating: finalRating,
                reviewCount: stats.count
            });
            ops++;
            if (ops >= 400) {
                 await batch.commit();
                 ops = 0;
            }
        }

        if (ops > 0) await batch.commit();

        console.log('✅ DATABASE SYNC COMPLETE');
        console.log(`- Services Fixed: ${serviceStats.size}`);
        console.log(`- Professionals Fixed: ${providerStats.size}`);

    } catch (error) {
        console.error('❌ CRITICAL ERROR during audit:', error);
    }
}

recalculateEverything().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
