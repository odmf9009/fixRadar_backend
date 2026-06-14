const User = require('../entities/User');
const admin = require('../config/firebase');

// Called after Firebase Auth on the client. Upserts the user in MongoDB.
async function syncUser(req, res, next) {
  try {
    const uid = req.uid;
    const email = req.email;
    const { name, profileImageUrl, userType, referralCode, fcmToken } = req.body;

    if (!uid) {
      return res.status(401).json({ error: 'UID not found in request' });
    }

    console.log(`[Auth] Syncing user: ${uid} (${email || 'no email'})`);

    let user;
    try {
      user = await User.findById(uid);
    } catch (dbErr) {
      console.error('[Database Error] findById failed:', dbErr);
      throw new Error('Database connection error');
    }

    if (!user) {
      console.log(`[Auth] Creating new user: ${uid}`);
      const myReferralCode = `${(name || 'USER').slice(0, 4).toUpperCase()}${uid.slice(-4).toUpperCase()}`;

      try {
        user = await User.create({
          _id: uid,
          name: name || 'Usuario',
          email: email || `user_${uid}@fixradar.com`,
          profileImageUrl: profileImageUrl || '',
          userType: userType || 'client',
          role: userType || 'client',
          referralCode: myReferralCode,
          fcmToken: fcmToken || null,
        });
      } catch (createErr) {
        console.error('[Database Error] create user failed:', createErr);
        // Handle duplicate email or other validation errors
        if (createErr.code === 11000) {
           return res.status(400).json({ error: 'Email or UID already exists with different data' });
        }
        throw createErr;
      }
    } else {
      console.log(`[Auth] User exists: ${user._id}`);
      if (fcmToken && user.fcmToken !== fcmToken) {
        user.fcmToken = fcmToken;
        await user.save();
      }
    }

    res.json({ user: user.toObject() });
  } catch (err) {
    console.error('[Auth Error] syncUser:', err);
    next(err);
  }
}

async function updateFcmToken(req, res, next) {
  try {
    const { token } = req.body;
    await User.findByIdAndUpdate(req.uid, { fcmToken: token });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
}

module.exports = { syncUser, updateFcmToken };
