const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/chatController');

router.get('/:requestId/messages', authenticate, ctrl.getMessages);
router.post('/:requestId/messages', authenticate, ctrl.sendMessage);
router.put('/:requestId/read', authenticate, ctrl.markRead);

module.exports = router;
