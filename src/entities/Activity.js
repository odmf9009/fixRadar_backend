const mongoose = require('mongoose');

const activitySchema = new mongoose.Schema({
  userId: { type: String, ref: 'User', required: true },
  type: {
    type: String,
    enum: ['request_created', 'quote_sent', 'quote_accepted', 'service_completed', 'review_given', 'achievement_unlocked', 'referral_success'],
    required: true,
  },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  relatedId: { type: String, default: null },
  xpEarned: { type: Number, default: 0 },
  pointsEarned: { type: Number, default: 0 },
}, {
  timestamps: true,
});

activitySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Activity', activitySchema);
