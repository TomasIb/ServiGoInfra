/**
 * BACKEND TEST: Escrow & Split Payment Handshake
 * Verifies PaymentService -> MercadoPagoService -> Repository link.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../functions/.env') });

const { db, admin } = require('../functions/config');
const PaymentService = require('../functions/services/PaymentService');

async function runTest() {
    console.log('🧪 Starting Escrow Flow Simulation...');
    
    try {
        // 1. MOCK DATA
        const mockBookingId = `TEST_BOOKING_${Date.now()}`;
        const mockAmount = 50000; // $50.000 CLP
        
        const mockProvider = {
            id: 'PROV_123',
            mpAccessToken: 'APP_USR-6497687667850405-032321-d83fd37de836cf9d14a91577714a184e-3287488851' // Using Admin as Provider for test
        };

        const mockService = {
            id: 'SERV_456',
            title: 'Servicio de Prueba - Escrow Test'
        };

        // 2. TRIGGER SERVICE logic
        console.log('📡 Calling PaymentService.initiateSplitPayment...');
        const result = await PaymentService.initiateSplitPayment(
            mockBookingId, 
            mockAmount, 
            mockProvider, 
            mockService
        );

        console.log('\n✅ TEST SUCCESSFUL!');
        console.log(`🔗 Preference ID: ${result.preferenceId}`);
        console.log(`🌍 Init Point (Test this in browser): ${result.initPoint}`);
        
        console.log('\n--- VERIFICATION ---');
        console.log('1. Open the Init Point above.');
        console.log(`2. Pay using a Sandbox Card.`);
        console.log(`3. Run scripts/check-payments.sh to confirm status: approved | Cap: False`);
        
    } catch (error) {
        console.error('❌ TEST FAILED:', error.message);
    }
}

runTest();
