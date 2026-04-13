#!/usr/bin/env node
/**
 * seed-demo.mjs — OPTIONAL seed for demo providers and services.
 * Uses firebase-admin to bypass security rules and handle user creation reliably.
 */
import 'dotenv/config'
import admin from 'firebase-admin'
import { randomUUID } from 'crypto'

const projectId = process.env.FIREBASE_PROJECT_ID || 'pruebaapp-11b43'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD

if (!DEMO_PASSWORD) {
  console.error('❌ Missing env var: DEMO_PASSWORD')
  process.exit(1)
}

// Initialize Admin SDK
admin.initializeApp({ projectId })

const db = admin.firestore()
const auth = admin.auth()

// ── Helpers ──────────────────────────────
const daysAgo = (n) => admin.firestore.Timestamp.fromDate(new Date(Date.now() - n * 86400000))
const now = () => admin.firestore.FieldValue.serverTimestamp()
const UNSPLASH_BASE = (id) => `https://images.unsplash.com/photo-${id}?w=200&h=200&fit=crop&q=80`

async function createOrUpdateUser(p) {
  try {
    let userRecord;
    try {
      userRecord = await auth.getUserByEmail(p.email);
      console.log(`  → Existing: ${p.email} (${userRecord.uid})`);
    } catch (e) {
      if (e.code === 'auth/user-not-found') {
        userRecord = await auth.createUser({
          email: p.email,
          password: DEMO_PASSWORD,
          displayName: p.displayName,
          photoURL: p.photoURL,
        });
        console.log(`  ✓ Created: ${p.email} (${userRecord.uid})`);
      } else {
        throw e;
      }
    }

    // Write to Firestore
    await db.collection('users').doc(userRecord.uid).set({
      ...p,
      uid: userRecord.uid,
      role: 'provider',
      isVerified: true,
      banned: false,
      createdAt: daysAgo(Math.floor(Math.random() * 90) + 30),
    }, { merge: true });

    return userRecord.uid;
  } catch (err) {
    console.error(`  ❌ Failed for ${p.email}:`, err.message);
    return null;
  }
}

// ── Service Category Images ──────────────────────────────
const CATEGORY_IMAGES = {
  Limpieza: [
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1527482797697-8795b1a55a45?w=800&h=600&fit=crop&q=80',
  ],
  Plomería: [
    'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=800&h=600&fit=crop&q=80',
  ],
  Electricista: [
    'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800&h=600&fit=crop&q=80',
  ],
  Belleza: [
    'https://images.unsplash.com/photo-1560869713-7d0a29430803?w=800&h=600&fit=crop&q=80',
  ],
  Tecnología: [
    'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&h=600&fit=crop&q=80',
  ],
  Mudanza: [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop&q=80',
  ],
  Jardinería: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=600&fit=crop&q=80',
  ],
  Educación: [
    'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=600&fit=crop&q=80',
  ],
  Hogar: [
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&h=600&fit=crop&q=80',
  ],
  Eventos: [
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&h=600&fit=crop&q=80',
  ],
  Tutoría: [
    'https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=800&h=600&fit=crop&q=80',
  ],
  Otros: [
    'https://images.unsplash.com/photo-1521737852567-6949f3f9f2b5?w=800&h=600&fit=crop&q=80',
  ],
}

const PROVIDERS = [
  { email: 'maria.gonzalez@servigo.cl', displayName: 'María González', city: 'Santiago', bio: 'Profesional de limpieza con 5 años de experiencia.', photoURL: UNSPLASH_BASE('1494790108377-be9c29b29330') },
  { email: 'juan.perez@servigo.cl', displayName: 'Juan Pérez', city: 'Santiago', bio: 'Plomero certificado.', photoURL: UNSPLASH_BASE('1500648767791-00dcc994a43e') },
  { email: 'pedro.rojas@servigo.cl', displayName: 'Pedro Rojas', city: 'Valparaíso', bio: 'Electricista certificado SEC.', photoURL: UNSPLASH_BASE('1507003211169-0a1dd7228f2d') },
  { email: 'ana.lopez@servigo.cl', displayName: 'Ana López', city: 'Santiago', bio: 'Estilista profesional a domicilio.', photoURL: UNSPLASH_BASE('1534528741775-53994a69daeb') },
  { email: 'teacher.mike@servigo.cl', displayName: 'Teacher Mike', city: 'Santiago', bio: 'Profesor nativo de inglés.', photoURL: UNSPLASH_BASE('1552058544-f2b08422138a') },
]

const SERVICES = [
  { title: 'Limpieza profunda de hogar', category: 'Limpieza', price: 35000, description: 'Limpieza completa con productos profesionales.', providerIdx: 0 },
  { title: 'Plomero urgente 24h', category: 'Plomería', price: 25000, description: 'Reparaciones de plomería de urgencia.', providerIdx: 1 },
  { title: 'Electricista certificado SEC', category: 'Electricista', price: 30000, description: 'Instalaciones y reparaciones SEC.', providerIdx: 2 },
  { title: 'Corte y peinado a domicilio', category: 'Belleza', price: 20000, description: 'Servicio de estilismo en tu hogar.', providerIdx: 3 },
  { title: 'Clases de inglés', category: 'Tutoría', price: 12000, description: 'Clases de inglés con profesor nativo.', providerIdx: 4 },
]

async function main() {
  console.log('\n🎭 ServiGo Demo Data Seeder (ADMIN MODE)\n')
  console.log(`  Project: ${projectId}`)

  const providerUids = []

  // 1. Create/Update providers
  console.log('\n── Syncing Demo Providers ──')
  for (const p of PROVIDERS) {
    const uid = await createOrUpdateUser(p)
    providerUids.push({ uid, ...p })
  }

  // 2. Create services
  console.log('\n── Syncing Demo Services ──')
  let serviceCount = 0
  for (const s of SERVICES) {
    const provider = providerUids[s.providerIdx]
    if (!provider?.uid) continue

    const categoryImages = CATEGORY_IMAGES[s.category] || CATEGORY_IMAGES.Otros
    const serviceId = `demo-${s.category.toLowerCase()}-${provider.uid.slice(0,5)}`

    await db.collection('services').doc(serviceId).set({
      title: s.title,
      category: s.category,
      price: s.price,
      description: s.description,
      providerId: provider.uid,
      providerName: provider.displayName,
      city: provider.city,
      rating: 0,
      reviewCount: 0,
      activo: true,
      moderationStatus: 'approved',
      images: [categoryImages[0]],
      createdAt: daysAgo(Math.floor(Math.random() * 60) + 5),
      updatedAt: now(),
    }, { merge: true })

    serviceCount++
    console.log(`  ✓ ${s.title}`)
  }

  console.log(`\n✅ Demo seed complete! (${serviceCount} services synced)\n`)
  process.exit(0)
}

main().catch(err => {
  console.error('❌ Unexpected failure:', err);
  process.exit(1);
})
