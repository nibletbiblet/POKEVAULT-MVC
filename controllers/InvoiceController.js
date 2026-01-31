const Order = require('../models/Order');

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
    res.render('invoice/session', {
      user,
      order: data.order,
      items: data.items,
      paymentInfo,
      breakdown
    });
  });
};
