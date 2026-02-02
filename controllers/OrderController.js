/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: NGJINHENG ,nate
 Student ID: 24024323 ,24025215
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const Order = require('../models/Order');
const Product = require('../models/Product');
const Transaction = require('../models/Transaction');
const WalletModel = require('../models/WalletModel');
const CoinsModel = require('../models/CoinsModel');
const paypal = require('../services/paypal');
const { applyCoinsToOrder, creditCoins, getAppliedCoins } = require('../services/coinsHelper');
const Stripe = require('stripe');
const db = require('../db');

const GST_RATE = 0.09;
const DELIVERY_RATE = 0.15;
const STRIPE_SECRET =
  process.env.STRIPE_SECRET_KEY ||
  process.env.STRIPE_SECRET ||
  process.env['Stripe.apiKey'];
const stripe = STRIPE_SECRET ? Stripe(STRIPE_SECRET) : null;

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

const computeTotals = (cart, promo) => {
  const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const promoAmount = promo ? promo.amount : 0;
  const taxableBase = Math.max(0, subtotal - promoAmount);
  const gst = Number((taxableBase * GST_RATE).toFixed(2));
  const deliveryFee = Number((taxableBase * DELIVERY_RATE).toFixed(2));
  const total = Number((taxableBase + gst + deliveryFee).toFixed(2));
  return { subtotal, promoAmount, gst, deliveryFee, total };
};

const buildBaseUrl = (req) => `${req.protocol}://${req.get('host')}`;

const OrderController = {
  checkoutForm(req, res) {
    const cart = req.session.cart || [];
    const user = req.session.user;
    if (!cart.length) return res.redirect('/shopping');
    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const renderPage = (promoApplied) => {
      const totals = computeTotals(cart, promoApplied);
      const ensureBalances = (cb) => {
        WalletModel.ensureWallet(user.id, () => {
          CoinsModel.ensureCoins(user.id, () => cb());
        });
      };

      ensureBalances(() => {
        WalletModel.getBalance(user.id, (walletErr, walletBalance) => {
          if (walletErr) {
            console.error('Wallet balance error:', walletErr);
          }
          CoinsModel.getBalance(user.id, (coinsErr, coinsBalance) => {
            if (coinsErr) {
              console.error('Coins balance error:', coinsErr);
            }
            const applied = Math.min(
              Number(req.session.coinsApplied || 0),
              Number(coinsBalance || 0),
              Number(totals.total || 0)
            );
            res.render('checkout', {
              cart,
              subtotal: totals.subtotal,
              discount: totals.promoAmount,
              gst: totals.gst,
              deliveryFee: totals.deliveryFee,
              total: totals.total,
              coinsApplied: applied,
              coinsBalance: Number(coinsBalance || 0),
              walletBalance: Number(walletBalance || 0),
              gstRate: GST_RATE,
              deliveryRate: DELIVERY_RATE,
              user,
              messages: req.flash('error'),
              promoApplied
            });
          });
        });
      });
    };

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err) {
          console.error('Error validating promo:', err);
          req.flash('error', 'Could not validate promo code.');
          req.session.promoCode = null;
          return renderPage(null);
        }
        if (!promo) {
          req.flash('error', 'Promo code is invalid or expired.');
          req.session.promoCode = null;
          return renderPage(null);
        }
        req.session.promoCode = promo.code;
        req.session.promoAmount = promo.amount;
        return renderPage(promo);
      });
    } else {
      renderPage(null);
    }
  },

  placeOrder(req, res) {
    const cart = req.session.cart || [];
    const user = req.session.user;
    const address = (req.body.address || '').trim();
    const paymentMethod = req.body.paymentMethod || 'card';
    const bnplPlanMonths = Number(req.body.bnplPlan || 6);
    const cardName = (req.body.cardName || '').trim();
    const cardNumberRaw = (req.body.cardNumber || '').replace(/\D/g, '');
    const cardLast4 = cardNumberRaw ? cardNumberRaw.slice(-4) : null;

    const resumeOrderId = req.session.toPayOrderId;
    if (resumeOrderId) {
      return Order.getById(resumeOrderId, (err, existingOrder) => {
        if (err || !existingOrder) {
          console.error('Resume order not found:', err);
          req.session.toPayOrderId = null;
          return res.redirect('/checkout');
        }

        const completePayment = (netAmount) => {
          const paymentLabel = paymentMethod === 'cash' ? 'Cash on Delivery' : 'Card';
          const transactionData = {
            orderId: resumeOrderId,
            method: paymentMethod === 'cash' ? 'COD' : 'CARD',
            status: paymentMethod === 'cash' ? 'PENDING' : 'COMPLETED',
            reference: paymentMethod === 'cash' ? 'CASH_ON_DELIVERY' : (cardLast4 ? `CARD_${cardLast4}` : null),
            amount: Number(netAmount)
          };

          const desiredStatus = paymentMethod === 'cash' ? 'TO_PAY' : 'TO_SHIP';
          Order.updateStatus(resumeOrderId, desiredStatus, (statusErr) => {
            if (statusErr) {
              console.error('Error updating order status:', statusErr);
            }

            Transaction.create(transactionData, (txnErr) => {
              if (txnErr) {
                console.error('Error creating transaction:', txnErr);
              }

              if (paymentMethod !== 'cash') {
                creditCoins(user.id, netAmount, () => {});
              }

              req.session.orderPayments = req.session.orderPayments || {};
              req.session.orderPayments[resumeOrderId] = {
                method: paymentLabel,
                cardName: cardName || null,
                cardLast4: paymentMethod === 'card' ? cardLast4 : null,
                promo: null
              };

              req.session.cart = [];
              req.session.promoCode = null;
              req.session.promoAmount = null;
              req.session.coinsApplied = 0;
              req.session.toPayOrderId = null;
              return res.redirect(`/orders/${resumeOrderId}`);
            });
          });
        };

        if (paymentMethod === 'bnpl') {
          req.session.toPayOrderId = resumeOrderId;
          return req.session.save(() => res.redirect(`/bnpl/card?plan=${bnplPlanMonths}`));
        }
        if (paymentMethod === 'cash') {
          return completePayment(Number(existingOrder.total));
        }

        applyCoinsToOrder(req, user.id, resumeOrderId, Number(existingOrder.total), (coinsErr, netAmount) => {
          if (coinsErr) {
            req.flash('error', coinsErr.message || 'Failed to apply coins');
            return res.redirect('/checkout');
          }
          return completePayment(netAmount);
        });
      });
    }

    if (!cart.length) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/shopping');
    }

    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const finalizeOrder = (promoApplied) => {
      const totals = computeTotals(cart, promoApplied);
      const orderData = { userId: user.id, total: totals.total, address: address || null };

      Order.create(orderData, cart, (err, result) => {
        if (err) {
          console.error('Error creating order:', err);
          req.flash('error', err.message || 'Could not place order, please try again.');
          return res.redirect('/checkout');
        }
        const completePayment = (netAmount) => {
          const paymentLabel = paymentMethod === 'cash' ? 'Cash on Delivery' : 'Card';
          const transactionData = {
            orderId: result.orderId,
            method: paymentMethod === 'cash' ? 'COD' : 'CARD',
            status: paymentMethod === 'cash' ? 'PENDING' : 'COMPLETED',
            reference: paymentMethod === 'cash' ? 'CASH_ON_DELIVERY' : (cardLast4 ? `CARD_${cardLast4}` : null),
            amount: netAmount
          };

          Transaction.create(transactionData, (txnErr) => {
            if (txnErr) {
              console.error('Error creating transaction:', txnErr);
            }
            const desiredStatus = paymentMethod === 'cash' ? 'TO_PAY' : 'TO_SHIP';
            Order.updateStatus(result.orderId, desiredStatus, (statusErr) => {
              if (statusErr) {
                console.error('Error updating order status:', statusErr);
              }
              if (paymentMethod !== 'cash') {
                creditCoins(user.id, netAmount, () => {});
              }
              req.session.orderPayments = req.session.orderPayments || {};
              req.session.orderPayments[result.orderId] = {
                method: paymentLabel,
                cardName: cardName || null,
                cardLast4: paymentMethod === 'card' ? cardLast4 : null,
                promo: promoApplied ? { code: promoApplied.code, amount: promoApplied.amount } : null
              };
              req.session.cart = [];
              req.session.promoCode = null;
              req.session.promoAmount = null;
              req.session.coinsApplied = 0;
              return res.redirect(`/orders/${result.orderId}`);
            });
          });
        };

        if (paymentMethod === 'bnpl') {
          Order.updateStatus(result.orderId, 'TO_PAY', () => {
            req.session.toPayOrderId = result.orderId;
            req.session.lastOrderId = result.orderId;
            req.session.save(() => res.redirect(`/bnpl/card?plan=${bnplPlanMonths}`));
          });
          return;
        }
        if (paymentMethod === 'cash') {
          return completePayment(totals.total);
        }

        applyCoinsToOrder(req, user.id, result.orderId, totals.total, (coinsErr, netAmount) => {
          if (coinsErr) {
            req.flash('error', coinsErr.message || 'Failed to apply coins');
            return res.redirect('/checkout');
          }
          return completePayment(netAmount);
        });
      });
    };

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err) {
          console.error('Error validating promo during checkout:', err);
          req.flash('error', 'Could not validate promo code.');
          req.session.promoCode = null;
          return finalizeOrder(null);
        }
        if (!promo) {
          req.flash('error', 'Promo code is invalid or expired.');
          req.session.promoCode = null;
          return finalizeOrder(null);
        }
        finalizeOrder(promo);
      });
    } else {
      finalizeOrder(null);
    }
  },

  list(req, res) {
    const user = req.session.user;
    Order.getByUser(user.id, (err, orders) => {
      if (err) {
        console.error('Error fetching orders:', err);
        return res.status(500).send('Database error');
      }
      res.render('orders', { orders, user });
    });
  },

  applyCoins(req, res) {
    const user = req.session.user;
    const cart = req.session.cart || [];
    if (!cart.length) return res.redirect('/checkout');

    const useCoins = req.body.useCoins === '1';
    if (!useCoins) {
      req.session.coinsApplied = 0;
      return req.session.save(() => res.redirect('/checkout'));
    }

    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const applyWithPromo = (promoApplied) => {
      const totals = computeTotals(cart, promoApplied);
      CoinsModel.getBalance(user.id, (err, balance) => {
        if (err) {
          console.error(err);
          req.flash('error', 'Unable to apply coins.');
          return res.redirect('/checkout');
        }
        const applied = Math.min(Number(balance || 0), Number(totals.total || 0));
        req.session.coinsApplied = applied;
        req.session.save(() => res.redirect('/checkout'));
      });
    };

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err || !promo) return applyWithPromo(null);
        return applyWithPromo(promo);
      });
    } else {
      applyWithPromo(null);
    }
  },

  walletPay(req, res) {
    const user = req.session.user;
    const cart = req.session.cart || [];
    const address = (req.body.address || user.address || '').trim();

    if (!cart.length) {
      req.flash('error', 'Your cart is empty.');
      return res.redirect('/checkout');
    }

    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const finalize = (promoApplied) => {
      const totals = computeTotals(cart, promoApplied);
      const orderData = { userId: user.id, total: totals.total, address: address || null };

      Order.create(orderData, cart, (err, result) => {
        if (err) {
          console.error('Error creating wallet order:', err);
          req.flash('error', err.message || 'Could not place order, please try again.');
          return res.redirect('/checkout');
        }

        applyCoinsToOrder(req, user.id, result.orderId, totals.total, (coinsErr, netAmount) => {
          if (coinsErr) {
            req.flash('error', coinsErr.message || 'Failed to apply coins');
            return res.redirect('/checkout');
          }

          WalletModel.debit(user.id, netAmount, `ORDER_${result.orderId}`, (walletErr) => {
            if (walletErr) {
              req.flash('error', walletErr.message || 'Insufficient PokeVault Pay balance.');
              return res.redirect('/checkout');
            }

            Order.updateStatus(result.orderId, 'TO_SHIP', (statusErr) => {
              if (statusErr) {
                console.error('Error updating order status:', statusErr);
              }

              Transaction.create({
                orderId: result.orderId,
                method: 'WALLET',
                status: 'COMPLETED',
                reference: 'POKEVAULT_PAY',
                amount: netAmount
              }, () => {
                creditCoins(user.id, netAmount, () => {});
                req.session.orderPayments = req.session.orderPayments || {};
                req.session.orderPayments[result.orderId] = {
                  method: 'PokeVault Pay',
                  promo: promoApplied ? { code: promoApplied.code, amount: promoApplied.amount } : null
                };
                req.session.cart = [];
                req.session.promoCode = null;
                req.session.promoAmount = null;
                req.session.coinsApplied = 0;
                req.session.toPayOrderId = null;
                req.session.lastOrderId = result.orderId;
                req.session.save(() => res.redirect(`/orders/${result.orderId}`));
              });
            });
          });
        });
      });
    };

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err || !promo) return finalize(null);
        return finalize(promo);
      });
    } else {
      finalize(null);
    }
  },

  paypalCreate(req, res) {
    const cart = req.session.cart || [];
    const user = req.session.user;
    const amount = Number(req.body.amount);

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (!cart.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const ensureOrder = (promoApplied, done) => {
      if (req.session.toPayOrderId) return done(req.session.toPayOrderId);

      const totals = computeTotals(cart, promoApplied);
      const orderData = { userId: user.id, total: totals.total, address: (req.body.address || '').trim() || null };

      Order.create(orderData, cart, (err, result) => {
        if (err) return res.status(500).json({ error: 'Failed to create order' });
        Order.updateStatus(result.orderId, 'TO_PAY', () => {
          req.session.toPayOrderId = result.orderId;
          req.session.save(() => done(result.orderId));
        });
      });
    };

    const createPaypal = () => paypal.createOrder(amount).then(order => res.json({ id: order.id }));

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err) return createPaypal();
        ensureOrder(promo, () => createPaypal());
      });
    } else {
      ensureOrder(null, () => createPaypal());
    }
  },

  async paypalCapture(req, res) {
    try {
      const { orderID } = req.body;
      if (!orderID) {
        return res.status(400).json({ error: 'Missing PayPal orderID' });
      }

      const capture = await paypal.captureOrder(orderID);
      if (!capture || capture.status !== 'COMPLETED') {
        return res.status(400).json({ error: 'Payment not completed' });
      }

      const orderId = req.session.toPayOrderId;
      if (!orderId) {
        return res.status(400).json({ error: 'Missing TO_PAY order' });
      }

      Order.getById(orderId, (err, order) => {
        if (err || !order) {
          return res.status(404).json({ error: 'Order not found' });
        }

        const totalAmount = Number(order.total);
        applyCoinsToOrder(req, req.session.user.id, orderId, totalAmount, (err2, netAmount) => {
          if (err2) {
            return res.status(400).json({ error: err2.message || 'Failed to apply coins' });
          }

          Order.updateStatus(orderId, 'TO_SHIP', (err3) => {
            if (err3) {
              return res.status(500).json({ error: 'Failed to update order status' });
            }

            Transaction.create({
              orderId,
              method: 'PAYPAL',
              status: capture.status,
              reference: capture.id,
              amount: netAmount
            }, () => {
              creditCoins(req.session.user.id, netAmount, () => {});
              req.session.orderPayments = req.session.orderPayments || {};
              req.session.orderPayments[orderId] = {
                method: 'PayPal',
                promo: req.session.promoCode ? { code: req.session.promoCode, amount: req.session.promoAmount || 0 } : null
              };
              req.session.lastOrderId = orderId;
              req.session.toPayOrderId = null;
              req.session.coinsApplied = 0;
              req.session.promoCode = null;
              req.session.promoAmount = null;
              req.session.cart = [];
              req.session.save(() => res.json({
                success: true,
                orderId,
                redirectUrl: `/paypal/success?orderId=${orderId}`
              }));
            });
          });
        });
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: err.message });
    }
  },

  stripeCreateSession(req, res) {
    const cart = req.session.cart || [];
    const user = req.session.user;
    const address = (req.body.address || '').trim();

    if (!stripe) {
      return res.status(500).json({ error: 'Stripe is not configured.' });
    }
    if (!cart.length) {
      return res.status(400).json({ error: 'Cart is empty' });
    }

    const promoCode = req.session.promoCode || null;
    const subtotal = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const ensureOrder = (promoApplied, done) => {
      const totals = computeTotals(cart, promoApplied);
      if (req.session.toPayOrderId) {
        return done(req.session.toPayOrderId, totals, promoApplied);
      }

      const orderData = { userId: user.id, total: totals.total, address: address || null };
      Order.create(orderData, cart, (err, result) => {
        if (err) return res.status(500).json({ error: 'Failed to create order' });
        Order.updateStatus(result.orderId, 'TO_PAY', () => {
          req.session.toPayOrderId = result.orderId;
          req.session.save(() => done(result.orderId, totals, promoApplied));
        });
      });
    };

    const createSession = (orderId, totals, promoApplied) => {
      getAppliedCoins(req, user.id, totals.total, async (coinsErr, coinsApplied) => {
        if (coinsErr) {
          return res.status(500).json({ error: 'Failed to apply coins' });
        }

        const lineItems = (cart || [])
          .map((item) => {
            const unitAmount = Math.round(Number(item.price) * 100);
            const quantity = Math.max(1, Number(item.quantity) || 1);
            if (!unitAmount || unitAmount < 1) return null;
            return {
              price_data: {
                currency: 'sgd',
                product_data: {
                  name: item.productName || 'Item'
                },
                unit_amount: unitAmount
              },
              quantity
            };
          })
          .filter(Boolean);

        if (!lineItems.length) {
          return res.status(400).json({ error: 'Unable to build Stripe line items.' });
        }

        if (totals.gst > 0) {
          lineItems.push({
            price_data: {
              currency: 'sgd',
              product_data: { name: 'GST' },
              unit_amount: Math.round(totals.gst * 100)
            },
            quantity: 1
          });
        }
        if (totals.deliveryFee > 0) {
          lineItems.push({
            price_data: {
              currency: 'sgd',
              product_data: { name: 'Delivery Fee' },
              unit_amount: Math.round(totals.deliveryFee * 100)
            },
            quantity: 1
          });
        }

        const lineItemsTotalCents = lineItems.reduce(
          (sum, item) => sum + item.price_data.unit_amount * item.quantity,
          0
        );
        const payableTotal = Math.max(0, Number((totals.total - coinsApplied).toFixed(2)));
        const payableCents = Math.round(payableTotal * 100);
        if (payableCents <= 0) {
          return res.status(400).json({ error: 'Total payable must be greater than zero.' });
        }

        const discountCents = Math.max(0, lineItemsTotalCents - payableCents);
        const paymentMethodsRaw = (process.env.STRIPE_PAYMENT_METHODS || '').trim();
        const paymentMethodsLower = paymentMethodsRaw.toLowerCase();
        const paymentMethodTypes = paymentMethodsRaw && !['auto', 'all', 'default'].includes(paymentMethodsLower)
          ? paymentMethodsRaw.split(',').map((val) => val.trim()).filter(Boolean)
          : null;

        try {
          const discounts = [];
          if (discountCents > 0) {
            const coupon = await stripe.coupons.create({
              amount_off: discountCents,
              currency: 'sgd',
              duration: 'once',
              name: 'Promo/Coins Discount'
            });
            discounts.push({ coupon: coupon.id });
          }

          const sessionParams = {
            mode: 'payment',
            line_items: lineItems,
            discounts: discounts.length ? discounts : undefined,
            success_url: `${buildBaseUrl(req)}/stripe/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${buildBaseUrl(req)}/stripe/cancel`,
            customer_email: user.email || undefined,
            client_reference_id: String(orderId),
            metadata: {
              orderId: String(orderId),
              userId: String(user.id),
              promoCode: promoApplied ? promoApplied.code : '',
              coinsApplied: String(coinsApplied || 0)
            }
          };
          if (paymentMethodTypes && paymentMethodTypes.length) {
            sessionParams.payment_method_types = paymentMethodTypes;
          }

          const session = await stripe.checkout.sessions.create(sessionParams);
          return res.json({ id: session.id, url: session.url });
        } catch (err) {
          console.error('Stripe session error:', err);
          return res.status(500).json({ error: 'Failed to start Stripe checkout.' });
        }
      });
    };

    if (promoCode) {
      validatePromo(promoCode, subtotal, (err, promo) => {
        if (err) return ensureOrder(null, createSession);
        return ensureOrder(promo, createSession);
      });
    } else {
      ensureOrder(null, createSession);
    }
  },

  async stripeSuccess(req, res) {
    const user = req.session.user;
    const sessionId = req.query.session_id;
    if (!stripe) {
      req.flash('error', 'Stripe is not configured.');
      return res.redirect('/checkout');
    }
    if (!sessionId) {
      req.flash('error', 'Missing Stripe session.');
      return res.redirect('/checkout');
    }

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (!session || session.payment_status !== 'paid') {
        req.flash('error', 'Stripe payment not completed.');
        return res.redirect('/checkout');
      }

      const orderId = session.metadata?.orderId || session.client_reference_id;
      if (!orderId) {
        req.flash('error', 'Order not found for this payment.');
        return res.redirect('/checkout');
      }

      Order.getById(orderId, (err, order) => {
        if (err || !order) {
          req.flash('error', 'Order not found.');
          return res.redirect('/checkout');
        }
        if (order.userId !== user.id) {
          return res.status(403).send('Access denied');
        }
        if (order.status && order.status !== 'TO_PAY') {
          return res.redirect(`/orders/${orderId}`);
        }

        const totalAmount = Number(order.total);
        applyCoinsToOrder(req, user.id, orderId, totalAmount, (coinsErr, netAmount) => {
          if (coinsErr) {
            req.flash('error', coinsErr.message || 'Failed to apply coins');
            return res.redirect('/checkout');
          }

          Order.updateStatus(orderId, 'TO_SHIP', (statusErr) => {
            if (statusErr) {
              console.error('Error updating order status:', statusErr);
            }

            Transaction.create({
              orderId,
              method: 'STRIPE',
              status: 'COMPLETED',
              reference: session.payment_intent || session.id,
              amount: netAmount
            }, () => {
              creditCoins(user.id, netAmount, () => {});
              req.session.orderPayments = req.session.orderPayments || {};
              req.session.orderPayments[orderId] = {
                method: 'Stripe Checkout',
                promo: req.session.promoCode ? { code: req.session.promoCode, amount: req.session.promoAmount || 0 } : null
              };
              req.session.lastOrderId = orderId;
              req.session.toPayOrderId = null;
              req.session.coinsApplied = 0;
              req.session.promoCode = null;
              req.session.promoAmount = null;
              req.session.cart = [];
              req.session.save(() => res.redirect(`/orders/${orderId}`));
            });
          });
        });
      });
    } catch (err) {
      console.error('Stripe success error:', err);
      req.flash('error', 'Stripe payment verification failed.');
      return res.redirect('/checkout');
    }
  },

  stripeCancel(req, res) {
    req.flash('error', 'Stripe checkout was canceled.');
    return res.redirect('/checkout');
  },

  resumeToPay(req, res) {
    const user = req.session.user;
    const orderId = req.params.id;

    Order.getWithItems(orderId, (err, data) => {
      if (err || !data) {
        return res.status(404).send('Order not found');
      }
      if (data.order.userId !== user.id) {
        return res.status(403).send('Access denied');
      }
      if (data.order.status !== 'TO_PAY') {
        return res.redirect('/purchases');
      }

      const cartItems = data.items.map(item => ({
        id: item.productId,
        productId: item.productId,
        productName: item.productName,
        rarity: item.rarity || null,
        price: Number(item.price),
        quantity: Number(item.quantity),
        image: item.image || null
      }));

      req.session.cart = cartItems;
      req.session.toPayOrderId = orderId;
      return res.redirect('/checkout');
    });
  },

  purchasesPage(req, res) {
    const user = req.session.user;
    const allowedTabs = ['TO_PAY', 'TO_SHIP', 'TO_RECEIVE', 'PENDING', 'COMPLETED', 'REFUND'];
    const activeTab = allowedTabs.includes(req.query.tab) ? req.query.tab : 'TO_SHIP';

    const sql = `
      SELECT o.id, o.total, o.createdAt, o.status,
             oi.productId, oi.productName, oi.image
      FROM orders o
      LEFT JOIN order_items oi ON oi.orderId = o.id
      WHERE o.userId = ? AND o.status = ?
      ORDER BY o.createdAt DESC, oi.id ASC
    `;

    db.query(sql, [user.id, activeTab], (err, rows) => {
      if (err) {
        console.error('Error fetching purchases:', err);
        return res.status(500).send('Database error');
      }

      const ordersById = new Map();
      rows.forEach(row => {
        if (!ordersById.has(row.id)) {
          ordersById.set(row.id, {
            id: row.id,
            total: Number(row.total),
            createdAt: row.createdAt,
            status: row.status || activeTab,
            items: []
          });
        }
        if (row.productId) {
          ordersById.get(row.id).items.push({
            productId: row.productId,
            productName: row.productName,
            image: row.image
          });
        }
      });

      const orders = Array.from(ordersById.values());
      res.render('purchases', { orders, user, activeTab });
    });
  },

  detail(req, res) {
    const user = req.session.user;
    const orderId = req.params.id;
    Order.getWithItems(orderId, (err, data) => {
      if (err) {
        console.error('Error fetching order detail:', err);
        return res.status(500).send('Database error');
      }
      if (!data) return res.status(404).send('Order not found');
      // Ensure user owns the order (simple check)
      if (data.order.userId !== user.id && user.role !== 'admin') {
        req.flash('error', 'Access denied');
        return res.redirect('/orders');
      }
      if (data.order.status === 'TO_PAY') {
        req.flash('error', 'Receipt is available after payment is completed.');
        return res.redirect('/purchases?tab=TO_PAY');
      }
      const basePaymentInfo = (req.session.orderPayments && req.session.orderPayments[data.order.id]) || null;
      const loadPaymentInfo = (cb) => {
        if (basePaymentInfo) return cb(null, basePaymentInfo);
        const sql = `
          SELECT paymentMethod, paymentReference
          FROM transactions
          WHERE orderId = ?
          ORDER BY id DESC
          LIMIT 1
        `;
        db.query(sql, [orderId], (txErr, rows) => {
          if (txErr || !rows || !rows.length) {
            const bnplSql = `
              SELECT COUNT(*) AS total
              FROM bnpl_installments
              WHERE order_id = ?
            `;
            return db.query(bnplSql, [orderId], (bnplErr, bnplRows) => {
              if (bnplErr || !bnplRows || !bnplRows.length) return cb(null, null);
              const isBnpl = Number(bnplRows[0].total || 0) > 0;
              if (!isBnpl) return cb(null, null);
              return cb(null, { method: 'BNPL' });
            });
          }
          const row = rows[0];
          cb(null, {
            method: row.paymentMethod || 'Payment captured',
            reference: row.paymentReference || null
          });
        });
      };

      loadPaymentInfo((_, paymentInfo) => {
        const promoInfo = paymentInfo && paymentInfo.promo ? paymentInfo.promo : null;
        const promoAmount = promoInfo ? Number(promoInfo.amount || 0) : 0;
        const subtotal = data.items.reduce((sum, it) => sum + Number(it.price) * Number(it.quantity), 0);
        const taxableBase = Math.max(0, subtotal - promoAmount);
        const gstRate = GST_RATE;
        const deliveryRate = DELIVERY_RATE;
        const gst = Number((taxableBase * gstRate).toFixed(2));
        const deliveryFee = Number((taxableBase * deliveryRate).toFixed(2));
        const total = Number((taxableBase + gst + deliveryFee).toFixed(2));
        res.render('orderDetail', {
          order: data.order,
          items: data.items,
          user,
          paymentInfo,
          breakdown: { subtotal, gstRate, deliveryRate, gst, deliveryFee, total, promoAmount, promoCode: promoInfo ? promoInfo.code : null }
        });
      });
    });
  }
  ,
  confirmReceived(req, res) {
    const user = req.session.user;
    const orderId = req.params.id;

    Order.getById(orderId, (err, order) => {
      if (err || !order) return res.status(404).send('Order not found');
      if (order.userId !== user.id) return res.status(403).send('Access denied');
      if (order.status !== 'TO_RECEIVE') {
        req.flash('error', 'Order is not ready to complete.');
        return res.redirect('/purchases?tab=TO_RECEIVE');
      }

      Order.updateStatus(orderId, 'COMPLETED', (err2) => {
        if (err2) return res.status(500).send('Failed to update order status');
        req.flash('success', 'Order marked as received.');
        return res.redirect('/purchases?tab=COMPLETED');
      });
    });
  }
};

module.exports = OrderController;
