#!/usr/bin/env node
/**
 * seed-config.mjs — Seeds ONLY system configurations + optional admin user.
 * Uses Firebase Client SDK. 
 * NOTE: Requires Firestore rules to be open OR an existing admin session.
 */
import 'dotenv/config'
import { initializeApp } from 'firebase/app'
import { getFirestore, doc, setDoc, Timestamp } from 'firebase/firestore'
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID,
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)
const auth = getAuth(app)

const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@servigo.cl'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const ADMIN_NAME = process.env.ADMIN_DISPLAY_NAME || 'Admin ServiGo'

async function createOrSignIn() {
  try {
    const cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD)
    console.log(`  ✓ Created: ${ADMIN_EMAIL} (${cred.user.uid})`)
    return cred.user.uid
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      try {
        const cred = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD)
        console.log(`  → Signed in: ${ADMIN_EMAIL} (${cred.user.uid})`)
        return cred.user.uid
      } catch (signInErr) {
        console.log(`  ⚠ Skipping document write (exists with different password)`)
        return null
      }
    }
    throw err
  }
}

async function main() {
  const args = process.argv.slice(2)
  const includeAdmin = args.includes('--admin')

  console.log('\n🔧 ServiGo Configuration Seeder\n')
  console.log(`  Project: ${firebaseConfig.projectId}`)

  // 1. Always seed escrow configuration
  console.log('\n── Seeding configurations/escrow ──')
  await setDoc(doc(db, 'configurations', 'escrow'), {
    releaseWindows: {
      Limpieza: 24,
      Belleza: 24,
      Plomería: 72,
      Electricista: 72,
      Tecnología: 72,
      Mudanza: 72,
      Jardinería: 72,
      Hogar: 120,
      Eventos: 120,
      Educación: 120,
      Tutoría: 120,
      Otros: 120,
    },
    defaultWindow: 72,
    updatedAt: Timestamp.now(),
  })
  console.log('  ✓ configurations/escrow seeded')

  // 2. Optionally create admin user
  if (includeAdmin) {
    if (!ADMIN_PASSWORD) {
      console.error('\n❌ ADMIN_PASSWORD env var is required when using --admin')
      process.exit(1)
    }
    console.log('\n── Creating Admin User ──')
    const adminUid = await createOrSignIn()
    if (adminUid) {
      await setDoc(doc(db, 'users', adminUid), {
        uid: adminUid,
        email: ADMIN_EMAIL,
        displayName: ADMIN_NAME,
        role: 'admin',
        city: 'Santiago',
        bio: 'Administrador de la plataforma',
        isVerified: true,
        banned: false,
        rating: 0,
        reviewCount: 0,
        createdAt: Timestamp.now(),
      }, { merge: true })
      console.log('  ✓ Admin user document written')
    }
  }

  console.log('\n✅ Configuration seed complete!\n')
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Seed failed:', err.message)
  process.exit(1)
})
