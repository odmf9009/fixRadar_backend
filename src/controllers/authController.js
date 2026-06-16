const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../entities/User');
const VerificationCode = require('../entities/VerificationCode');
const { getPublicKeyPem, decryptPassword } = require('../utils/rsaKeys');
const { sendVerificationCode: sendCodeEmail } = require('../utils/emailService');

// ─── Public key (no auth required) ───────────────────────────────────────────

function getPublicKey(req, res) {
  res.json({ publicKey: getPublicKeyPem() });
}

// ─── Send verification code (no auth required) ────────────────────────────────

async function sendVerification(req, res, next) {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({ message: 'Email inválido' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    const existing = await User.findOne({ email: normalizedEmail, authProvider: 'email' });
    if (existing) {
      return res.status(409).json({ message: 'Este email ya está registrado. Inicia sesión.' });
    }

    await VerificationCode.deleteMany({ email: normalizedEmail });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await VerificationCode.create({ email: normalizedEmail, code, expiresAt });
    await sendCodeEmail(normalizedEmail, code);

    res.json({ message: 'Código enviado. Revisa tu correo.' });
  } catch (err) {
    next(err);
  }
}

// ─── Register (no auth required) ─────────────────────────────────────────────

async function registerWithEmail(req, res, next) {
  try {
    const { email, encryptedPassword, name, verificationCode, referralCode } = req.body;

    if (!email || !encryptedPassword || !name || !verificationCode) {
      return res.status(400).json({ message: 'Todos los campos son requeridos' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Verify code
    const record = await VerificationCode.findOne({
      email: normalizedEmail,
      used: false,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!record) {
      return res.status(400).json({ message: 'Código expirado. Solicita uno nuevo.' });
    }
    if (record.code !== verificationCode.trim()) {
      return res.status(400).json({ message: 'Código incorrecto' });
    }

    // Check duplicate email
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(409).json({ message: 'Este email ya está registrado' });
    }

    // Decrypt + hash password
    let plainPassword;
    try {
      plainPassword = decryptPassword(encryptedPassword);
    } catch {
      return res.status(400).json({ message: 'Error al procesar la contraseña' });
    }
    const hashedPassword = await bcrypt.hash(plainPassword, 12);

    // Mark code used
    record.used = true;
    await record.save();

    // Generate IDs
    const userId = uuidv4();
    const cleanName = name.trim().slice(0, 4).toUpperCase().replace(/\s/g, 'X');
    const myReferralCode = `FIX-${cleanName}-${userId.slice(-4).toUpperCase()}`;

    // Validate referral
    let referredByUser = null;
    if (referralCode) {
      referredByUser = await User.findOne({ referralCode: referralCode.trim().toUpperCase() });
    }

    // Create user
    const user = await User.create({
      _id: userId,
      authProvider: 'email',
      password: hashedPassword,
      name: name.trim(),
      email: normalizedEmail,
      emailVerified: true,
      referralCode: myReferralCode,
      referredBy: referredByUser?._id || null,
    });

    if (referredByUser) {
      await User.findByIdAndUpdate(referredByUser._id, {
        $inc: { referralCount: 1, referralXpEarned: 100 },
      });
    }

    const token = _signJwt(user._id, normalizedEmail);
    const userObj = user.toObject();
    delete userObj.password;

    res.status(201).json({ token, user: userObj });
  } catch (err) {
    next(err);
  }
}

// ─── Login (no auth required) ─────────────────────────────────────────────────

async function loginWithEmail(req, res, next) {
  try {
    const { email, encryptedPassword } = req.body;

    if (!email || !encryptedPassword) {
      return res.status(400).json({ message: 'Email y contraseña son requeridos' });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Explicitly include password (select: false on schema)
    const user = await User.findOne({ email: normalizedEmail, authProvider: 'email' })
      .select('+password');

    if (!user) {
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    let plainPassword;
    try {
      plainPassword = decryptPassword(encryptedPassword);
    } catch {
      return res.status(400).json({ message: 'Error al procesar la contraseña' });
    }

    const isValid = await bcrypt.compare(plainPassword, user.password);
    if (!isValid) {
      return res.status(401).json({ message: 'Credenciales incorrectas' });
    }

    const token = _signJwt(user._id, normalizedEmail);
    const userObj = user.toObject();
    delete userObj.password;

    res.json({ token, user: userObj });
  } catch (err) {
    next(err);
  }
}

// ─── Sync Google/Firebase user ────────────────────────────────────────────────

async function syncUser(req, res, next) {
  try {
    const uid = req.uid;
    const email = req.email;
    const { name, profileImageUrl, userType, referralCode, fcmToken } = req.body;

    if (!uid) return res.status(401).json({ error: 'UID not found in request' });

    let user = await User.findById(uid);

    if (!user) {
      const myReferralCode = `${(name || 'USER').slice(0, 4).toUpperCase()}${uid.slice(-4).toUpperCase()}`;
      user = await User.create({
        _id: uid,
        authProvider: 'firebase',
        name: name || 'Usuario',
        email: email || `user_${uid}@fixradar.com`,
        profileImageUrl: profileImageUrl || '',
        userType: userType || null,
        role: userType || null,
        referralCode: myReferralCode,
        fcmToken: fcmToken || null,
      });
    } else {
      if (fcmToken && user.fcmToken !== fcmToken) {
        user.fcmToken = fcmToken;
        await user.save();
      }
    }

    const userObj = user.toObject();
    delete userObj.password;
    res.json({ user: userObj });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    next(err);
  }
}

// ─── Update FCM token ─────────────────────────────────────────────────────────

async function updateFcmToken(req, res, next) {
  try {
    const { token } = req.body;
    await User.findByIdAndUpdate(req.uid, { fcmToken: token });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function _signJwt(userId, email) {
  return jwt.sign(
    { userId, email },
    process.env.JWT_SECRET || 'fixradar-secret',
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' },
  );
}

module.exports = {
  getPublicKey,
  sendVerification,
  registerWithEmail,
  loginWithEmail,
  syncUser,
  updateFcmToken,
};
