const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { syncUser, updateFcmToken } = require('../controllers/authController');

router.post('/sync', authenticate, syncUser);
router.put('/fcm-token', authenticate, updateFcmToken);

module.exports = router;
