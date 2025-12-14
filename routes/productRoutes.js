const express = require('express');
const ProductController = require('../controllers/ProductController');
const { checkAuthenticated, checkAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');

const router = express.Router();

router.get('/inventory', checkAuthenticated, checkAdmin, ProductController.inventory);
router.get('/shopping', checkAuthenticated, ProductController.shopping);
router.get('/product/:id', checkAuthenticated, ProductController.getById);
router.post('/product/:id/reviews', checkAuthenticated, ProductController.postReview);
router.post('/product/:id/reviews/:reviewId/delete', checkAuthenticated, ProductController.deleteReview);

router.get('/addProduct', checkAuthenticated, checkAdmin, ProductController.addForm);
router.post('/addProduct', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.add);

router.get('/updateProduct/:id', checkAuthenticated, checkAdmin, ProductController.editForm);
router.post('/updateProduct/:id', checkAuthenticated, checkAdmin, upload.single('image'), ProductController.update);

router.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, ProductController.delete);

module.exports = router;
