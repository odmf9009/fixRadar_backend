const User = require('../entities/User');
const admin = require('../config/firebase');

// Called after Firebase Auth on the client. Upserts the user in MongoDB.
async function syncUser(req, res, next) {
  try {
    const { uid, email } = req;
    const { name, profileImageUrl, userType, referralCode, fcmToken } = req.body;

    let user = await User.findById(uid);

    if (!user) {
      // Generate referral code from name
      const myReferralCode = `${(name || 'USER').slice(0, 4).toUpperCase()}${uid.slice(-4).toUpperCase()}`;

      user = await User.create({
        _id: uid,
        name: name || 'Usuario',
        email: email || '',
        profileImageUrl: profileImageUrl || '',
        userType: userType || 'client',
        role: userType || 'client',
        referralCode: myReferralCode,
        fcmToken: fcmToken || null,
      });

      // Process referral if provided
      if (referralCode) {
        const referrer = await User.findOne({ referralCode });
        if (referrer && referrer._id !== uid) {
          await User.findByIdAndUpdate(referrer._id, {
            $inc: { referralCount: 1, successfulReferrals: 1, referralXpEarned: 100 },
          });
          await User.findByIdAndUpdate(uid, { referredBy: referrer._id });
        }
      }
    } else {
      // Update fcm token if changed
      if (fcmToken && user.fcmToken !== fcmToken) {
        user.fcmToken = fcmToken;
        await user.save();
      }
    }

    res.json({ user: user.toObject() });
  } catch (err) {
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
