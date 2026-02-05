/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG 
 Student ID: 24024323 
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const Order = require('../models/Order');
const RefundRequestModel = require('../models/RefundRequestModel');
const WalletModel = require('../models/WalletModel');
const Transaction = require('../models/Transaction');

const canRequestRefund = (status) => {
  if (!status) return true;
  return ['COMPLETED'].includes(status);
};

exports.refundPage = (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.user.id;
  const reason = req.query.reason || '';

  Order.getById(orderId, (err, order) => {
    if (err || !order) return res.status(404).send('Order not found');
    if (order.userId !== userId || !canRequestRefund(order.status)) {
      return res.status(403).send('Unauthorized');
    }
    RefundRequestModel.getByOrder(orderId, (err2, rows) => {
      if (!err2 && rows && rows.length) {
        if (rows[0].status === 'PENDING') {
          req.flash('error', 'Refund request already pending.');
          return res.redirect('/purchases?tab=PENDING');
        }
        if (rows[0].status === 'REJECTED') {
          req.flash('error', 'Refund request was rejected and cannot be requested again.');
          return res.redirect('/purchases?tab=COMPLETED');
        }
        if (rows[0].status === 'APPROVED') {
          req.flash('error', 'Refund request already approved.');
          return res.redirect('/purchases?tab=REFUND');
        }
      }

      Order.getItems(orderId, (err3, items) => {
        if (err3) return res.status(500).send('Failed to load items');
        res.render('orders/refundRequest', {
          order,
          items,
          reason,
          user: req.session.user
        });
      });
    });
  });
};

exports.refundSubmit = (req, res) => {
  const orderId = req.params.id;
  const userId = req.session.user.id;
  const reasonRaw = typeof req.body.reason === 'string' ? req.body.reason.trim() : '';
  const descriptionRaw = typeof req.body.description === 'string' ? req.body.description.trim() : '';
  const reason = reasonRaw;
  const description = descriptionRaw || null;

  Order.getById(orderId, (err, order) => {
    if (err || !order) return res.status(404).send('Order not found');
    if (order.userId !== userId || !canRequestRefund(order.status)) {
      return res.status(403).send('Unauthorized');
    }

    if (!reason) {
      req.flash('error', 'Refund reason is required.');
      return res.redirect(`/orders/${orderId}/refund`);
    }

    RefundRequestModel.getByOrder(orderId, (err2, rows) => {
      if (err2) return res.status(500).send('Failed to create refund request');
      if (rows && rows.length) {
        if (rows[0].status === 'PENDING') {
          req.flash('error', 'Refund request already pending.');
          return res.redirect('/orders');
        }
        if (rows[0].status === 'REJECTED') {
          req.flash('error', 'Refund request was rejected and cannot be requested again.');
          return res.redirect('/orders');
        }
        if (rows[0].status === 'APPROVED') {
          req.flash('error', 'Refund request already approved.');
          return res.redirect('/orders');
        }
      }

      RefundRequestModel.createRequest(orderId, userId, reason, description, err3 => {
        if (err3) return res.status(500).send('Failed to create refund request');

        Order.updateStatus(orderId, 'PENDING', err4 => {
          if (err4) return res.status(500).send('Failed to update order');
          req.flash('success', 'Refund request submitted.');
          res.redirect('/purchases?tab=PENDING');
        });
      });
    });
  });
};

exports.adminApprove = (req, res) => {
  const orderId = req.params.id;

  Order.getById(orderId, (err, order) => {
    if (err || !order) return res.status(404).send('Order not found');

    RefundRequestModel.getByOrder(orderId, (err2, rows) => {
      if (err2 || !rows.length) return res.status(404).send('Refund request not found');

      const request = rows[0];
      if (request.status !== 'PENDING') return res.redirect('/admin/orders-status');

      RefundRequestModel.updateStatus(request.id, 'APPROVED', err3 => {
        if (err3) return res.status(500).send('Failed to approve refund');

        Order.updateStatus(orderId, 'REFUND', err4 => {
          if (err4) return res.status(500).send('Failed to update order status');

          const refundAmount = Number(order.total);
          WalletModel.credit(order.userId, refundAmount, 'REFUND', `ORDER_${orderId}`, err5 => {
            if (err5) return res.status(500).send('Failed to refund PokeVault Pay');

            Transaction.create({
              orderId,
              method: 'REFUND',
              status: 'COMPLETED',
              reference: `REFUND_${orderId}`,
              amount: refundAmount
            }, () => res.redirect('/admin/orders-status'));
          });
        });
      });
    });
  });
};

exports.adminReject = (req, res) => {
  const orderId = req.params.id;
    RefundRequestModel.getByOrder(orderId, (err, rows) => {
    if (err || !rows.length) return res.status(404).send('Refund request not found');

    const request = rows[0];
    if (request.status !== 'PENDING') return res.redirect('/admin/orders-status');

    RefundRequestModel.updateStatus(request.id, 'REJECTED', err2 => {
      if (err2) return res.status(500).send('Failed to reject refund');

      Order.updateStatus(orderId, 'COMPLETED', err3 => {
        if (err3) return res.status(500).send('Failed to update order status');
        res.redirect('/admin/orders-status');
      });
    });
  });
};
