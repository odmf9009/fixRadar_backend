const User = require('../entities/User');
const Review = require('../entities/Review');
const Portfolio = require('../entities/Portfolio');
const Activity = require('../entities/Activity');
const PhoneVerificationCode = require('../entities/PhoneVerificationCode');
const { backfillTechnicianPortfolio } = require('../utils/portfolioHelper');
const { sendVerificationSms } = require('../utils/smsService');

// Normaliza un teléfono a dígitos con prefijo opcional '+'.
function normalizePhone(raw) {
  if (!raw) return '';
  const trimmed = String(raw).trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

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
      'username', 'profileImageUrl', 'userType', 'role', 'onboardingCompleted', 'language',
      'specialties', 'bio', 'city', 'serviceRadius', 'companyName', 'yearsOfExperience',
      'freeQuote', 'emergencyService', 'workHours', 'weekendAvailability',
      'isOnline', 'notificationsEnabled', 'presenceStatus',
    ];
    // 'phoneNumber' se omite a propósito: el teléfono solo se cambia por su
    // endpoint dedicado (updatePhone) y, cuando se active Twilio, por el flujo
    // verificado por SMS (sendPhoneCode / verifyPhoneCode).
    const update = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) update[field] = req.body[field];
    }

    // Handle location if provided directly
    if (req.body.latitude !== undefined && req.body.longitude !== undefined) {
      update.location = {
        type: 'Point',
        coordinates: [parseFloat(req.body.longitude), parseFloat(req.body.latitude)],
      };
      update.lastLocationUpdate = new Date();
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
    const { latitude, longitude, radius = 50, specialty, onlyOnline } = req.query;

    const filter = {
      $or: [{ role: 'technician' }, { userType: 'technician' }],
    };

    if (onlyOnline === 'true') {
      filter.isOnline = true;
    }

    if (specialty) {
      filter.specialties = specialty;
    }

    let technicians;
    if (latitude && longitude) {
      filter.location = {
        $near: {
          $geometry: { type: 'Point', coordinates: [parseFloat(longitude), parseFloat(latitude)] },
          $maxDistance: parseFloat(radius) * 1000,
        },
      };
      technicians = await User.find(filter)
        .select('-email -fcmToken -referralCode -referredBy')
        .limit(50)
        .lean();
    } else {
      // If no location, just return technicians (maybe sorted by rating)
      technicians = await User.find(filter)
        .sort({ rating: -1 })
        .select('-email -fcmToken -referralCode -referredBy')
        .limit(50)
        .lean();
    }

    res.json(technicians);
  } catch (err) {
    next(err);
  }
}

async function getTopTechnicians(req, res, next) {
  try {
    // Show top technicians even if they have 0 completed jobs (for new platforms)
    const technicians = await User.find({ $or: [{ role: 'technician' }, { userType: 'technician' }] })
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
    // Retro-fit completed jobs that aren't in the portfolio yet.
    await backfillTechnicianPortfolio(req.params.id);
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

// Cambio directo del teléfono SIN verificación por SMS.
// TEMPORAL: se usa mientras Twilio no está activo. Cuando se reactive el OTP,
// el frontend volverá a usar sendPhoneCode / verifyPhoneCode en lugar de esto.
async function updatePhone(req, res, next) {
  try {
    const phone = normalizePhone(req.body.phone);
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      return res.status(400).json({ error: 'Número de teléfono inválido' });
    }

    const user = await User.findByIdAndUpdate(
      req.uid,
      { phoneNumber: phone, phoneVerified: false },
      { new: true },
    ).lean();

    res.json(user);
  } catch (err) {
    next(err);
  }
}

// ─── PHONE VERIFICATION (SMS OTP via Twilio) ─────────────────────────────────

// Paso 1: el usuario solicita un código para el número nuevo que quiere usar.
async function sendPhoneCode(req, res, next) {
  try {
    const phone = normalizePhone(req.body.phone);
    // Validación básica: 8 a 15 dígitos (E.164 admite hasta 15).
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8 || digits.length > 15) {
      return res.status(400).json({ error: 'Número de teléfono inválido' });
    }

    // Solo un código vigente por usuario.
    await PhoneVerificationCode.deleteMany({ userId: req.uid });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await PhoneVerificationCode.create({ userId: req.uid, phone, code, expiresAt });
    await sendVerificationSms(phone, code);

    res.json({ message: 'Código enviado por SMS.' });
  } catch (err) {
    next(err);
  }
}

// Paso 2: el usuario confirma el código; si coincide, se guarda y verifica.
async function verifyPhoneCode(req, res, next) {
  try {
    const phone = normalizePhone(req.body.phone);
    const { code } = req.body;
    if (!phone || !code) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    const record = await PhoneVerificationCode.findOne({
      userId: req.uid,
      phone,
      used: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!record) {
      return res.status(400).json({ error: 'Código expirado. Solicita uno nuevo.' });
    }
    if (record.code !== String(code).trim()) {
      return res.status(400).json({ error: 'Código incorrecto.' });
    }

    record.used = true;
    await record.save();

    const user = await User.findByIdAndUpdate(
      req.uid,
      { phoneNumber: phone, phoneVerified: true },
      { new: true },
    ).lean();

    res.json(user);
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
  updatePhone,
  sendPhoneCode,
  verifyPhoneCode,
};
