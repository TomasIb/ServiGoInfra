/**
 * Seed Firestore with real data for ServiGo
 * Run: node scripts/seed-firestore.mjs
 */
import { initializeApp } from 'firebase/app'
import { getFirestore, collection, doc, setDoc, Timestamp } from 'firebase/firestore'
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import { randomUUID } from 'crypto'

const firebaseConfig = {
  apiKey: 'AIzaSyDGnx_dJE1UuHoUlNljLZoakVTgp_f-roo',
  authDomain: 'pruebaapp-11b43.firebaseapp.com',
  projectId: 'pruebaapp-11b43',
  storageBucket: 'pruebaapp-11b43.firebasestorage.app',
  messagingSenderId: '93623856134',
  appId: '1:93623856134:web:daf2d1a13e4867b3436787',
}

const app = initializeApp(firebaseConfig)
const db = getFirestore(app)
const auth = getAuth(app)

// Helper to create a date N days ago
const daysAgo = (n) => Timestamp.fromDate(new Date(Date.now() - n * 86400000))
const now = () => Timestamp.now()

// ── Stable Unsplash portrait photos per person (w=200&h=200&fit=crop)
// Format: https://images.unsplash.com/photo-{ID}?w=200&h=200&fit=crop&q=80
const UNSPLASH_BASE = (id) => `https://images.unsplash.com/photo-${id}?w=200&h=200&fit=crop&q=80`

// ── Service category images with gallery variations (w=800&h=600&fit=crop)
const CATEGORY_IMAGES = {
  Limpieza: [
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1527482797697-8795b1a55a45?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1559027615-cd6628902046?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1554456236-dfe8a90dd0e1?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1527482797697-8795b1a55a45?w=800&h=600&fit=crop&q=80',
  ],
  Plomería: [
    'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1585932917720-97d4de0fbc64?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1557679143-2cd3143131e3?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1564544747022-2b63fb3ce22d?w=800&h=600&fit=crop&q=80',
  ],
  Electricista: [
    'https://images.unsplash.com/photo-1621905251918-48416bd8575a?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1555097462-c2dfc2c45f60?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1568814532159-adf8b842c7c5?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1573166675220-53be94e5a228?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517420879443-b06a30ee0c12?w=800&h=600&fit=crop&q=80',
  ],
  Belleza: [
    'https://images.unsplash.com/photo-1560869713-7d0a29430803?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1552083974-5fefe8c9ef14?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1487412720507-e21cc028cb29?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1503250772935-731ae3b08e8f?w=800&h=600&fit=crop&q=80',
  ],
  Tecnología: [
    'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517433456452-f06b0073d5ac?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1531492746076-161ca9bcad58?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1497215842964-e6b87a915474?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&h=600&fit=crop&q=80',
  ],
  Mudanza: [
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1531482615713-2afd69097998?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1552088113-3ba5c5f39dda?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop&q=80',
  ],
  Jardinería: [
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1416879595882-3373a0480b5b?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1472241324340-7952121482a2?w=800&h=600&fit=crop&q=80',
  ],
  Educación: [
    'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1427504494785-405a60e2e7d0?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=800&h=600&fit=crop&q=80',
  ],
  Hogar: [
    'https://images.unsplash.com/photo-1504307651254-35680f356dfd?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1565183938294-7563f3ff68e5?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1573876677-b77f0546cad1?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1506439773649-6e0eb8cfb237?w=800&h=600&fit=crop&q=80',
  ],
  Eventos: [
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1519671482749-fd09be7ccebf?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1511632765486-a01980e01a18?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1533174072545-7c1a052cb830?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1462684691906-c0b45a87c7bf?w=800&h=600&fit=crop&q=80',
  ],
  Tutoría: [
    'https://images.unsplash.com/photo-1571260899304-425eee4c7efc?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1427504494785-405a60e2e7d0?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?w=800&h=600&fit=crop&q=80',
  ],
  Otros: [
    'https://images.unsplash.com/photo-1521737852567-6949f3f9f2b5?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1552664730-d307ca884978?w=800&h=600&fit=crop&q=80',
    'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800&h=600&fit=crop&q=80',
  ],
}

// ── PROVIDERS (real Firebase Auth users) ──────────────────────
const PROVIDERS = [
  {
    email: 'maria.gonzalez@servigo.cl',
    password: 'servigo123',
    displayName: 'María González',
    role: 'provider',
    city: 'Santiago',
    bio: 'Profesional de limpieza con 5 años de experiencia. Especializada en limpieza de hogares y oficinas.',
    isVerified: true,
    rating: 4.9,
    reviewCount: 47,
    photoURL: UNSPLASH_BASE('1494790108377-be9c29b29330'),
  },
  {
    email: 'juan.perez@servigo.cl',
    password: 'servigo123',
    displayName: 'Juan Pérez',
    role: 'provider',
    city: 'Santiago',
    bio: 'Plomero certificado con más de 8 años de experiencia. Atención de emergencias 24/7.',
    isVerified: true,
    rating: 4.7,
    reviewCount: 28,
    photoURL: UNSPLASH_BASE('1500648767791-00dcc994a43e'),
  },
  {
    email: 'pedro.rojas@servigo.cl',
    password: 'servigo123',
    displayName: 'Pedro Rojas',
    role: 'provider',
    city: 'Valparaíso',
    bio: 'Electricista certificado SEC. Instalaciones, reparaciones y mantención eléctrica residencial y comercial.',
    isVerified: true,
    rating: 4.9,
    reviewCount: 65,
    photoURL: UNSPLASH_BASE('1507003211169-0a1dd7228f2d'),
  },
  {
    email: 'ana.lopez@servigo.cl',
    password: 'servigo123',
    displayName: 'Ana López',
    role: 'provider',
    city: 'Santiago',
    bio: 'Estilista profesional a domicilio. Cortes, peinados, colorimetría y tratamientos capilares.',
    isVerified: true,
    rating: 4.6,
    reviewCount: 19,
    photoURL: UNSPLASH_BASE('1534528741775-53994a69daeb'),
  },
  {
    email: 'carlos.martinez@servigo.cl',
    password: 'servigo123',
    displayName: 'Carlos Martínez',
    role: 'provider',
    city: 'Concepción',
    bio: 'Técnico informático. Reparación de PC y Mac, redes, software y recuperación de datos.',
    isVerified: true,
    rating: 4.5,
    reviewCount: 31,
    photoURL: UNSPLASH_BASE('1506794778202-cad84cf45f1d'),
  },
  {
    email: 'transportes.zurita@servigo.cl',
    password: 'servigo123',
    displayName: 'Transportes Zurita',
    role: 'provider',
    city: 'Santiago',
    bio: 'Servicio de mudanzas residenciales y comerciales. Camiones equipados, embalaje profesional.',
    isVerified: true,
    rating: 4.8,
    reviewCount: 23,
    photoURL: UNSPLASH_BASE('1560250097-0b93528c311a'),
  },
  {
    email: 'roberto.fuentes@servigo.cl',
    password: 'servigo123',
    displayName: 'Roberto Fuentes',
    role: 'provider',
    city: 'Santiago',
    bio: 'Jardinero profesional. Diseño, mantención de jardines, poda y riego automático.',
    isVerified: true,
    rating: 4.7,
    reviewCount: 15,
    photoURL: UNSPLASH_BASE('1472099645785-5658abf4ff4e'),
  },
  {
    email: 'prof.silva@servigo.cl',
    password: 'servigo123',
    displayName: 'Prof. Silva',
    role: 'provider',
    city: 'Santiago',
    bio: 'Profesor de matemáticas y física. Preparación PSU/PAES, reforzamiento escolar y universitario.',
    isVerified: true,
    rating: 4.9,
    reviewCount: 78,
    photoURL: UNSPLASH_BASE('1519345182560-3f2917c472ef'),
  },
  {
    email: 'luis.araya@servigo.cl',
    password: 'servigo123',
    displayName: 'Luis Araya',
    role: 'provider',
    city: 'Temuco',
    bio: 'Pintor de interiores y exteriores. Acabados profesionales, empaste y texturizado.',
    isVerified: true,
    rating: 4.6,
    reviewCount: 12,
    photoURL: UNSPLASH_BASE('1463453091185-61582044d556'),
  },
  {
    email: 'dj.carlos@servigo.cl',
    password: 'servigo123',
    displayName: 'DJ Carlos',
    role: 'provider',
    city: 'Santiago',
    bio: 'DJ profesional para eventos, matrimonios, cumpleaños y fiestas corporativas. Equipo propio.',
    isVerified: true,
    rating: 4.8,
    reviewCount: 34,
    photoURL: UNSPLASH_BASE('1545167622-3a6ac756afa4'),
  },
  {
    email: 'teacher.mike@servigo.cl',
    password: 'servigo123',
    displayName: 'Teacher Mike',
    role: 'provider',
    city: 'Santiago',
    bio: 'Profesor nativo de inglés. Clases particulares y grupales, todos los niveles. TOEFL/IELTS prep.',
    isVerified: true,
    rating: 4.9,
    reviewCount: 56,
    photoURL: UNSPLASH_BASE('1552058544-f2b08422138a'),
  },
  {
    email: 'tecnoserv@servigo.cl',
    password: 'servigo123',
    displayName: 'TecnoServ',
    role: 'provider',
    city: 'Valparaíso',
    bio: 'Reparación de electrodomésticos: lavadoras, refrigeradores, secadoras, lavavajillas. Garantía escrita.',
    isVerified: true,
    rating: 4.5,
    reviewCount: 41,
    photoURL: UNSPLASH_BASE('1568602471122-7832951cc4c5'),
  },
]

// ── CLIENTS ──────────────────────────────────────
const CLIENTS = [
  {
    email: 'valentina.torres@gmail.com',
    password: 'servigo123',
    displayName: 'Valentina Torres',
    role: 'client',
    city: 'Santiago',
    bio: '',
    isVerified: true,
    rating: 0,
    reviewCount: 0,
    photoURL: UNSPLASH_BASE('1438761681033-6461ffad8d80'),
  },
  {
    email: 'carlos.mendez@gmail.com',
    password: 'servigo123',
    displayName: 'Carlos Méndez',
    role: 'client',
    city: 'Santiago',
    bio: '',
    isVerified: true,
    rating: 0,
    reviewCount: 0,
    photoURL: UNSPLASH_BASE('1548372290-8d01b6c8e78c'),
  },
  {
    email: 'ana.reyes@gmail.com',
    password: 'servigo123',
    displayName: 'Ana Reyes',
    role: 'client',
    city: 'Valparaíso',
    bio: '',
    isVerified: false,
    rating: 0,
    reviewCount: 0,
    photoURL: UNSPLASH_BASE('1567532939604-b6b5b0db2604'),
  },
]

// ── ADMIN ──────────────────────────────────────
const ADMIN = {
  email: 'admin@servigo.cl',
  password: 'servigo123',
  displayName: 'Admin ServiGo',
  role: 'admin',
  city: 'Santiago',
  bio: 'Administrador de la plataforma',
  isVerified: true,
  rating: 0,
  reviewCount: 0,
}

// ── Helpers ──────────────────────────────────────
async function createOrSignIn(userData) {
  try {
    const cred = await createUserWithEmailAndPassword(auth, userData.email, userData.password)
    console.log(`  ✓ Created: ${userData.email} (${cred.user.uid})`)
    return cred.user.uid
  } catch (err) {
    if (err.code === 'auth/email-already-in-use') {
      try {
        const cred = await signInWithEmailAndPassword(auth, userData.email, userData.password)
        console.log(`  → Existing: ${userData.email} (${cred.user.uid})`)
        return cred.user.uid
      } catch (signInErr) {
        // Password mismatch - skip this user but generate a deterministic UID placeholder
        console.log(`  ⚠ Skipping ${userData.email} (exists with different password)`)
        return null
      }
    }
    throw err
  }
}

async function writeUserDoc(uid, userData) {
  const { password, ...data } = userData
  await setDoc(doc(db, 'users', uid), {
    ...data,
    uid,
    banned: false,
    createdAt: daysAgo(Math.floor(Math.random() * 90) + 30),
  }, { merge: true })
}

// ── MAIN ──────────────────────────────────────
async function seed() {
  console.log('\n🌱 Seeding ServiGo Firestore...\n')

  // 1. Create providers
  console.log('── Creating Providers ──')
  const providerUids = []
  for (const p of PROVIDERS) {
    const uid = await createOrSignIn(p)
    await writeUserDoc(uid, p)
    providerUids.push({ uid, ...p })
  }

  // 2. Create clients
  console.log('\n── Creating Clients ──')
  const clientUids = []
  for (const c of CLIENTS) {
    const uid = await createOrSignIn(c)
    await writeUserDoc(uid, c)
    clientUids.push({ uid, ...c })
  }

  // 3. Create admin
  console.log('\n── Creating Admin ──')
  const adminUid = await createOrSignIn(ADMIN)
  if (adminUid) await writeUserDoc(adminUid, ADMIN)

  // 4. Create services
  console.log('\n── Creating Services ──')
  const SERVICES = [
    { title: 'Limpieza profunda de hogar', category: 'Limpieza', price: 35000, description: 'Limpieza completa con productos profesionales. Incluye cocina, baños, pisos, ventanas y espacios comunes.', providerIdx: 0 },
    { title: 'Limpieza de oficinas', category: 'Limpieza', price: 45000, description: 'Servicio corporativo de limpieza. Ideal para oficinas pequeñas y medianas.', providerIdx: 0 },
    { title: 'Plomero urgente 24h', category: 'Plomería', price: 25000, description: 'Reparaciones de plomería de urgencia. Destape de cañerías, fugas de agua, instalación de grifería.', providerIdx: 1 },
    { title: 'Instalación sanitaria completa', category: 'Plomería', price: 65000, description: 'Instalación de WC, lavamanos, duchas y calefont. Materiales incluidos.', providerIdx: 1 },
    { title: 'Electricista certificado SEC', category: 'Electricista', price: 30000, description: 'Instalaciones y reparaciones eléctricas con certificación SEC. Tableros, enchufes, iluminación.', providerIdx: 2 },
    { title: 'Instalación de luminarias', category: 'Electricista', price: 20000, description: 'Instalación profesional de lámparas, focos LED y sistemas de iluminación.', providerIdx: 2 },
    { title: 'Corte y peinado a domicilio', category: 'Belleza', price: 20000, description: 'Servicio de estilismo profesional en la comodidad de tu hogar. Corte, lavado y peinado.', providerIdx: 3 },
    { title: 'Colorimetría profesional', category: 'Belleza', price: 45000, description: 'Tintura, mechas, balayage y tratamientos de color. Productos de primera calidad.', providerIdx: 3 },
    { title: 'Soporte técnico PC/Mac', category: 'Tecnología', price: 18000, description: 'Reparación de computadores, instalación de software, limpieza de virus, optimización.', providerIdx: 4 },
    { title: 'Configuración de redes WiFi', category: 'Tecnología', price: 25000, description: 'Instalación y configuración de redes WiFi domésticas y comerciales. Extensores y mesh.', providerIdx: 4 },
    { title: 'Mudanza con camión', category: 'Mudanza', price: 80000, description: 'Mudanzas residenciales con camión equipado. Incluye carga, transporte y descarga. Embalaje opcional.', providerIdx: 5 },
    { title: 'Mantención de jardín', category: 'Jardinería', price: 25000, description: 'Corte de césped, poda de arbustos, limpieza de hojas y mantención general de jardines.', providerIdx: 6 },
    { title: 'Diseño de jardín', category: 'Jardinería', price: 60000, description: 'Diseño paisajístico, selección de plantas, instalación de riego automático.', providerIdx: 6 },
    { title: 'Clases de matemáticas', category: 'Educación', price: 15000, description: 'Tutoría personalizada de matemáticas. Preparación PSU/PAES, reforzamiento escolar y universitario.', providerIdx: 7 },
    { title: 'Preparación PAES Matemáticas', category: 'Educación', price: 20000, description: 'Curso intensivo de preparación para la PAES. Material incluido, seguimiento personalizado.', providerIdx: 7 },
    { title: 'Pintura de interiores', category: 'Hogar', price: 45000, description: 'Pintura profesional de interiores. Empaste, preparación de superficies y acabado impecable.', providerIdx: 8 },
    { title: 'Reparaciones generales del hogar', category: 'Hogar', price: 30000, description: 'Pequeñas reparaciones: colgar cuadros, armar muebles, reparar puertas y cerraduras.', providerIdx: 8 },
    { title: 'DJ para eventos', category: 'Eventos', price: 120000, description: 'DJ profesional con equipo propio. Matrimonios, cumpleaños, fiestas corporativas.', providerIdx: 9 },
    { title: 'Sonido e iluminación para eventos', category: 'Eventos', price: 180000, description: 'Arriendo de equipos de sonido e iluminación profesional. Incluye técnico.', providerIdx: 9 },
    { title: 'Clases de inglés', category: 'Tutoría', price: 12000, description: 'Clases de inglés con profesor nativo. Todos los niveles. Preparación TOEFL/IELTS.', providerIdx: 10 },
    { title: 'Inglés para empresas', category: 'Tutoría', price: 25000, description: 'Clases grupales de inglés corporativo. Business English, presentaciones, negociación.', providerIdx: 10 },
    { title: 'Reparación de lavadoras', category: 'Hogar', price: 22000, description: 'Reparación de lavadoras de todas las marcas. Diagnóstico gratuito. Garantía escrita de 3 meses.', providerIdx: 11 },
    { title: 'Reparación de refrigeradores', category: 'Hogar', price: 28000, description: 'Reparación y mantención de refrigeradores. Carga de gas, cambio de termostato, sellos.', providerIdx: 11 },
  ]

  const serviceIds = []
  let lastProviderIdx = -1
  for (let i = 0; i < SERVICES.length; i++) {
    const s = SERVICES[i]
    const provider = providerUids[s.providerIdx]
    const serviceId = randomUUID()

    // Sign in as the provider to have write permissions
    if (s.providerIdx !== lastProviderIdx) {
      await signInWithEmailAndPassword(auth, provider.email, PROVIDERS[s.providerIdx].password)
      lastProviderIdx = s.providerIdx
    }

    // Select 3-6 images from the category image set
    const categoryImages = CATEGORY_IMAGES[s.category] || CATEGORY_IMAGES.Otros
    const numImages = Math.min(3 + Math.floor(Math.random() * 4), categoryImages.length)
    const selectedImages = categoryImages.slice(0, numImages)

    await setDoc(doc(db, 'services', serviceId), {
      title: s.title,
      category: s.category,
      price: s.price,
      description: s.description,
      providerId: provider.uid,
      providerName: provider.displayName,
      city: provider.city,
      rating: provider.rating,
      reviewCount: provider.reviewCount,
      activo: true,
      moderationStatus: 'approved',
      images: selectedImages,
      createdAt: daysAgo(Math.floor(Math.random() * 60) + 5),
      updatedAt: now(),
    })
    serviceIds.push({ id: serviceId, ...s, providerId: provider.uid, providerName: provider.displayName })
    console.log(`  ✓ Service: ${s.title}`)
  }

  // 5. Create bookings
  console.log('\n── Creating Bookings ──')
  const BOOKING_STATUSES = ['pending_confirmation', 'confirmed', 'payment_held', 'in_progress', 'completed', 'completed']

  const bookings = [
    { serviceIdx: 0, clientIdx: 0, status: 'completed', daysAgoScheduled: 15, daysAgoCreated: 20 },
    { serviceIdx: 2, clientIdx: 0, status: 'completed', daysAgoScheduled: 10, daysAgoCreated: 14 },
    { serviceIdx: 4, clientIdx: 1, status: 'completed', daysAgoScheduled: 8, daysAgoCreated: 12 },
    { serviceIdx: 6, clientIdx: 2, status: 'completed', daysAgoScheduled: 5, daysAgoCreated: 9 },
    { serviceIdx: 13, clientIdx: 0, status: 'completed', daysAgoScheduled: 3, daysAgoCreated: 7 },
    { serviceIdx: 10, clientIdx: 1, status: 'payment_held', daysAgoScheduled: -2, daysAgoCreated: 5 },
    { serviceIdx: 1, clientIdx: 0, status: 'confirmed', daysAgoScheduled: -3, daysAgoCreated: 4 },
    { serviceIdx: 7, clientIdx: 2, status: 'pending_confirmation', daysAgoScheduled: -5, daysAgoCreated: 2 },
    { serviceIdx: 11, clientIdx: 1, status: 'pending_confirmation', daysAgoScheduled: -4, daysAgoCreated: 1 },
    { serviceIdx: 17, clientIdx: 0, status: 'confirmed', daysAgoScheduled: -7, daysAgoCreated: 3 },
    { serviceIdx: 19, clientIdx: 1, status: 'in_progress', daysAgoScheduled: 0, daysAgoCreated: 3 },
    { serviceIdx: 15, clientIdx: 2, status: 'completed', daysAgoScheduled: 12, daysAgoCreated: 16 },
  ]

  const bookingIds = []
  let lastClientIdx = -1
  for (let i = 0; i < bookings.length; i++) {
    const b = bookings[i]
    const service = serviceIds[b.serviceIdx]
    const client = clientUids[b.clientIdx]
    const bookingId = randomUUID()

    // Sign in as the client to have write permissions
    if (b.clientIdx !== lastClientIdx) {
      await signInWithEmailAndPassword(auth, client.email, CLIENTS[b.clientIdx].password)
      lastClientIdx = b.clientIdx
    }

    const scheduledDate = new Date(Date.now() - b.daysAgoScheduled * 86400000)
    const times = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00']

    await setDoc(doc(db, 'bookings', bookingId), {
      serviceId: service.id,
      serviceTitle: service.title,
      serviceCat: service.category,
      providerId: service.providerId,
      providerName: service.providerName,
      clientId: client.uid,
      clientName: client.displayName,
      clientEmail: client.email,
      totalPrice: service.price,
      status: b.status,
      scheduledDate: scheduledDate.toISOString().split('T')[0],
      scheduledTime: times[i % times.length],
      notes: '',
      createdAt: daysAgo(b.daysAgoCreated),
      updatedAt: now(),
      ...(b.status === 'completed' ? { completedAt: daysAgo(b.daysAgoScheduled - 1) } : {}),
    })
    bookingIds.push(bookingId)
    console.log(`  ✓ Booking: ${service.title} → ${client.displayName} [${b.status}]`)
  }

  // 6. Create reviews for completed bookings
  console.log('\n── Creating Reviews ──')
  const completedBookings = bookings.filter(b => b.status === 'completed')
  const reviewTexts = [
    'Excelente servicio, muy profesional y puntual. Lo recomiendo totalmente.',
    'Muy buen trabajo, quedé muy satisfecho con el resultado.',
    'Cumplió con lo prometido, buena comunicación durante todo el proceso.',
    'Trabajo impecable, superó mis expectativas. Volveré a contratar.',
    'Muy responsable y prolijo. El mejor servicio que he contratado.',
    'Gran profesional, muy amable y eficiente. Precio justo por la calidad.',
  ]

  const SEED_WORKER = {
    email: 'seed_worker@servigo.cl',
    password: 'servigo123',
    role: 'admin',
    displayName: 'Seed Worker Admin',
  };
  const seedUid = await createOrSignIn(SEED_WORKER);
  if (seedUid) {
    await writeUserDoc(seedUid, SEED_WORKER);
  }

  // Sign in as Admin once to overwrite existing reviews safely using catch-all rule
  await signInWithEmailAndPassword(auth, SEED_WORKER.email, SEED_WORKER.password);

  for (let i = 0; i < completedBookings.length; i++) {
    const b = completedBookings[i]
    const service = serviceIds[b.serviceIdx]
    const client = clientUids[b.clientIdx]
    const reviewId = `rev_${String(i + 1).padStart(3, '0')}`
    const rating = 4 + Math.random() * 1

    const bookingIdx = bookings.indexOf(b)
    await setDoc(doc(db, 'reviews', reviewId), {
      serviceId: service.id,
      providerId: service.providerId,
      clientId: client.uid,
      clientName: client.displayName,
      bookingId: bookingIds[bookingIdx],
      rating: Math.round(rating * 10) / 10,
      comment: reviewTexts[i % reviewTexts.length],
      createdAt: daysAgo(b.daysAgoScheduled - 2),
    })
    console.log(`  ✓ Review: ${client.displayName} → ${service.title} (${rating.toFixed(1)}⭐)`)
  }

  // 7. Seed escrow configuration
  console.log('\n── Seeding Escrow Configuration ──')
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

  console.log('\n✅ Seed complete!')
  console.log('\n── Login Credentials ──')
  console.log('Admin:    admin@servigo.cl / servigo123')
  console.log('Provider: maria.gonzalez@servigo.cl / servigo123')
  console.log('Client:   valentina.torres@gmail.com / servigo123')
  console.log('')

  process.exit(0)
}

seed().catch(err => {
  console.error('❌ Seed failed:', err)
  process.exit(1)
})
