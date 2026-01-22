const Trade = require('../models/Trade');
const Product = require('../models/Product');

// Utility to promisify a simple callback-style model method
const toPromise = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (err, res) => (err ? reject(err) : resolve(res)))
  );

const TradeController = {
  async list(req, res) {
    const user = req.session.user;
    const messages = req.flash('success');
    const errors = req.flash('error');
    try {
      const [myTrades, openTrades, products] = await Promise.all([
        toPromise(Trade.listForUser, user.id),
        toPromise(Trade.listOpenForOthers, user.id),
        toPromise(Product.getAll)
      ]);
      res.render('trades', { user, myTrades, openTrades, products, messages, errors });
    } catch (err) {
      console.error('Error loading trades:', err);
      req.flash('error', 'Could not load trades right now.');
      res.redirect('/');
    }
  },

  async create(req, res) {
    const user = req.session.user;
    const { productId, note } = req.body;
    if (!productId) {
      req.flash('error', 'Select a card to offer.');
      return res.redirect('/trades');
    }
    try {
      await toPromise(Trade.create, { initiatorId: user.id, initiatorProductId: productId, note });
      req.flash('success', 'Trade posted. Other collectors can now offer their cards.');
    } catch (err) {
      console.error('Error creating trade:', err);
      req.flash('error', 'Could not post trade.');
    }
    return res.redirect('/trades');
  },

  async offer(req, res) {
    const user = req.session.user;
    const tradeId = req.params.id;
    const { productId, note } = req.body;
    if (!productId) {
      req.flash('error', 'Select a card to offer.');
      return res.redirect('/trades');
    }
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade || trade.status !== 'open') {
        req.flash('error', 'Trade is no longer available.');
        return res.redirect('/trades');
      }
      if (trade.initiator_id === user.id) {
        req.flash('error', 'You cannot offer on your own trade.');
        return res.redirect('/trades');
      }
      await toPromise(Trade.offer, {
        tradeId,
        responderId: user.id,
        responderProductId: productId,
        note
      });
      req.flash('success', 'Offer sent to the owner.');
    } catch (err) {
      console.error('Error offering trade:', err);
      req.flash('error', 'Could not send offer.');
    }
    return res.redirect('/trades');
  },

  async accept(req, res) {
    const user = req.session.user;
    const tradeId = req.params.id;
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade) {
        req.flash('error', 'Trade not found.');
        return res.redirect('/trades');
      }
      if (trade.initiator_id !== user.id) {
        req.flash('error', 'Only the trade owner can accept.');
        return res.redirect('/trades');
      }
      if (trade.status !== 'pending_initiator') {
        req.flash('error', 'Trade is not awaiting your decision.');
        return res.redirect('/trades');
      }
      await toPromise(Trade.updateStatus, { tradeId, status: 'accepted' });
      req.flash('success', 'Trade accepted! Connect with the other collector to swap cards.');
    } catch (err) {
      console.error('Error accepting trade:', err);
      req.flash('error', 'Could not accept trade.');
    }
    return res.redirect('/trades');
  },

  async decline(req, res) {
    const user = req.session.user;
    const tradeId = req.params.id;
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade) {
        req.flash('error', 'Trade not found.');
        return res.redirect('/trades');
      }
      if (trade.initiator_id !== user.id) {
        req.flash('error', 'Only the trade owner can decline.');
        return res.redirect('/trades');
      }
      if (trade.status !== 'pending_initiator') {
        req.flash('error', 'Trade is not awaiting your decision.');
        return res.redirect('/trades');
      }
      await toPromise(Trade.updateStatus, { tradeId, status: 'declined' });
      req.flash('success', 'Offer declined.');
    } catch (err) {
      console.error('Error declining trade:', err);
      req.flash('error', 'Could not decline trade.');
    }
    return res.redirect('/trades');
  },

  async cancel(req, res) {
    const user = req.session.user;
    const tradeId = req.params.id;
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade) {
        req.flash('error', 'Trade not found.');
        return res.redirect('/trades');
      }
      if (trade.initiator_id !== user.id) {
        req.flash('error', 'Only the trade owner can cancel.');
        return res.redirect('/trades');
      }
      if (trade.status === 'accepted' || trade.status === 'declined') {
        req.flash('error', 'Completed trades cannot be cancelled.');
        return res.redirect('/trades');
      }
      await toPromise(Trade.updateStatus, { tradeId, status: 'cancelled' });
      req.flash('success', 'Trade cancelled.');
    } catch (err) {
      console.error('Error cancelling trade:', err);
      req.flash('error', 'Could not cancel trade.');
    }
    return res.redirect('/trades');
  }
};

module.exports = TradeController;
