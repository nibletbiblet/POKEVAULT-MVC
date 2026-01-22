const express = require('express');
const OrderController = require('../controllers/OrderController');
const PromoController = require('../controllers/PromoController');
const { checkAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.get('/checkout', checkAuthenticated, OrderController.checkoutForm);
router.post('/checkout', checkAuthenticated, OrderController.placeOrder);
router.post('/checkout/promo', checkAuthenticated, PromoController.apply);
router.post('/checkout/promo/remove', checkAuthenticated, PromoController.remove);
router.get('/orders', checkAuthenticated, OrderController.list);
router.get('/orders/:id', checkAuthenticated, OrderController.detail);

module.exports = router;
