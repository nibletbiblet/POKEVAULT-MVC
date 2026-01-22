const Trade = require('../models/Trade');
const Product = require('../models/Product');
const Notification = require('../models/Notification');
const TradeMessage = require('../models/TradeMessage');
const TradeMeeting = require('../models/TradeMeeting');

// Utility to promisify a simple callback-style model method
const toPromise = (fn, ...args) =>
  new Promise((resolve, reject) =>
    fn(...args, (err, res) => (err ? reject(err) : resolve(res)))
  );

const groupByTradeId = (items) =>
  items.reduce((acc, item) => {
    if (!acc[item.trade_id]) acc[item.trade_id] = [];
    acc[item.trade_id].push(item);
    return acc;
  }, {});

const normalizeDateTime = (value) => {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const normalized = trimmed.replace('T', ' ');
  return normalized.length === 16 ? `${normalized}:00` : normalized;
};

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
      const acceptedTradeIds = myTrades.filter(t => t.status === 'accepted').map(t => t.id);
      const [messagesList, proposalsList] = await Promise.all([
        toPromise(TradeMessage.listForTradeIds, acceptedTradeIds),
        toPromise(TradeMeeting.listForTradeIds, acceptedTradeIds)
      ]);
      const messagesByTradeId = groupByTradeId(messagesList);
      const proposalsByTradeId = groupByTradeId(proposalsList);
      res.render('trades', {
        user,
        myTrades,
        openTrades,
        products,
        messages,
        errors,
        messagesByTradeId,
        proposalsByTradeId
      });
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
      const result = await toPromise(Trade.create, { initiatorId: user.id, initiatorProductId: productId, note });
      const tradeId = result && result.insertId ? result.insertId : null;
      await toPromise(Notification.createGlobal, {
        type: 'trade_posted',
        message: `${user.username} posted a new trade.`,
        tradeId
      });
      const io = req.app.get('io');
      if (io) {
        io.to('global').emit('notification:global', {
          type: 'trade_posted',
          message: `${user.username} posted a new trade.`,
          tradeId,
          created_at: new Date().toISOString()
        });
      }
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
    const redirectTo = req.get('referer') || '/trades';
    if (!productId) {
      req.flash('error', 'Select a card to offer.');
      return res.redirect(redirectTo);
    }
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade || trade.status !== 'open') {
        req.flash('error', 'Trade is no longer available.');
        return res.redirect(redirectTo);
      }
      if (trade.initiator_id === user.id) {
        req.flash('error', 'You cannot offer on your own trade.');
        return res.redirect(redirectTo);
      }
      const result = await toPromise(Trade.offer, {
        tradeId,
        responderId: user.id,
        responderProductId: productId,
        note
      });
      if (!result || result.affectedRows === 0) {
        req.flash('error', 'Someone is already trading this card.');
        return res.redirect(redirectTo);
      }
      await toPromise(Notification.createUser, {
        userId: trade.initiator_id,
        type: 'trade_offer',
        message: `${user.username} sent you a trade offer.`,
        tradeId: trade.id
      });
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${trade.initiator_id}`).emit('notification:user', {
          type: 'trade_offer',
          message: `${user.username} sent you a trade offer.`,
          tradeId: trade.id,
          created_at: new Date().toISOString()
        });
      }
      req.flash('success', 'Offer sent to the owner.');
    } catch (err) {
      console.error('Error offering trade:', err);
      req.flash('error', 'Could not send offer.');
    }
    return res.redirect(redirectTo);
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
      await Promise.all([
        toPromise(Notification.createUser, {
          userId: trade.initiator_id,
          type: 'trade_accepted',
          message: 'Your trade was accepted. Open chat to coordinate.',
          tradeId: trade.id
        }),
        trade.responder_id
          ? toPromise(Notification.createUser, {
              userId: trade.responder_id,
              type: 'trade_accepted',
              message: 'Your offer was accepted. Open chat to coordinate.',
              tradeId: trade.id
            })
          : Promise.resolve()
      ]);
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${trade.initiator_id}`).emit('notification:user', {
          type: 'trade_accepted',
          message: 'Your trade was accepted. Open chat to coordinate.',
          tradeId: trade.id,
          created_at: new Date().toISOString()
        });
        if (trade.responder_id) {
          io.to(`user:${trade.responder_id}`).emit('notification:user', {
            type: 'trade_accepted',
            message: 'Your offer was accepted. Open chat to coordinate.',
            tradeId: trade.id,
            created_at: new Date().toISOString()
          });
        }
      }
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
      if (trade.responder_id) {
        await toPromise(Notification.createUser, {
          userId: trade.responder_id,
          type: 'trade_declined',
          message: 'Your offer was declined.',
          tradeId: trade.id
        });
        const io = req.app.get('io');
        if (io) {
          io.to(`user:${trade.responder_id}`).emit('notification:user', {
            type: 'trade_declined',
            message: 'Your offer was declined.',
            tradeId: trade.id,
            created_at: new Date().toISOString()
          });
        }
      }
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
  },
  async listAll(req, res) {
    const user = req.session.user;
    const messages = req.flash('success');
    const errors = req.flash('error');
    try {
      const [trades, products] = await Promise.all([
        toPromise(Trade.listAll),
        toPromise(Product.getAll)
      ]);
      res.render('tradesAll', { user, trades, products, messages, errors });
    } catch (err) {
      console.error('Error loading all trades:', err);
      req.flash('error', 'Could not load trades right now.');
      res.redirect('/');
    }
  }
  ,
  async addMessage(req, res) {
    const user = req.session.user;
    const tradeId = req.params.id;
    const message = (req.body.message || '').trim();
    if (!message) return res.status(400).json({ ok: false, error: 'Message is required.' });
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade) return res.status(404).json({ ok: false, error: 'Trade not found.' });
      const isParticipant = trade.initiator_id === user.id || trade.responder_id === user.id;
      if (!isParticipant || trade.status !== 'accepted') {
        return res.status(403).json({ ok: false, error: 'Chat is only available after acceptance.' });
      }
      await toPromise(TradeMessage.add, { tradeId, senderId: user.id, message });
      const payload = {
        trade_id: Number(tradeId),
        sender_id: user.id,
        senderUsername: user.username,
        message,
        created_at: new Date().toISOString()
      };
      const io = req.app.get('io');
      if (io) io.to(`trade:${tradeId}`).emit('trade:message', payload);
      return res.json({ ok: true, message: payload });
    } catch (err) {
      console.error('Error adding message:', err);
      return res.status(500).json({ ok: false, error: 'Could not send message.' });
    }
  },

  async proposeMeeting(req, res) {
    const user = req.session.user;
    const tradeId = req.params.id;
    const proposedAt = normalizeDateTime(req.body.proposedAt);
    if (!proposedAt) return res.status(400).json({ ok: false, error: 'Date is required.' });
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade) return res.status(404).json({ ok: false, error: 'Trade not found.' });
      const isParticipant = trade.initiator_id === user.id || trade.responder_id === user.id;
      if (!isParticipant || trade.status !== 'accepted') {
        return res.status(403).json({ ok: false, error: 'Meeting proposals are available after acceptance.' });
      }
      const result = await toPromise(TradeMeeting.propose, {
        tradeId,
        proposerId: user.id,
        proposedAt
      });
      const proposal = {
        id: result.insertId,
        trade_id: Number(tradeId),
        proposer_id: user.id,
        proposerUsername: user.username,
        proposed_at: proposedAt,
        status: 'proposed',
        created_at: new Date().toISOString()
      };
      const otherUserId = trade.initiator_id === user.id ? trade.responder_id : trade.initiator_id;
      if (otherUserId) {
        await toPromise(Notification.createUser, {
          userId: otherUserId,
          type: 'meeting_proposed',
          message: `${user.username} proposed a meeting time.`,
          tradeId: trade.id
        });
      }
      const io = req.app.get('io');
      if (io) {
        io.to(`trade:${tradeId}`).emit('meeting:proposed', proposal);
        if (otherUserId) {
          io.to(`user:${otherUserId}`).emit('notification:user', {
            type: 'meeting_proposed',
            message: `${user.username} proposed a meeting time.`,
            tradeId: trade.id,
            created_at: new Date().toISOString()
          });
        }
      }
      return res.json({ ok: true, proposal });
    } catch (err) {
      console.error('Error proposing meeting:', err);
      return res.status(500).json({ ok: false, error: 'Could not propose meeting time.' });
    }
  },

  async respondMeeting(req, res) {
    const user = req.session.user;
    const tradeId = req.params.id;
    const proposalId = req.params.proposalId;
    const action = (req.body.action || '').toLowerCase();
    if (!['accepted', 'declined'].includes(action)) {
      return res.status(400).json({ ok: false, error: 'Invalid action.' });
    }
    try {
      const trade = await toPromise(Trade.findById, tradeId);
      if (!trade) return res.status(404).json({ ok: false, error: 'Trade not found.' });
      const isParticipant = trade.initiator_id === user.id || trade.responder_id === user.id;
      if (!isParticipant || trade.status !== 'accepted') {
        return res.status(403).json({ ok: false, error: 'Meeting responses are available after acceptance.' });
      }
      const proposal = await toPromise(TradeMeeting.getById, proposalId);
      if (!proposal || String(proposal.trade_id) !== String(tradeId)) {
        return res.status(404).json({ ok: false, error: 'Proposal not found.' });
      }
      await toPromise(TradeMeeting.respond, {
        proposalId,
        responderId: user.id,
        status: action
      });
      const payload = {
        id: Number(proposalId),
        trade_id: Number(tradeId),
        status: action,
        responded_by: user.id,
        responded_at: new Date().toISOString()
      };
      const io = req.app.get('io');
      if (io) io.to(`trade:${tradeId}`).emit('meeting:responded', payload);
      if (action === 'accepted') {
        const participants = [trade.initiator_id, trade.responder_id].filter(Boolean);
        await Promise.all(participants.map((participantId) =>
          toPromise(Notification.createUser, {
            userId: participantId,
            type: 'meeting_confirmed',
            message: 'Meeting time confirmed. Check trade chat for details.',
            tradeId: trade.id
          })
        ));
        if (io) {
          participants.forEach((participantId) => {
            io.to(`user:${participantId}`).emit('notification:user', {
              type: 'meeting_confirmed',
              message: 'Meeting time confirmed. Check trade chat for details.',
              tradeId: trade.id,
              created_at: new Date().toISOString()
            });
          });
        }
      }
      return res.json({ ok: true, proposal: payload });
    } catch (err) {
      console.error('Error responding to meeting:', err);
      return res.status(500).json({ ok: false, error: 'Could not update meeting.' });
    }
  },

  async myTradesPage(req, res) {
    const user = req.session.user;
    const messages = req.flash('success');
    const errors = req.flash('error');
    try {
      const [myTrades, openTrades, products, userNotifications, globalNotifications] = await Promise.all([
        toPromise(Trade.listForUser, user.id),
        toPromise(Trade.listOpenForOthers, user.id),
        toPromise(Product.getAll),
        toPromise(Notification.listForUser, user.id, 12),
        toPromise(Notification.listGlobal, 12)
      ]);
      const acceptedTradeIds = myTrades.filter(t => t.status === 'accepted').map(t => t.id);
      const [messagesList, proposalsList] = await Promise.all([
        toPromise(TradeMessage.listForTradeIds, acceptedTradeIds),
        toPromise(TradeMeeting.listForTradeIds, acceptedTradeIds)
      ]);
      const messagesByTradeId = groupByTradeId(messagesList);
      const proposalsByTradeId = groupByTradeId(proposalsList);
      res.render('myTrades', {
        user,
        myTrades,
        openTrades,
        products,
        userNotifications,
        globalNotifications,
        messagesByTradeId,
        proposalsByTradeId,
        messages,
        errors
      });
    } catch (err) {
      console.error('Error loading my trades page:', err);
      req.flash('error', 'Could not load trades right now.');
      res.redirect('/');
    }
  }
  ,
  async chatPage(req, res) {
    const user = req.session.user;
    const messages = req.flash('success');
    const errors = req.flash('error');
    try {
      const [myTrades] = await Promise.all([
        toPromise(Trade.listForUser, user.id)
      ]);
      const acceptedTradeIds = myTrades.filter(t => t.status === 'accepted').map(t => t.id);
      const [messagesList, proposalsList] = await Promise.all([
        toPromise(TradeMessage.listForTradeIds, acceptedTradeIds),
        toPromise(TradeMeeting.listForTradeIds, acceptedTradeIds)
      ]);
      const messagesByTradeId = groupByTradeId(messagesList);
      const proposalsByTradeId = groupByTradeId(proposalsList);
      res.render('tradeChat', {
        user,
        myTrades,
        messagesByTradeId,
        proposalsByTradeId,
        messages,
        errors
      });
    } catch (err) {
      console.error('Error loading trade chat:', err);
      req.flash('error', 'Could not load trade chat right now.');
      res.redirect('/my-trades');
    }
  }
};

module.exports = TradeController;
