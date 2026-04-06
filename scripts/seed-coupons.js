/**
 * SEED SCRIPT: Coupons & Rewards
 * Populates Firestore with test coupons for development.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../functions/.env') });

const admin = require('firebase-admin');
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: 'servigo-64976'
    });
}
const db = admin.firestore();

const testCoupons = [
    {
        id: 'BIENVENIDO10',
        type: 'PERCENTAGE',
        value: 10,
        minAmount: 5000,
        isOneTime: true,
        usageLimit: 100,
        usedCount: 0,
        expiryDate: admin.firestore.Timestamp.fromDate(new Date('2026-12-31'))
    },
    {
        id: 'PROMO5K',
        type: 'FIXED',
        value: 5000,
        minAmount: 20000,
        isOneTime: false,
        usageLimit: 50,
        usedCount: 0,
        expiryDate: admin.firestore.Timestamp.fromDate(new Date('2026-06-30'))
    }
];

async function seed() {
    console.log('🌱 Seeding Coupons to Firestore...');
    for (const coupon of testCoupons) {
        await db.collection('coupons').doc(coupon.id).set(coupon);
        console.log(`✅ Coupon Created: ${coupon.id}`);
    }
    console.log('🚀 Seeding Complete!');
    process.exit(0);
}

seed();
