/*<!--
 I declare that this code was written by me. 
 I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: Ray
 Student ID: 24026513
 Class: C372-003-E63C
 Date created: 20/1/2026
  -->*/
  
const express = require('express');
const BnplController = require('../controllers/BnplController');
const NetsController = require('../controllers/NetsController');
const RefundController = require('../controllers/RefundController');
const InvoiceController = require('../controllers/InvoiceController');
const WalletController = require('../controllers/WalletController');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

// BNPL
router.post('/checkout/bnpl', requireAuth, BnplController.bnplCheckout);
router.post('/api/bnpl/paypal/create-order', requireAuth, BnplController.bnplPaypalCreate);
router.post('/api/bnpl/paypal/capture', requireAuth, BnplController.bnplPaypalCapture);
router.get('/bnpl/card', requireAuth, BnplController.cardInfoPage);
router.post('/bnpl/card/setup', requireAuth, BnplController.cardSetup);
router.post('/bnpl/card/validate', requireAuth, BnplController.cardValidate);
router.post('/bnpl/card/cancel', requireAuth, BnplController.cardCancel);
router.get('/bnpl/orders/:id', requireAuth, BnplController.schedulePage);
router.get('/bnpl/orders/:id/refund', requireAuth, BnplController.refundPage);
router.post('/bnpl/orders/:id/refund', requireAuth, BnplController.refundSubmit);

// BNPL admin
router.post('/admin/orders/:id/refund-bnpl', requireAuth, requireRole('admin'), BnplController.adminRefundBnpl);
router.get('/admin/bnpl/refunds', requireAuth, requireRole('admin'), BnplController.adminRefundRequestsPage);
router.post('/admin/bnpl/refunds/:id/approve', requireAuth, requireRole('admin'), BnplController.adminApproveRefundRequest);
router.post('/admin/bnpl/refunds/:id/reject', requireAuth, requireRole('admin'), BnplController.adminRejectRefundRequest);

// NETS QR
router.post('/checkout/nets', requireAuth, NetsController.startCheckout);
router.get('/nets-qr/success', requireAuth, NetsController.netsSuccess);
router.get('/nets-qr/fail', requireAuth, NetsController.netsFail);
router.get('/sse/payment-status/:txnRetrievalRef', requireAuth, NetsController.netsSseStatus);
router.get('/paypal/success', requireAuth, (req, res) => {
  res.render('paypal/paypalTxnSuccessStatus', {
    message: 'Payment Successful! Your order is being prepared.',
    orderId: req.query.orderId || null
  });
});

// PokeVault Pay (wallet)
router.get('/wallet', requireAuth, WalletController.walletPage);
router.get('/wallet/topup', requireAuth, WalletController.topupPage);
router.post('/wallet/topup/confirm', requireAuth, WalletController.topupConfirm);
router.get('/wallet/topup/payment', requireAuth, WalletController.topupPaymentPage);
router.post('/wallet/topup/paypal/create-order', requireAuth, WalletController.topupPaypalCreate);
router.post('/wallet/topup/paypal/capture', requireAuth, WalletController.topupPaypalCapture);
router.post('/wallet/topup/stripe/create-checkout-session', requireAuth, WalletController.topupStripeCreateSession);
router.get('/wallet/topup/stripe/success', requireAuth, WalletController.topupStripeSuccess);
router.get('/wallet/topup/stripe/cancel', requireAuth, WalletController.topupStripeCancel);
router.post('/wallet/topup/nets', requireAuth, WalletController.topupNets);
router.get('/wallet/receipt/:id', requireAuth, WalletController.receiptPage);

// Refunds
router.get('/orders/:id/refund', requireAuth, RefundController.refundPage);
router.post('/orders/:id/refund', requireAuth, RefundController.refundSubmit);
router.post('/admin/orders/:id/refund-approve', requireAuth, requireRole('admin'), RefundController.adminApprove);
router.post('/admin/orders/:id/refund-reject', requireAuth, requireRole('admin'), RefundController.adminReject);

// Invoice
router.get('/invoice/session', requireAuth, InvoiceController.invoiceFromSession);

module.exports = router;
