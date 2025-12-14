const express = require('express');
const CartController = require('../controllers/CartController');
const { checkAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.get('/cart', checkAuthenticated, CartController.view);
router.post('/add-to-cart/:id', checkAuthenticated, CartController.add);
router.post('/remove-from-cart/:id', checkAuthenticated, CartController.remove);
router.post('/update-cart/:id', checkAuthenticated, CartController.update);
router.post('/clear-cart', checkAuthenticated, CartController.clear);

module.exports = router;
