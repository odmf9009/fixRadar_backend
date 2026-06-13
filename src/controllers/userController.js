const User = require('../entities/User');
const Review = require('../entities/Review');
const Portfolio = require('../entities/Portfolio');
const Activity = require('../entities/Activity');

async function getMe(req, res, next) {
  try {
    const user = await User.findById(req.uid).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateMe(req, res, next) {
  try {
    const allowedFields = [
      'username', 'profileImageUrl', 'userType', 'role', 'onboardingCompleted',
      'specialties', 'bio', 'city', 'serviceRadius', 'companyName', 'yearsOfExperience',
      'freeQuote', 'emergencyService', 'workHours', 'weekendAvailability', 'phoneNumber',
      'isOnline', 'notificationsEnabled', 'presenceStatus',
    ];
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    const user = await User.findByIdAndUpdate(req.uid, update, { new: true }).lean();
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function updateLocation(req, res, next) {
  try {
    const { latitude, longitude } = req.body;
    await User.findByIdAndUpdate(req.uid, {
      location: { type: 'Point', coordinates: [longitude, latitude] },
      lastLocationUpdate: new Date(),
    });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getPublicProfile(req, res, next) {
  try {
    const user = await User.findById(req.params.id)
      .select('-email -fcmToken -referralCode -referredBy -pendingReferrals')
      .lean();
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    next(err);
  }
}

async function getNearbyTechnicians(req, res, next) {
  try {
    const { latitude, longitude, radius = 20, specialty } = req.query;
    if (!latitude || !longitude) {
      return res.status(400).json({ error: 'latitude and longitude are required' });
    }

    const filter = {
      userType: 'technician',
      isOnline: true,
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
          $maxDistance: parseFloat(radius) * 1000,
        },
      },
    };

    if (specialty) filter.specialties = specialty;

    const technicians = await User.find(filter)
      .select('-email -fcmToken -referralCode -referredBy')
      .limit(50)
      .lean();

    res.json(technicians);
  } catch (err) {
    next(err);
  }
}

async function getTopTechnicians(req, res, next) {
  try {
    const technicians = await User.find({ userType: 'technician', completedJobsCount: { $gt: 0 } })
      .sort({ rating: -1, completedJobsCount: -1 })
      .limit(50)
      .select('-email -fcmToken -referralCode -referredBy')
      .lean();
    res.json(technicians);
  } catch (err) {
    next(err);
  }
}

async function getTechnicianPortfolio(req, res, next) {
  try {
    const items = await Portfolio.find({ technicianId: req.params.id }).sort({ createdAt: -1 }).lean();
    res.json(items);
  } catch (err) {
    next(err);
  }
}

async function addPortfolioItem(req, res, next) {
  try {
    const { title, description, imageUrl, category } = req.body;
    const item = await Portfolio.create({
      technicianId: req.uid,
      title,
      description: description || '',
      imageUrl,
      category,
    });
    res.status(201).json(item);
  } catch (err) {
    next(err);
  }
}

async function deletePortfolioItem(req, res, next) {
  try {
    const item = await Portfolio.findById(req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item not found' });
    if (item.technicianId !== req.uid) return res.status(403).json({ error: 'Forbidden' });
    await item.deleteOne();
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

async function getMyActivity(req, res, next) {
  try {
    const activities = await Activity.find({ userId: req.uid })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(activities);
  } catch (err) {
    next(err);
  }
}

async function toggleFavorite(req, res, next) {
  try {
    const { technicianId } = req.body;
    const user = await User.findById(req.uid);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const idx = user.favorites.indexOf(technicianId);
    if (idx > -1) {
      user.favorites.splice(idx, 1);
    } else {
      user.favorites.push(technicianId);
    }
    await user.save();
    res.json({ favorites: user.favorites });
  } catch (err) {
    next(err);
  }
}

async function getFavoriteTechnicians(req, res, next) {
  try {
    const user = await User.findById(req.uid).lean();
    if (!user) return res.status(404).json({ error: 'User not found' });

    const technicians = await User.find({ _id: { $in: user.favorites } })
      .select('-email -fcmToken -referralCode -referredBy')
      .lean();
    res.json(technicians);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  getMe,
  updateMe,
  updateLocation,
  getPublicProfile,
  getNearbyTechnicians,
  getTopTechnicians,
  getTechnicianPortfolio,
  addPortfolioItem,
  deletePortfolioItem,
  getMyActivity,
  toggleFavorite,
  getFavoriteTechnicians,
};
