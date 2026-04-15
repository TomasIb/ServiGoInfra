/**
 * ServiGo Cloud Functions
 * Main entry point
 */

const { createPreference, webhookMercadoPago, verifyPayment, oauthMercadoPago, releaseBookingFunds, initiateRefund, resolveDispute, autoApproveCompletedBookings } = require('./handlers/payments');
const { notifyOnNewNotification } = require('./handlers/notifications');
const { /* sendBookingReminders, */ handleBookingStatusChange, updateBookingStatus } = require('./handlers/bookings');
const { preventDuplicateServices, cleanupDuplicateServices, handleServiceModeration } = require('./handlers/services');
const { handleReviewCreated } = require('./handlers/reviews');
const { validateCoupon } = require('./handlers/coupons');
const { setUserRole, onUserCreate, bootstrapAdmin, initiateMpOAuth, activateProviderOnFirstLogin } = require('./handlers/auth');
const { adminCreateProvider, adminToggleService, generateActivationLink, sendPasswordResetEmail } = require('./handlers/admin');

// Export all functions
module.exports = {
    // Payments
    createPreference,
    webhookMercadoPago,
    verifyPayment,
    oauthMercadoPago,
    releaseBookingFunds,
    initiateRefund,
    resolveDispute,
    autoApproveCompletedBookings,

    // Notifications
    notifyOnNewNotification,

    // Bookings
    // sendBookingReminders,
    handleBookingStatusChange,
    updateBookingStatus,

    // Services
    preventDuplicateServices,
    cleanupDuplicateServices,
    handleServiceModeration,

    // Reviews
    handleReviewCreated,
    recalculateAllRatings: require('./handlers/reviews').recalculateAllRatings,

    // Loyalty & Coupons
    validateCoupon,

    // Agenda & Availability
    icalFeed: require('./handlers/agenda').icalFeed,
    autoReminder: require('./handlers/agenda').autoReminder,

    // Auth & Role Management
    setUserRole,
    onUserCreate,
    bootstrapAdmin,
    initiateMpOAuth,
    activateProviderOnFirstLogin,

    // Admin Resource Management
    adminCreateProvider,
    adminToggleService,
    generateActivationLink,
    sendPasswordResetEmail,
};
// Force redeploy 1776102056
