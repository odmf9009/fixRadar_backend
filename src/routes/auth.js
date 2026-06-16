const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const {
  getPublicKey,
  sendVerification,
  registerWithEmail,
  loginWithEmail,
  syncUser,
  updateFcmToken,
} = require('../controllers/authController');

// Public endpoints (no auth required)
router.get('/public-key', getPublicKey);
router.post('/send-verification', sendVerification);
router.post('/register', registerWithEmail);
router.post('/login', loginWithEmail);

// Authenticated endpoints
router.post('/sync', authenticate, syncUser);
router.put('/fcm-token', authenticate, updateFcmToken);

module.exports = router;
