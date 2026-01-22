const express = require('express');
const TradeController = require('../controllers/TradeController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/trades', requireAuth, TradeController.list);
router.get('/my-trades', requireAuth, TradeController.myTradesPage);
router.get('/trade-chat', requireAuth, TradeController.chatPage);
router.get('/trades/all', requireAuth, TradeController.listAll);
router.post('/trades', requireAuth, TradeController.create);
router.post('/trades/:id/offer', requireAuth, TradeController.offer);
router.post('/trades/:id/accept', requireAuth, TradeController.accept);
router.post('/trades/:id/decline', requireAuth, TradeController.decline);
router.post('/trades/:id/cancel', requireAuth, TradeController.cancel);
router.post('/trades/:id/messages', requireAuth, TradeController.addMessage);
router.post('/trades/:id/meeting-proposals', requireAuth, TradeController.proposeMeeting);
router.post('/trades/:id/meeting-proposals/:proposalId/respond', requireAuth, TradeController.respondMeeting);

module.exports = router;
