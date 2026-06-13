const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
  technicianId: { type: String, ref: 'User', required: true },
  clientId: { type: String, ref: 'User', required: true },
  clientName: { type: String, required: true },
  clientPhotoUrl: { type: String, default: null },
  rating: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: '' },
}, {
  timestamps: true,
});

reviewSchema.index({ technicianId: 1 });
reviewSchema.index({ requestId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
