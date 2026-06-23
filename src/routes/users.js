const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const ctrl = require('../controllers/userController');

router.get('/me', authenticate, ctrl.getMe);
router.put('/me', authenticate, ctrl.updateMe);
router.put('/me/location', authenticate, ctrl.updateLocation);
router.post('/me/phone/send-code', authenticate, ctrl.sendPhoneCode);
router.post('/me/phone/verify', authenticate, ctrl.verifyPhoneCode);
router.get('/me/activity', authenticate, ctrl.getMyActivity);
router.get('/me/favorites', authenticate, ctrl.getFavoriteTechnicians);
router.post('/me/favorites', authenticate, ctrl.toggleFavorite);
router.get('/nearby-technicians', authenticate, ctrl.getNearbyTechnicians);
router.get('/top-technicians', authenticate, ctrl.getTopTechnicians);
router.get('/:id', authenticate, ctrl.getPublicProfile);
router.get('/:id/portfolio', authenticate, ctrl.getTechnicianPortfolio);
router.post('/me/portfolio', authenticate, ctrl.addPortfolioItem);
router.delete('/me/portfolio/:itemId', authenticate, ctrl.deletePortfolioItem);

module.exports = router;
