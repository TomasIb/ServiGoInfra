const admin = require('firebase-admin');
const fs = require('fs');

// Intentar cargar la llave de servicio si existe
const serviceAccountPath = './serviceAccountKey.json';
let app;

if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    app = admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} else {
    // Si no hay llave, intentamos credenciales por defecto (si estás logueado en firebase cli)
    app = admin.initializeApp();
}

const db = admin.firestore();

async function cleanApp() {
    console.log('🧹 Iniciando limpieza profunda de la App...');
    
    const collections = [
        'bookings',
        'notifications',
        'chats',
        'user_favorites',
        'reviews',
        'payments'
    ];

    for (const coll of collections) {
        console.log(`- Limpiando colección: ${coll}...`);
        const snapshot = await db.collection(coll).get();
        if (snapshot.empty) {
            console.log(`  (Vacía)`);
            continue;
        }

        const batch = db.batch();
        snapshot.docs.forEach((doc) => {
            batch.delete(doc.ref);
        });
        await batch.commit();
        console.log(`  ✅ ${snapshot.size} documentos borrados.`);
    }

    console.log('\n✨ Limpieza completada. La App está como nueva.');
    process.exit(0);
}

cleanApp().catch(err => {
    console.error('❌ Error durante la limpieza:', err);
    process.exit(1);
});
