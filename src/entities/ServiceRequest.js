const mongoose = require('mongoose');

const serviceRequestSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  category: { type: String, required: true },
  imageUrls: [String],
  thumbnailUrls: [String],
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
  },
  address: { type: String, required: true },
  status: {
    type: String,
    enum: ['open', 'assigned', 'inProgress', 'finishedByTechnician', 'completed', 'cancelled'],
    default: 'open',
  },
  urgency: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  clientId: { type: String, required: true, ref: 'User' },
  clientName: { type: String, required: true },
  clientPhotoUrl: { type: String, default: null },
  technicianId: { type: String, default: null, ref: 'User' },
  technicianName: { type: String, default: null },
  technicianPhotoUrl: { type: String, default: null },
  acceptedQuoteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Quote', default: null },
  assignedAt: { type: Date, default: null },
  budget: { type: Number, default: null },
  minBudget: { type: Number, default: null },
  maxBudget: { type: Number, default: null },
  completionPhotoUrl: { type: String, default: null },
  completionPhotoUrls: { type: [String], default: [] },
  completedAt: { type: Date, default: null },
  reviewRating: { type: Number, default: null },
  reviewComment: { type: String, default: null },
  responsesCount: { type: Number, default: 0 },
  interestedTechnicians: [String],
  isChatEnabled: { type: Boolean, default: true },
  lastMessageAt: { type: Date, default: null },
  lastMessageBy: { type: String, default: null },
  lastMessageText: { type: String, default: null },
  chatLastReadBy: { type: Map, of: Date, default: {} },
  targetTechnicianId: { type: String, default: null, ref: 'User' },
}, {
  timestamps: true,
});

serviceRequestSchema.index({ location: '2dsphere' });
serviceRequestSchema.index({ status: 1 });
serviceRequestSchema.index({ clientId: 1 });
serviceRequestSchema.index({ technicianId: 1 });
serviceRequestSchema.index({ category: 1 });
serviceRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
