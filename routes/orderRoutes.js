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
const OrderController = require('../controllers/OrderController');
const PromoController = require('../controllers/PromoController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/checkout', requireAuth, OrderController.checkoutForm);
router.post('/checkout', requireAuth, OrderController.placeOrder);
router.post('/checkout/coins', requireAuth, OrderController.applyCoins);
router.post('/checkout/wallet-pay', requireAuth, OrderController.walletPay);
router.post('/checkout/promo', requireAuth, PromoController.apply);
router.post('/checkout/promo/remove', requireAuth, PromoController.remove);
router.get('/purchases', requireAuth, OrderController.purchasesPage);
router.post('/api/paypal/create-order', requireAuth, OrderController.paypalCreate);
router.post('/api/paypal/capture-order', requireAuth, OrderController.paypalCapture);
router.post('/api/metamask/prepare', requireAuth, OrderController.metamaskPrepare);
router.post('/api/metamask/confirm', requireAuth, OrderController.metamaskConfirm);
router.post('/api/stripe/create-checkout-session', requireAuth, OrderController.stripeCreateSession);
router.get('/stripe/success', requireAuth, OrderController.stripeSuccess);
router.get('/stripe/cancel', requireAuth, OrderController.stripeCancel);
router.get('/orders', requireAuth, OrderController.list);
router.get('/orders/:id/resume', requireAuth, OrderController.resumeToPay);
router.get('/orders/:id', requireAuth, OrderController.detail);
router.post('/orders/:id/received', requireAuth, OrderController.confirmReceived);

module.exports = router;
