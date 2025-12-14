const Product = require('../models/Product');
const applyDiscount = (product) => {
  const discount = product.discountPercent;
  if (discount === null || discount === undefined) return Number(product.price) || 0;
  const pct = Number(discount);
  if (!Number.isFinite(pct) || pct <= 0) return Number(product.price) || 0;
  return Number(product.price) * (1 - pct / 100);
};

const CartController = {
  view(req, res) {
    const cart = req.session.cart || [];
    const user = req.session ? req.session.user : null;
    res.render('cart', { cart, user });
  },

  add(req, res) {
    const productId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10) || 1;

    Product.getById(productId, (err, product) => {
      if (err || !product) {
        console.error('Error adding to cart:', err);
        return res.status(404).send('Product not found');
      }

      if (!req.session.cart) req.session.cart = [];
      const existing = req.session.cart.find(item => item.id === productId);
      if (existing) {
        existing.quantity += quantity;
        existing.rarity = product.rarity || product.category;
        existing.price = applyDiscount(product);
        existing.originalPrice = product.price;
        existing.discountPercent = product.discountPercent;
      } else {
        req.session.cart.push({
          id: product.id,
          productId: product.id,
          productName: product.productName,
          rarity: product.rarity || product.category,
          price: applyDiscount(product),
          originalPrice: product.price,
          discountPercent: product.discountPercent,
          quantity,
          image: product.image
        });
      }
      return res.redirect('/cart');
    });
  },

  remove(req, res) {
    const removeId = parseInt(req.params.id, 10);
    if (!req.session.cart || !Array.isArray(req.session.cart)) {
      return res.redirect('/cart');
    }
    req.session.cart = req.session.cart.filter(item => {
      const itemId = item.id !== undefined ? item.id : item.productId;
      return itemId !== removeId;
    });
    req.flash('success', 'Item removed from cart');
    return res.redirect('/cart');
  },

  update(req, res) {
    const updateId = parseInt(req.params.id, 10);
    const quantity = parseInt(req.body.quantity, 10);

    if (!req.session.cart || !Array.isArray(req.session.cart)) {
      return res.redirect('/cart');
    }
    if (!Number.isFinite(quantity) || quantity < 1) {
      req.flash('error', 'Quantity must be at least 1');
      return res.redirect('/cart');
    }

    const item = req.session.cart.find(entry => {
      const itemId = entry.id !== undefined ? entry.id : entry.productId;
      return itemId === updateId;
    });

    if (item) {
      item.quantity = quantity;
      req.flash('success', 'Cart updated');
    } else {
      req.flash('error', 'Item not found in cart');
    }
    return res.redirect('/cart');
  },

  clear(req, res) {
    req.session.cart = [];
    req.flash('success', 'Cart cleared');
    return res.redirect('/cart');
  }
};

module.exports = CartController;
