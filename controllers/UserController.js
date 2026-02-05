const bcrypt = require('bcrypt');
const crypto = require('crypto');
const mailer = require('../services/mailer');

const hashPassword = async (plain) => bcrypt.hash(plain, 10);
const sha1 = (plain) => crypto.createHash('sha1').update(plain).digest('hex');
const sha256 = (plain) => crypto.createHash('sha256').update(plain).digest('hex');
const OTP_TTL_MINUTES = Number(process.env.OTP_TTL_MINUTES || 10);
const OTP_RESEND_SECONDS = Number(process.env.OTP_RESEND_SECONDS || 60);
const OTP_MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS || 5);

const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

const maskEmail = (email) => {
  if (!email || typeof email !== 'string') return '';
  const [user, domain] = email.split('@');
  if (!domain) return email;
  const maskedUser = user.length <= 2
    ? `${user[0] || ''}*`
    : `${user[0]}${'*'.repeat(Math.max(1, user.length - 2))}${user[user.length - 1]}`;
  return `${maskedUser}@${domain}`;
};

const UserController = {
  registerForm(req, res) {
    if (req.session.pendingRegistration) {
      return res.redirect('/register/otp');
    }
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
  },

  async register(req, res) {
    const db = require('../db');
    const { username, email, password, address, contact, pdpaAccepted, adminKey } = req.body;
    const adminSignupKey = process.env.ADMIN_SIGNUP_KEY || 'admin';
    const normalizedAdminKey = typeof adminKey === 'string' ? adminKey.trim() : '';
    let role = 'user';

    if (normalizedAdminKey && normalizedAdminKey.length === 5 && normalizedAdminKey === adminSignupKey) {
      role = 'admin';
    }

    if (!username || !email || !password || !address || !contact) {
      req.flash('error', 'All fields are required.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }
    if (!pdpaAccepted) {
      req.flash('error', 'Please review and accept the PDPA notice to continue.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }
    if (password.length < 6) {
      req.flash('error', 'Password should be at least 6 or more characters long');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }

    let existingUsers = [];
    try {
      existingUsers = await new Promise((resolve, reject) => {
        db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [email], (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
    } catch (err) {
      console.error('Error checking existing email:', err);
      req.flash('error', 'Registration failed. Try again.');
      return res.redirect('/register');
    }

    if (existingUsers.length > 0) {
      req.flash('error', 'Email already registered. Please use another email.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }

    const passwordHash = await hashPassword(password);
    const otpCode = generateOtp();
    const otpHash = sha256(otpCode);
    const now = Date.now();
    req.session.pendingRegistration = {
      username,
      email,
      passwordHash,
      address,
      contact,
      role,
      otpHash,
      otpAttempts: 0,
      otpLastSentAt: now,
      otpExpiresAt: now + OTP_TTL_MINUTES * 60 * 1000
    };

    try {
      await mailer.sendMail({
        to: email,
        subject: 'PokeVault OTP Verification',
        text: `Your PokeVault OTP is ${otpCode}. It expires in ${OTP_TTL_MINUTES} minutes.`,
        html: `<p>Your PokeVault OTP is <strong>${otpCode}</strong>.</p><p>It expires in ${OTP_TTL_MINUTES} minutes.</p>`
      });
    } catch (mailErr) {
      console.error('OTP email failed:', mailErr);
      req.session.pendingRegistration = null;
      req.flash('error', 'Failed to send OTP email. Please try again.');
      req.flash('formData', req.body);
      return res.redirect('/register');
    }

    return res.redirect('/register/otp');
  },

  registerOtpForm(req, res) {
    const pending = req.session.pendingRegistration;
    if (!pending) {
      req.flash('error', 'Please register first.');
      return res.redirect('/register');
    }
    res.render('registerOtp', {
      messages: req.flash('error'),
      emailMasked: maskEmail(pending.email),
      resendSeconds: OTP_RESEND_SECONDS
    });
  },

  async registerOtpVerify(req, res) {
    const db = require('../db');
    const pending = req.session.pendingRegistration;
    const otp = String((req.body.otp || '')).trim();

    if (!pending) {
      req.flash('error', 'Please register first.');
      return res.redirect('/register');
    }
    if (!otp) {
      req.flash('error', 'Please enter the OTP.');
      return res.redirect('/register/otp');
    }
    if (Date.now() > Number(pending.otpExpiresAt || 0)) {
      req.session.pendingRegistration = null;
      req.flash('error', 'OTP expired. Please register again.');
      return res.redirect('/register');
    }
    if (Number(pending.otpAttempts || 0) >= OTP_MAX_ATTEMPTS) {
      req.session.pendingRegistration = null;
      req.flash('error', 'Too many attempts. Please register again.');
      return res.redirect('/register');
    }

    const isValid = sha256(otp) === pending.otpHash;
    if (!isValid) {
      pending.otpAttempts = Number(pending.otpAttempts || 0) + 1;
      req.session.pendingRegistration = pending;
      req.flash('error', 'Invalid OTP. Please try again.');
      return res.redirect('/register/otp');
    }

    try {
      const existingUsers = await new Promise((resolve, reject) => {
        db.query('SELECT id FROM users WHERE email = ? LIMIT 1', [pending.email], (err, rows) => {
          if (err) return reject(err);
          resolve(rows || []);
        });
      });
      if (existingUsers.length > 0) {
        req.session.pendingRegistration = null;
        req.flash('error', 'Email already registered. Please use another email.');
        return res.redirect('/register');
      }
    } catch (err) {
      console.error('Error rechecking email:', err);
      req.flash('error', 'Registration failed. Try again.');
      return res.redirect('/register');
    }

    const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, ?, ?, ?, ?)';
    db.query(
      sql,
      [
        pending.username,
        pending.email,
        pending.passwordHash,
        pending.address,
        pending.contact,
        pending.role
      ],
      (err) => {
        if (err) {
          console.error('Error registering user:', err);
          req.flash('error', 'Registration failed. Try again.');
          return res.redirect('/register');
        }
        req.session.pendingRegistration = null;
        req.flash('success', 'Registration successful! Please log in.');
        return res.redirect('/login');
      }
    );
  },

  async registerOtpResend(req, res) {
    const pending = req.session.pendingRegistration;
    if (!pending) {
      req.flash('error', 'Please register first.');
      return res.redirect('/register');
    }

    const now = Date.now();
    const last = Number(pending.otpLastSentAt || 0);
    if (now - last < OTP_RESEND_SECONDS * 1000) {
      req.flash('error', `Please wait ${OTP_RESEND_SECONDS} seconds before resending.`);
      return res.redirect('/register/otp');
    }

    const otpCode = generateOtp();
    pending.otpHash = sha256(otpCode);
    pending.otpAttempts = 0;
    pending.otpLastSentAt = now;
    pending.otpExpiresAt = now + OTP_TTL_MINUTES * 60 * 1000;
    req.session.pendingRegistration = pending;

    try {
      await mailer.sendMail({
        to: pending.email,
        subject: 'PokeVault OTP Verification',
        text: `Your new PokeVault OTP is ${otpCode}. It expires in ${OTP_TTL_MINUTES} minutes.`,
        html: `<p>Your new PokeVault OTP is <strong>${otpCode}</strong>.</p><p>It expires in ${OTP_TTL_MINUTES} minutes.</p>`
      });
    } catch (mailErr) {
      console.error('OTP resend failed:', mailErr);
      req.flash('error', 'Failed to resend OTP. Please try again.');
      return res.redirect('/register/otp');
    }

    req.flash('error', 'OTP resent. Please check your email.');
    return res.redirect('/register/otp');
  },

  loginForm(req, res) {
    res.render('login', { messages: req.flash('success'), errors: req.flash('error') });
  },

  login(req, res) {
    const db = require('../db');
    const { email, password } = req.body;

    if (!email || !password) {
      req.flash('error', 'All fields are required.');
      return res.redirect('/login');
    }

    const sql = 'SELECT * FROM users WHERE email = ? LIMIT 1';
    db.query(sql, [email], async (err, results) => {
      if (err) {
        console.error('Error logging in:', err);
        req.flash('error', 'Login failed.');
        return res.redirect('/login');
      }
      if (results.length === 0) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/login');
      }

      const user = results[0];
      let valid = false;
      if (user.password && user.password.startsWith('$2')) {
        valid = await bcrypt.compare(password, user.password);
      } else {
        valid = sha1(password) === user.password;
        if (valid) {
          try {
            const newHash = await hashPassword(password);
            db.query('UPDATE users SET password = ? WHERE id = ?', [newHash, user.id], () => {});
          } catch (hashErr) {
            console.warn('Could not upgrade password hash:', hashErr);
          }
        }
      }

      if (!valid) {
        req.flash('error', 'Invalid email or password.');
        return res.redirect('/login');
      }

      req.session.user = user;
      req.flash('success', `Welcome back, ${req.session.user.username}!`);
      if (user.role === 'admin') return res.redirect('/admin/dashboard');
      if (user.role === 'storekeeper') return res.redirect('/storekeeper/dashboard');
      return res.redirect('/shopping');
    });
  },

  logout(req, res) {
    req.session.destroy(() => res.redirect('/'));
  }
};

module.exports = UserController;
