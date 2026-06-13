const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  userId: { type: String, ref: 'User', required: true },
  requestId: { type: String, required: true },
  requestTitle: { type: String, required: true },
  requestImageUrl: { type: String, default: '' },
  address: { type: String, default: '' },
  distance: { type: Number, default: 0 },
  type: { type: String, enum: ['nearby', 'directQuote', 'system'], default: 'nearby' },
  isRead: { type: Boolean, default: false },
}, {
  timestamps: true,
});

alertSchema.index({ userId: 1, createdAt: -1 });
alertSchema.index({ userId: 1, isRead: 1 });
// TTL: auto-delete alerts older than 24 hours
alertSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

module.exports = mongoose.model('Alert', alertSchema);
