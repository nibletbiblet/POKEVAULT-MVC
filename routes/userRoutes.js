const express = require('express');
const UserController = require('../controllers/UserController');
const { checkAuthenticated } = require('../middleware/auth');

const router = express.Router();

router.get('/register', UserController.registerForm);
router.post('/register', UserController.register);

router.get('/login', UserController.loginForm);
router.post('/login', UserController.login);

router.get('/logout', checkAuthenticated, UserController.logout);

module.exports = router;
