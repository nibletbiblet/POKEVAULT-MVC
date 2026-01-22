const express = require('express');
const ProductController = require('../controllers/ProductController');
const { requireAuth, requireRole, requireMinRole } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.get('/inventory', requireAuth, requireMinRole('storekeeper'), ProductController.inventory);
router.get('/shopping', requireAuth, ProductController.shopping);
router.get('/product/:id', requireAuth, ProductController.getById);
router.post('/product/:id/reviews', requireAuth, ProductController.postReview);
router.post('/product/:id/reviews/:reviewId/delete', requireAuth, ProductController.deleteReview);

router.get('/addProduct', requireAuth, requireRole('admin'), ProductController.addForm);
router.post('/addProduct', requireAuth, requireRole('admin'), upload.single('image'), ProductController.add);

router.get('/updateProduct/:id', requireAuth, requireRole('admin'), ProductController.editForm);
router.post('/updateProduct/:id', requireAuth, requireRole('admin'), upload.single('image'), ProductController.update);

router.get('/deleteProduct/:id', requireAuth, requireMinRole('storekeeper'), ProductController.delete);
router.post('/products/:id/status', requireAuth, requireMinRole('storekeeper'), ProductController.setActive);

module.exports = router;
