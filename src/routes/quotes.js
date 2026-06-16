const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/quoteController');

router.post('/', authenticate, ctrl.sendQuote);
router.get('/my', authenticate, ctrl.getMyQuotes);
router.get('/client', authenticate, ctrl.getQuotesForClient);
router.get('/request/:requestId', authenticate, ctrl.getQuotesForRequest);
router.put('/:id/accept', authenticate, ctrl.acceptQuote);
router.put('/:id/reject', authenticate, ctrl.rejectQuote);

module.exports = router;
