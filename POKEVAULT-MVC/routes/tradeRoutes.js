const express = require('express');
const TradeController = require('../controllers/TradeController');
const { checkAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.get('/trades', checkAuthenticated, TradeController.list);
router.post('/trades', checkAuthenticated, TradeController.create);
router.post('/trades/:id/offer', checkAuthenticated, TradeController.offer);
router.post('/trades/:id/accept', checkAuthenticated, TradeController.accept);
router.post('/trades/:id/decline', checkAuthenticated, TradeController.decline);
router.post('/trades/:id/cancel', checkAuthenticated, TradeController.cancel);

module.exports = router;
