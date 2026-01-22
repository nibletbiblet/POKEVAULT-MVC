const express = require('express');
const CartController = require('../controllers/CartController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/cart', requireAuth, CartController.view);
router.post('/add-to-cart/:id', requireAuth, CartController.add);
router.post('/remove-from-cart/:id', requireAuth, CartController.remove);
router.post('/update-cart/:id', requireAuth, CartController.update);
router.post('/clear-cart', requireAuth, CartController.clear);

module.exports = router;
