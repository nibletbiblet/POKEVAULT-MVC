/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: nate
 Student ID: 24025215
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const Order = require('../models/Order');
const BnplModel = require('../models/BnplModel');

const GST_RATE = 0.09;
const DELIVERY_RATE = 0.15;

const computeTotals = (items, promoAmount = 0) => {
  const subtotal = items.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
  const taxableBase = Math.max(0, subtotal - promoAmount);
  const gst = Number((taxableBase * GST_RATE).toFixed(2));
  const deliveryFee = Number((taxableBase * DELIVERY_RATE).toFixed(2));
  const total = Number((taxableBase + gst + deliveryFee).toFixed(2));
  return { subtotal, gst, deliveryFee, total, promoAmount, gstRate: GST_RATE, deliveryRate: DELIVERY_RATE };
};

exports.invoiceFromSession = (req, res) => {
  const orderId = req.session.lastOrderId;
  const user = req.session.user;
  if (!orderId) return res.redirect('/orders');

  Order.getWithItems(orderId, (err, data) => {
    if (err || !data) return res.status(404).send('Order not found');
    const paymentInfo = (req.session.orderPayments && req.session.orderPayments[data.order.id]) || null;
    const promoInfo = paymentInfo && paymentInfo.promo ? paymentInfo.promo : null;
    const promoAmount = promoInfo ? Number(promoInfo.amount || 0) : 0;
    const breakdown = computeTotals(data.items, promoAmount);
    const isBnpl = paymentInfo && typeof paymentInfo.method === 'string' && paymentInfo.method.startsWith('BNPL');
    if (!isBnpl) {
      return res.render('invoice/session', {
        user,
        order: data.order,
        items: data.items,
        paymentInfo,
        breakdown,
        bnplSummary: null
      });
    }

    BnplModel.getInstallmentsByOrder(data.order.id, (bnplErr, installments) => {
      if (bnplErr) {
        console.error('Error loading BNPL installments:', bnplErr);
      }
      const parsedMonths = (() => {
        const match = String(paymentInfo.method || '').match(/(\d+)/);
        return match ? Number(match[1]) : null;
      })();
      const months = (installments && installments.length) ? installments.length : (parsedMonths || 0);
      const total = Number(breakdown.total || data.order.total || 0);
      const perMonth = months > 0 ? Number((total / months).toFixed(2)) : 0;
      const paidToday = perMonth;
      const remaining = Number((total - paidToday).toFixed(2));

      return res.render('invoice/session', {
        user,
        order: data.order,
        items: data.items,
        paymentInfo,
        breakdown,
        bnplSummary: {
          months,
          perMonth,
          paidToday,
          remaining
        }
      });
    });
  });
};
