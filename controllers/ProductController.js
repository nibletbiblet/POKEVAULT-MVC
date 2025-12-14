const Product = require('../models/Product');
const Review = require('../models/Review');
const db = require('../db');

const LOW_STOCK_THRESHOLD = 10;

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
    Product.getAll((err, products) => {
      if (err) {
        console.error('Error fetching products:', err);
        return res.status(500).send('Database error');
      }
      const user = req.session ? req.session.user : null;
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
          return res.render('shopping', { products, user, reviewStatsMap: statsMap, bestSellers });
        });
      });
    });
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
    const { name, quantity, price, rarity, discountPercent } = req.body;
    const image = req.file ? req.file.filename : null;
    const parsedDiscount = discountPercent === '' || discountPercent === undefined ? null : Number(discountPercent);

    const product = {
      productName: name,
      quantity: quantity ? parseInt(quantity, 10) : 0,
      price: price ? parseFloat(price) : 0,
      discountPercent: Number.isFinite(parsedDiscount) ? parsedDiscount : null,
      image,
      rarity
    };

    Product.add(product, (err, result) => {
      if (err) {
        console.error('Error adding product:', err);
        return res.status(500).send('Database error');
      }
      return res.redirect('/inventory');
    });
  },

  editForm(req, res) {
    const id = req.params.id;
    Product.getById(id, (err, product) => {
      if (err) {
        console.error('Error fetching product:', err);
        return res.status(500).send('Database error');
      }
      if (!product) return res.status(404).send('Product not found');
      return res.render('updateProduct', { product });
    });
  },

  // Update existing product
  update(req, res) {
    const id = req.params.id;
    const { name, quantity, price, rarity, discountPercent } = req.body;
    // If a new file was uploaded, use it; otherwise keep currentImage (sent from form)
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

    Product.update(id, product, (err, result) => {
      if (err) {
        console.error('Error updating product:', err);
        return res.status(500).send('Database error');
      }
      return res.redirect('/inventory');
    });
  },

  // Delete a product
  delete(req, res) {
    const id = req.params.id;
    Product.delete(id, (err, result) => {
      if (err) {
        console.error('Error deleting product:', err);
        return res.status(500).send('Database error');
      }
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
