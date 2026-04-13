#!/usr/bin/env node
/**
 * set-admin-claim.mjs — Creates the admin user (if needed) and sets the
 * 'admin' custom claim using the Firebase ADMIN SDK.
 *
 * This bypasses Firestore rules entirely because Admin SDK has full access.
 * No need to switch to maintenance rules or do any "sandwich" deploy.
 *
 * Usage:  node scripts/set-admin-claim.mjs
 */
import admin from 'firebase-admin';

// Initialize with Application Default Credentials (your `firebase login` session)
admin.initializeApp({
    projectId: 'pruebaapp-11b43',
});

const ADMIN_EMAIL = 'admin@servigo.cl';
const ADMIN_PASSWORD = 'servigo123';
const ADMIN_NAME = 'Admin ServiGo';

async function main() {
    console.log('\n🔑 Admin Setup (Create + Set Custom Claim)\n');

    let user;

    // 1. Try to find the user, or create them
    try {
        user = await admin.auth().getUserByEmail(ADMIN_EMAIL);
        console.log(`  ✓ User already exists: ${user.uid} (${user.email})`);
    } catch (err) {
        if (err.code === 'auth/user-not-found') {
            console.log(`  → User ${ADMIN_EMAIL} not found. Creating...`);
            user = await admin.auth().createUser({
                email: ADMIN_EMAIL,
                password: ADMIN_PASSWORD,
                displayName: ADMIN_NAME,
                emailVerified: true,
            });
            console.log(`  ✓ Created user: ${user.uid} (${user.email})`);
        } else {
            throw err;
        }
    }

    // 2. Set the admin custom claim
    const currentClaims = user.customClaims || {};
    console.log(`  Current claims:`, JSON.stringify(currentClaims));

    await admin.auth().setCustomUserClaims(user.uid, { ...currentClaims, role: 'admin' });
    console.log(`  ✓ Custom claim { role: 'admin' } SET!`);

    // 3. Write the Firestore document (Admin SDK bypasses rules)
    const db = admin.firestore();
    await db.collection('users').doc(user.uid).set({
        uid: user.uid,
        email: ADMIN_EMAIL,
        displayName: ADMIN_NAME,
        role: 'admin',
        city: 'Santiago',
        bio: 'Administrador de la plataforma',
        isVerified: true,
        banned: false,
        rating: 0,
        reviewCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  ✓ Firestore users/${user.uid} document created/updated`);

    // 4. Verify it worked
    const verifyUser = await admin.auth().getUser(user.uid);
    console.log(`  ✓ Verification — claims are now:`, JSON.stringify(verifyUser.customClaims));

    console.log('\n✅ Done! Now log out and back in at the Webapp to pick up the admin claim.\n');
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    if (err.message.includes('Could not load the default credentials')) {
        console.error('\n💡 Fix: Run "gcloud auth application-default login" first.\n');
    }
    process.exit(1);
});
