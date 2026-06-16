const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  _id: { type: String }, // Firebase UID or UUID (email-auth users)
  authProvider: { type: String, enum: ['firebase', 'email'], default: 'firebase' },
  password: { type: String, default: null, select: false }, // bcrypt hash, email-auth only
  name: { type: String, required: true },
  username: { type: String, default: '' },
  email: { type: String, required: true, unique: true },
  profileImageUrl: { type: String, default: '' },
  userType: { type: String, enum: ['client', 'technician'] },
  role: { type: String, enum: ['client', 'technician', 'admin'] },
  onboardingCompleted: { type: Boolean, default: false },
  specialties: [String],
  rating: { type: Number, default: 5.0, min: 0, max: 5 },
  reviewsCount: { type: Number, default: 0 },
  points: { type: Number, default: 0 },
  totalXp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  postsCount: { type: Number, default: 0 },
  foundCount: { type: Number, default: 0 },
  confirmationsCount: { type: Number, default: 0 },
  chatMessagesCount: { type: Number, default: 0 },
  totalImpactValue: { type: Number, default: 0.0 },
  favorites: [String],
  redeemedRewards: [String],
  activeStreak: { type: Number, default: 0 },
  totalDistance: { type: Number, default: 0.0 },
  usersHelped: { type: Number, default: 0 },
  referralCode: { type: String, default: '' },
  referredBy: { type: String, default: null },
  referralCount: { type: Number, default: 0 },
  successfulReferrals: { type: Number, default: 0 },
  pendingReferrals: { type: Number, default: 0 },
  referralXpEarned: { type: Number, default: 0 },
  isOnline: { type: Boolean, default: false },
  notificationsEnabled: { type: Boolean, default: true },
  presenceStatus: { type: String, enum: ['online', 'away', 'offline', 'busy'], default: 'offline' },
  lastSeen: { type: Date, default: null },
  fcmToken: { type: String, default: null },
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }, // [longitude, latitude]
  },
  lastLocationUpdate: { type: Date, default: null },
  // Technician extended fields
  companyName: { type: String, default: null },
  yearsOfExperience: { type: Number, default: 0 },
  completedJobsCount: { type: Number, default: 0 },
  avgResponseTime: { type: String, default: 'N/A' },
  satisfactionPercentage: { type: Number, default: 100.0 },
  bio: { type: String, default: '' },
  city: { type: String, default: '' },
  serviceRadius: { type: Number, default: 20.0 },
  idVerified: { type: Boolean, default: false },
  phoneVerified: { type: Boolean, default: false },
  emailVerified: { type: Boolean, default: false },
  licenseVerified: { type: Boolean, default: false },
  insuranceVerified: { type: Boolean, default: false },
  badges: [String],
  freeQuote: { type: Boolean, default: true },
  emergencyService: { type: Boolean, default: false },
  workHours: { type: String, default: '9:00 AM - 6:00 PM' },
  weekendAvailability: { type: Boolean, default: false },
  phoneNumber: { type: String, default: null },
}, {
  timestamps: true,
  _id: false,
});

userSchema.index({ location: '2dsphere' });
userSchema.index({ userType: 1 });
userSchema.index({ email: 1 });
userSchema.index({ referralCode: 1 });

module.exports = mongoose.model('User', userSchema);
