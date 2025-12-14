const db = require('../db');
const { checkoutForm } = require('./OrderController'); // Not used, but kept to parallel structure if needed

const validatePromo = (code, subtotal, callback) => {
  if (!code) return callback(null, null);
  const sql = `
    SELECT id, code, discountType, discountValue, maxDiscount, minSubtotal, expiresAt, active
    FROM promo_codes
    WHERE code = ?
    LIMIT 1
  `;
  db.query(sql, [code], (err, rows) => {
    if (err) return callback(err);
    const promo = rows && rows[0] ? rows[0] : null;
    if (!promo || !promo.active) return callback(null, null);
    if (promo.expiresAt && new Date(promo.expiresAt) < new Date()) return callback(null, null);
    const minSubtotal = promo.minSubtotal != null ? Number(promo.minSubtotal) : 0;
    if (subtotal < minSubtotal) return callback(null, null);
    const value = Number(promo.discountValue);
    let discount = 0;
    if (promo.discountType === 'percent') {
      discount = subtotal * (value / 100);
    } else {
      discount = value;
    }
    if (promo.maxDiscount != null) {
      discount = Math.min(discount, Number(promo.maxDiscount));
    }
    discount = Math.min(discount, subtotal);
    return callback(null, { code: promo.code, amount: Number(discount.toFixed(2)) });
  });
};

const PromoController = {
  apply(req, res) {
    const cart = req.session.cart || [];
    const code = (req.body.promoCode || '').trim().toUpperCase();
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (!code) {
      req.session.promoCode = null;
      req.session.promoAmount = null;
      req.flash('success', 'Promo removed.');
      return res.redirect('/checkout');
    }
    validatePromo(code, subtotal, (err, promo) => {
      if (err) {
        console.error('Error validating promo:', err);
        req.flash('error', 'Could not apply promo code.');
        return res.redirect('/checkout');
      }
      if (!promo) {
        req.flash('error', 'Promo code is invalid, expired, or does not meet the subtotal requirement.');
        req.session.promoCode = null;
        req.session.promoAmount = null;
        return res.redirect('/checkout');
      }
      req.session.promoCode = promo.code;
      req.session.promoAmount = promo.amount;
      req.flash('success', `Promo applied: ${promo.code}`);
      return res.redirect('/checkout');
    });
  },

  remove(req, res) {
    req.session.promoCode = null;
    req.session.promoAmount = null;
    req.flash('success', 'Promo removed.');
    return res.redirect('/checkout');
  }
};

module.exports = PromoController;
