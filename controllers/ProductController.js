/* I will not copy or allow others to copy my code. 
 I understand that copying code is considered as plagiarism.
 
 Student Name: nate
 Student ID: 24025215
 Class: C372-003-E63C
 Date created: 1/2/2026
  */
const Product = require('../models/Product');
const Review = require('../models/Review');
const db = require('../db');
const { logAdminActivity } = require('../services/adminActivity');

const LOW_STOCK_THRESHOLD = 10;
const SELLER_PENDING_MESSAGE = 'Seller verification requires approved KYC and an active account.';

const runQuery = (sql, params = []) => new Promise((resolve, reject) => {
  db.query(sql, params, (err, rows) => {
    if (err) return reject(err);
    return resolve(rows || []);
  });
});

const getTableColumns = async (tableName) => {
  const rows = await runQuery(
    `
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = ?
    `,
    [tableName]
  );
  return new Set((rows || []).map(r => String(r.COLUMN_NAME || '').toLowerCase()));
};

const ensureSellerVerified = async (req) => {
  const user = req.session ? req.session.user : null;
  if (!user) return { allowed: false, reason: 'Please sign in first.' };
  if (user.role === 'admin') {
    return { allowed: true, listingStatus: 'APPROVED', authenticityStatus: 'VERIFIED' };
  }
  const rows = await runQuery(
    `
      SELECT isBanned, kycStatus
      FROM users
      WHERE id = ?
      LIMIT 1
    `,
    [user.id]
  );
  const row = rows && rows[0] ? rows[0] : null;
  if (!row) return { allowed: false, reason: 'Seller account not found.' };
  const isBanned = row.isBanned === 1 || row.isBanned === '1' || row.isBanned === true;
  if (isBanned || row.kycStatus !== 'VERIFIED') {
    return { allowed: false, reason: SELLER_PENDING_MESSAGE };
  }
  return { allowed: true, listingStatus: 'PENDING', authenticityStatus: 'PENDING' };
};

/**
 * ProductController (function-based)
 * Methods accept (req, res) and call the Product model methods.
 * Behavior is intentionally simple: render views or redirect to inventory on success.
 */

const ProductController = {
  // Admin inventory
  inventory(req, res) {
    Product.getAll((err, products) => {
      if (err) {
        console.error('Error fetching products:', err);
        return res.status(500).send('Database error');
      }
      const user = req.session ? req.session.user : null;
      const lowStockProducts = (products || []).filter(p => {
        const qty = Number(p.quantity) || 0;
        return qty <= LOW_STOCK_THRESHOLD;
      });
      Review.getStatsByProduct((revErr, statsMap) => {
        if (revErr) {
          console.error('Error fetching review stats:', revErr);
          return res.status(500).send('Database error');
        }
        return res.render('inventory', {
          products,
          user,
          lowStockProducts,
          lowStockThreshold: LOW_STOCK_THRESHOLD,
          reviewStatsMap: statsMap
        });
      });
    });
  },

  // Shopping (user view)
  shopping(req, res) {
    const user = req.session ? req.session.user : null;
    const rawQuery = (req.query && typeof req.query.q === 'string') ? req.query.q.trim() : '';
    const rawCategory = (req.query && typeof req.query.category === 'string') ? req.query.category.trim() : '';
    const rawRarity = (req.query && typeof req.query.rarity === 'string') ? req.query.rarity.trim() : '';
    const rawMinPrice = (req.query && typeof req.query.minPrice === 'string') ? req.query.minPrice.trim() : '';
    const rawMaxPrice = (req.query && typeof req.query.maxPrice === 'string') ? req.query.maxPrice.trim() : '';
    const rawSort = (req.query && typeof req.query.sort === 'string') ? req.query.sort.trim() : '';

    let minPrice = rawMinPrice === '' ? null : Number(rawMinPrice);
    let maxPrice = rawMaxPrice === '' ? null : Number(rawMaxPrice);
    if (!Number.isFinite(minPrice)) minPrice = null;
    if (!Number.isFinite(maxPrice)) maxPrice = null;
    if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) {
      const tmp = minPrice;
      minPrice = maxPrice;
      maxPrice = tmp;
    }

    (async () => {
      try {
        const productCols = await getTableColumns('products');
        const hasDescription = productCols.has('description');
        const hasCategory = productCols.has('category');
        const hasCreatedAt = productCols.has('created_at') || productCols.has('createdat');
        const hasSellerId = productCols.has('sellerid');
        const hasListingStatus = productCols.has('listingstatus');
        const hasAuthenticityStatus = productCols.has('authenticitystatus');

        let userCols = new Set();
        if (hasSellerId) {
          userCols = await getTableColumns('users');
        }
        const hasSellerStatus = userCols.has('sellerstatus');
        const hasIsBanned = userCols.has('isbanned');

        const where = [];
        const params = [];
        if (rawQuery) {
          const like = `%${rawQuery.toLowerCase()}%`;
          if (hasDescription) {
            where.push('(LOWER(p.productName) LIKE ? OR LOWER(p.description) LIKE ?)');
            params.push(like, like);
          } else {
            where.push('LOWER(p.productName) LIKE ?');
            params.push(like);
          }
        }
        if (rawRarity) {
          where.push('LOWER(p.rarity) LIKE ?');
          params.push(`%${rawRarity.toLowerCase()}%`);
        }
        if (rawCategory) {
          if (hasCategory) {
            where.push('LOWER(p.category) LIKE ?');
            params.push(`%${rawCategory.toLowerCase()}%`);
          } else {
            where.push('LOWER(p.rarity) LIKE ?');
            params.push(`%${rawCategory.toLowerCase()}%`);
          }
        }
        if (minPrice !== null) {
          where.push('p.price >= ?');
          params.push(minPrice);
        }
        if (maxPrice !== null) {
          where.push('p.price <= ?');
          params.push(maxPrice);
        }
        if (hasListingStatus) {
          where.push("p.listingStatus = 'APPROVED'");
        }
        if (hasAuthenticityStatus) {
          where.push("p.authenticityStatus = 'VERIFIED'");
        }
        if (hasSellerId && hasSellerStatus) {
          where.push("s.sellerStatus = 'VERIFIED'");
        }
        if (hasSellerId && hasIsBanned) {
          where.push('(s.isBanned = 0 OR s.isBanned IS NULL)');
        }

        let sql = `SELECT p.* FROM products p ${hasSellerId ? 'LEFT JOIN users s ON s.id = p.sellerId' : ''}`;
        if (where.length) {
          sql += ` WHERE ${where.join(' AND ')}`;
        }
        if (rawSort === 'price_asc') {
          sql += ' ORDER BY p.price ASC';
        } else if (rawSort === 'price_desc') {
          sql += ' ORDER BY p.price DESC';
        } else if (rawSort === 'newest') {
          if (hasCreatedAt && productCols.has('created_at')) {
            sql += ' ORDER BY p.created_at DESC';
          } else if (hasCreatedAt && productCols.has('createdat')) {
            sql += ' ORDER BY p.createdAt DESC';
          } else {
            sql += ' ORDER BY p.id DESC';
          }
        }

        db.query(sql, params, (err, products) => {
          if (err) {
            console.error('Error fetching products:', err);
            return res.status(500).send('Database error');
          }
          Review.getStatsByProduct((revErr, statsMap) => {
            if (revErr) {
              console.error('Error fetching review stats:', revErr);
              return res.status(500).send('Database error');
            }
            const salesSql = `
              SELECT productId, SUM(quantity) AS sold
              FROM order_items
              GROUP BY productId
              ORDER BY sold DESC
              LIMIT 3
            `;
            db.query(salesSql, (salesErr, rows) => {
              if (salesErr) {
                console.error('Error fetching best sellers by sales:', salesErr);
              }
              const salesMap = new Map();
              (rows || []).forEach(r => salesMap.set(r.productId, Number(r.sold) || 0));
              const ranked = (products || [])
                .filter(p => salesMap.has(p.id))
                .sort((a, b) => (salesMap.get(b.id) || 0) - (salesMap.get(a.id) || 0));
              const bestSellers = ranked.slice(0, 3);
              const availableRarities = Array.from(
                new Set((products || []).map(p => (p.rarity || '').trim()).filter(Boolean))
              ).sort((a, b) => a.localeCompare(b));
              const availableCategories = Array.from(
                new Set((products || []).map(p => (p.category || '').trim()).filter(Boolean))
              ).sort((a, b) => a.localeCompare(b));
              const filters = {
                q: rawQuery,
                category: rawCategory,
                rarity: rawRarity,
                minPrice: rawMinPrice,
                maxPrice: rawMaxPrice,
                sort: rawSort
              };
              return res.render('shopping', {
                products,
                user,
                reviewStatsMap: statsMap,
                bestSellers,
                availableRarities,
                availableCategories,
                filters
              });
            });
          });
        });
      } catch (err) {
        console.error('Error building shopping view:', err);
        return res.status(500).send('Database error');
      }
    })();
  },

  // Get product by ID and render product view
  getById(req, res) {
    const id = req.params.id;
    Product.getById(id, (err, product) => {
      if (err) {
        console.error('Error fetching product:', err);
        return res.status(500).send('Database error');
      }
      if (!product) return res.status(404).send('Product not found');
      const user = req.session ? req.session.user : null;

      Review.getByProduct(id, (revErr, reviews) => {
        if (revErr) {
          console.error('Error fetching reviews:', revErr);
          return res.status(500).send('Database error');
        }
        Review.getStats(id, (statErr, stats) => {
          if (statErr) {
            console.error('Error fetching review stats:', statErr);
            return res.status(500).send('Database error');
          }
          return res.render('product', {
            product,
            user,
            reviews,
            reviewStats: stats,
            reviewErrors: req.flash('error'),
            reviewSuccess: req.flash('success')
          });
        });
      });
    });
  },

  addForm(req, res) {
    const user = req.session ? req.session.user : null;
    return res.render('addProduct', { user });
  },

  // Add a new product (expects multipart/form-data for image via multer)
  add(req, res) {
    (async () => {
      const user = req.session ? req.session.user : null;
      const sellerGate = await ensureSellerVerified(req);
      if (!sellerGate.allowed) {
        req.flash('error', sellerGate.reason || SELLER_PENDING_MESSAGE);
        return res.redirect('/inventory');
      }

      const { name, quantity, price, rarity, discountPercent } = req.body;
      const image = req.file ? req.file.filename : null;
      const parsedDiscount = discountPercent === '' || discountPercent === undefined ? null : Number(discountPercent);

      const product = {
        productName: name,
        quantity: quantity ? parseInt(quantity, 10) : 0,
        price: price ? parseFloat(price) : 0,
        discountPercent: Number.isFinite(parsedDiscount) ? parsedDiscount : null,
        image,
        rarity,
        sellerId: user ? user.id : null,
        listingStatus: sellerGate.listingStatus,
        authenticityStatus: sellerGate.authenticityStatus
      };

      Product.add(product, (err, result) => {
        if (err) {
          console.error('Error adding product:', err);
          return res.status(500).send('Database error');
        }
        logAdminActivity(req, 'PRODUCT_CREATE', 'product', result && result.insertId ? result.insertId : null, {
          name: product.productName,
          price: product.price
        });
        if (user && user.role !== 'admin') {
          req.flash('success', 'Listing submitted. Admin review is required before publication.');
        }
        return res.redirect('/inventory');
      });
    })().catch((err) => {
      console.error('Error validating seller listing access:', err);
      req.flash('error', 'Unable to validate seller account right now.');
      return res.redirect('/inventory');
    });
  },

  editForm(req, res) {
    const id = req.params.id;
    const viewer = req.session ? req.session.user : null;
    Product.getById(id, (err, product) => {
      if (err) {
        console.error('Error fetching product:', err);
        return res.status(500).send('Database error');
      }
      if (!product) return res.status(404).send('Product not found');
      if (viewer && viewer.role !== 'admin' && product.sellerId && Number(product.sellerId) !== Number(viewer.id)) {
        req.flash('error', 'You can only edit your own listings.');
        return res.redirect('/inventory');
      }
      return res.render('updateProduct', { product });
    });
  },

  // Update existing product
  update(req, res) {
    (async () => {
      const id = req.params.id;
      const viewer = req.session ? req.session.user : null;
      const sellerGate = await ensureSellerVerified(req);
      if (!sellerGate.allowed) {
        req.flash('error', sellerGate.reason || SELLER_PENDING_MESSAGE);
        return res.redirect('/inventory');
      }

      const existing = await runQuery('SELECT id, sellerId FROM products WHERE id = ? LIMIT 1', [id]);
      const target = existing && existing[0] ? existing[0] : null;
      if (!target) return res.status(404).send('Product not found');
      if (viewer && viewer.role !== 'admin' && target.sellerId && Number(target.sellerId) !== Number(viewer.id)) {
        req.flash('error', 'You can only edit your own listings.');
        return res.redirect('/inventory');
      }

      const { name, quantity, price, rarity, discountPercent } = req.body;
      let image = req.body.currentImage || null;
      if (req.file) image = req.file.filename;
      const parsedDiscount = discountPercent === '' || discountPercent === undefined ? null : Number(discountPercent);

      const product = {
        productName: name,
        quantity: quantity ? parseInt(quantity, 10) : 0,
        price: price ? parseFloat(price) : 0,
        discountPercent: Number.isFinite(parsedDiscount) ? parsedDiscount : null,
        image,
        rarity
      };

      if (viewer && viewer.role !== 'admin') {
        product.listingStatus = 'PENDING';
        product.authenticityStatus = 'PENDING';
      }

      Product.update(id, product, (err) => {
        if (err) {
          console.error('Error updating product:', err);
          return res.status(500).send('Database error');
        }
        logAdminActivity(req, 'PRODUCT_UPDATE', 'product', id, {
          name: product.productName,
          price: product.price
        });
        if (viewer && viewer.role !== 'admin') {
          req.flash('success', 'Update saved and sent for admin review.');
        }
        return res.redirect('/inventory');
      });
    })().catch((err) => {
      console.error('Error validating listing update:', err);
      req.flash('error', 'Unable to update listing right now.');
      return res.redirect('/inventory');
    });
  },

  // Delete a product
  delete(req, res) {
    (async () => {
      const id = req.params.id;
      const viewer = req.session ? req.session.user : null;
      const existing = await runQuery('SELECT id, sellerId FROM products WHERE id = ? LIMIT 1', [id]);
      const target = existing && existing[0] ? existing[0] : null;
      if (!target) return res.status(404).send('Product not found');
      if (viewer && viewer.role !== 'admin' && target.sellerId && Number(target.sellerId) !== Number(viewer.id)) {
        req.flash('error', 'You can only delete your own listings.');
        return res.redirect('/inventory');
      }
      Product.delete(id, (err) => {
        if (err) {
          console.error('Error deleting product:', err);
          return res.status(500).send('Database error');
        }
        logAdminActivity(req, 'PRODUCT_DELETE', 'product', id, {});
        return res.redirect('/inventory');
      });
    })().catch((err) => {
      console.error('Error deleting product:', err);
      return res.status(500).send('Database error');
    });
  },

  // Toggle product active status
  setActive(req, res) {
    const id = req.params.id;
    const isActive = req.body && req.body.isActive === 'true';
    Product.setActive(id, isActive, (err) => {
      if (err) {
        console.error('Error updating product status:', err);
        return res.status(500).send('Database error');
      }
      logAdminActivity(req, 'PRODUCT_SET_ACTIVE', 'product', id, { isActive });
      return res.redirect('/inventory');
    });
  },

  setListingStatus(req, res) {
    const id = req.params.id;
    const status = String((req.body && req.body.status) || '').trim().toUpperCase();
    if (!['PENDING', 'APPROVED', 'REJECTED'].includes(status)) {
      req.flash('error', 'Invalid listing status.');
      return res.redirect('/inventory');
    }
    const sql = `
      UPDATE products
      SET listingStatus = ?
      WHERE id = ?
    `;
    db.query(sql, [status, id], (err) => {
      if (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') {
          req.flash('error', 'Listing status fields are not available in this schema.');
          return res.redirect('/inventory');
        }
        console.error('Error updating listing status:', err);
        return res.status(500).send('Database error');
      }
      logAdminActivity(req, 'PRODUCT_LISTING_STATUS', 'product', id, { status });
      req.flash('success', `Listing status updated to ${status}.`);
      return res.redirect('/inventory');
    });
  },

  setAuthenticityStatus(req, res) {
    const id = req.params.id;
    const status = String((req.body && req.body.status) || '').trim().toUpperCase();
    if (!['PENDING', 'VERIFIED', 'REJECTED'].includes(status)) {
      req.flash('error', 'Invalid authenticity status.');
      return res.redirect('/inventory');
    }
    const sql = `
      UPDATE products
      SET authenticityStatus = ?
      WHERE id = ?
    `;
    db.query(sql, [status, id], (err) => {
      if (err) {
        if (err.code === 'ER_BAD_FIELD_ERROR') {
          req.flash('error', 'Authenticity status fields are not available in this schema.');
          return res.redirect('/inventory');
        }
        console.error('Error updating authenticity status:', err);
        return res.status(500).send('Database error');
      }
      logAdminActivity(req, 'PRODUCT_AUTH_STATUS', 'product', id, { status });
      req.flash('success', `Authenticity status updated to ${status}.`);
      return res.redirect('/inventory');
    });
  },

  // Add a review for a product
  postReview(req, res) {
    const productId = req.params.id;
    const user = req.session ? req.session.user : null;
    const { rating, comment } = req.body;
    const trimmedComment = (comment || '').trim();
    const parsedRating = parseInt(rating, 10);

    if (!user) {
      req.flash('error', 'You must be logged in to review a product.');
      return res.redirect(`/product/${productId}`);
    }

    if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
      req.flash('error', 'Rating must be between 1 and 5.');
      return res.redirect(`/product/${productId}`);
    }

    if (!trimmedComment || trimmedComment.length < 3) {
      req.flash('error', 'Comment must be at least 3 characters.');
      return res.redirect(`/product/${productId}`);
    }

    const review = {
      productId,
      userId: user.id,
      name: user.username || 'Anonymous',
      rating: parsedRating,
      comment: trimmedComment.slice(0, 500) // cap length
    };

    Review.add(review, (err) => {
      if (err) {
        console.error('Error adding review:', err);
        req.flash('error', 'Could not submit review. Please try again.');
        return res.redirect(`/product/${productId}`);
      }
      req.flash('success', 'Thanks for your review!');
      return res.redirect(`/product/${productId}`);
    });
  },

  // Delete a review (admin or owner)
  deleteReview(req, res) {
    const productId = req.params.id;
    const reviewId = req.params.reviewId;
    const user = req.session ? req.session.user : null;

    if (!user) {
      req.flash('error', 'You must be logged in to delete a review.');
      return res.redirect(`/product/${productId}`);
    }

    Review.getById(reviewId, (err, review) => {
      if (err) {
        console.error('Error fetching review:', err);
        req.flash('error', 'Could not delete review.');
        return res.redirect(`/product/${productId}`);
      }
      if (!review) {
        req.flash('error', 'Review not found.');
        return res.redirect(`/product/${productId}`);
      }
      const isOwner = review.userId && user.id === review.userId;
      const isAdmin = user.role === 'admin';
      if (!isOwner && !isAdmin) {
        req.flash('error', 'You can only delete your own reviews.');
        return res.redirect(`/product/${productId}`);
      }
      Review.deleteById(reviewId, (delErr) => {
        if (delErr) {
          console.error('Error deleting review:', delErr);
          req.flash('error', 'Could not delete review.');
        } else {
          req.flash('success', 'Review deleted.');
        }
        return res.redirect(`/product/${productId}`);
      });
    });
  }
};

module.exports = ProductController;
