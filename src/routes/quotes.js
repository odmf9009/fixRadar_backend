const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/quoteController');

router.post('/', authenticate, ctrl.sendQuote);
router.get('/my', authenticate, ctrl.getMyQuotes);
router.get('/client', authenticate, ctrl.getQuotesForClient);
router.get('/request/:requestId', authenticate, ctrl.getQuotesForRequest);
router.get('/technician/:id', authenticate, ctrl.getQuotesForTechnician);
router.put('/:id/accept', authenticate, ctrl.acceptQuote);
router.put('/:id/reject', authenticate, ctrl.rejectQuote);
router.put('/:id/counter-offer', authenticate, ctrl.counterOffer);
router.put('/:id/withdraw', authenticate, ctrl.withdrawQuote);
// Generic single-quote fetch — must stay AFTER the specific GET routes above
// so '/my', '/client', etc. are not captured by '/:id'.
router.get('/:id', authenticate, ctrl.getQuoteById);

module.exports = router;
