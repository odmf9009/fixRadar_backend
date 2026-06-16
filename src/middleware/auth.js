const admin = require('../config/firebase');
const jwt = require('jsonwebtoken');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const token = header.split('Bearer ')[1];

  // Try Firebase ID token first (Google login)
  if (admin && admin.auth) {
    try {
      const decoded = await admin.auth().verifyIdToken(token);
      req.uid = decoded.uid;
      req.email = decoded.email;
      return next();
    } catch {
      // Not a Firebase token — fall through to JWT check
    }
  }

  // Try backend JWT (email/password login)
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fixradar-secret');
    req.uid = decoded.userId;
    req.email = decoded.email;
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

module.exports = { authenticate, requireAdmin };
