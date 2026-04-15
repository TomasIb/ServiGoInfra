#!/usr/bin/env node
/**
 * set-admin-claim.mjs — Sets the 'admin' custom claim on the admin user
 * by calling the bootstrapAdmin Cloud Function via the CLIENT SDK.
 *
 * No gcloud ADC or service account key needed — uses email/password auth.
 *
 * Usage:  node scripts/set-admin-claim.mjs
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword } from 'firebase/auth';
import { getFunctions, httpsCallable, connectFunctionsEmulator } from 'firebase/functions';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

// Firebase Client SDK config (same as ServiGoWebApp)
const firebaseConfig = {
    apiKey: process.env.FIREBASE_API_KEY,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    projectId: process.env.FIREBASE_PROJECT_ID || 'pruebaapp-11b43',
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.FIREBASE_APP_ID,
};

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@servigo.cl';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'servigo123';
const BOOTSTRAP_SECRET = process.env.BOOTSTRAP_SECRET || 'servigo-bootstrap-2024';

async function main() {
    console.log('\n🔑 Admin Custom Claim Setup (via Cloud Function)\n');

    if (!firebaseConfig.apiKey) {
        console.error('❌ FIREBASE_API_KEY not found in .env');
        process.exit(1);
    }

    // 1. Initialize Firebase Client SDK
    const app = initializeApp(firebaseConfig);
    const authInstance = getAuth(app);
    const functionsInstance = getFunctions(app, 'us-central1');

    // Use emulator if running locally (optional)
    if (process.env.FUNCTIONS_EMULATOR_HOST) {
        const [host, port] = process.env.FUNCTIONS_EMULATOR_HOST.split(':');
        connectFunctionsEmulator(functionsInstance, host, parseInt(port));
        console.log(`  📡 Using functions emulator at ${process.env.FUNCTIONS_EMULATOR_HOST}`);
    }

    // 2. Sign in as the admin user
    console.log(`  → Signing in as ${ADMIN_EMAIL}...`);
    let userCredential;
    try {
        userCredential = await signInWithEmailAndPassword(authInstance, ADMIN_EMAIL, ADMIN_PASSWORD);
        console.log(`  ✓ Signed in: ${userCredential.user.uid} (${userCredential.user.email})`);
    } catch (err) {
        console.error(`  ❌ Sign-in failed: ${err.message}`);
        if (err.code === 'auth/user-not-found') {
            console.error('  💡 Run "npm run seed:admin" first to create the admin user.');
        }
        process.exit(1);
    }

    // 3. Call the bootstrapAdmin Cloud Function
    console.log('  → Calling bootstrapAdmin Cloud Function...');
    const bootstrapAdmin = httpsCallable(functionsInstance, 'bootstrapAdmin');

    try {
        const result = await bootstrapAdmin({ secret: BOOTSTRAP_SECRET });
        console.log(`  ✓ Custom claim { role: 'admin' } SET!`);
        console.log(`  ✓ UID: ${result.data.uid}`);
        console.log(`  ✓ Email: ${result.data.email}`);
        console.log(`  ✓ Claims: ${JSON.stringify(result.data.claims)}`);
    } catch (err) {
        console.error(`  ❌ bootstrapAdmin failed: ${err.message}`);
        if (err.code === 'functions/not-found') {
            console.error('  💡 Deploy functions first: firebase deploy --only functions');
        }
        process.exit(1);
    }

    console.log('\n✅ Done! Log out and back in at the Webapp to pick up the admin claim.\n');
    process.exit(0);
}

main().catch(err => {
    console.error('\n❌ Fatal error:', err.message);
    process.exit(1);
});
