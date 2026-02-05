const express = require('express');
const UserController = require('../controllers/UserController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.get('/register', UserController.registerForm);
router.post('/register', UserController.register);
router.get('/register/otp', UserController.registerOtpForm);
router.post('/register/otp', UserController.registerOtpVerify);
router.post('/register/otp/resend', UserController.registerOtpResend);

router.get('/login', UserController.loginForm);
router.post('/login', UserController.login);

router.get('/logout', requireAuth, UserController.logout);

module.exports = router;
