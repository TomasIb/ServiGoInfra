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

    // Advanced Payments (Escrow)
    createEscrowPayment: require('./handlers/payments').createEscrowPayment,

    // Agenda & Availability
    icalFeed: require('./handlers/agenda').icalFeed,
    autoReminder: require('./handlers/agenda').autoReminder,
};
