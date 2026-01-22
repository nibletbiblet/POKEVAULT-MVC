const express = require('express');
const OrderController = require('../controllers/OrderController');
const PromoController = require('../controllers/PromoController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/checkout', requireAuth, OrderController.checkoutForm);
router.post('/checkout', requireAuth, OrderController.placeOrder);
router.post('/checkout/promo', requireAuth, PromoController.apply);
router.post('/checkout/promo/remove', requireAuth, PromoController.remove);
router.get('/orders', requireAuth, OrderController.list);
router.get('/orders/:id', requireAuth, OrderController.detail);

module.exports = router;
