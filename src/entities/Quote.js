const mongoose = require('mongoose');

const historyEntrySchema = new mongoose.Schema({
  action: String,
  price: Number,
  message: String,
  by: String,
  at: { type: Date, default: Date.now },
}, { _id: false });

const quoteSchema = new mongoose.Schema({
  requestId: { type: mongoose.Schema.Types.ObjectId, ref: 'ServiceRequest', required: true },
  clientId: { type: String, ref: 'User', required: true },
  technicianId: { type: String, ref: 'User', required: true },
  technicianName: { type: String, required: true },
  technicianPhotoUrl: { type: String, default: null },
  technicianRating: { type: Number, default: 5.0 },
  price: { type: Number, default: null },
  minPrice: { type: Number, required: true },
  maxPrice: { type: Number, required: true },
  message: { type: String, required: true },
  estimatedTime: { type: String, default: null },
  status: {
    type: String,
    enum: ['pending', 'accepted', 'rejected', 'counter_offer_sent', 'final_rejected', 'cancelled', 'completed'],
    default: 'pending',
  },
  statusUpdatedAt: { type: Date, default: null },
  history: [historyEntrySchema],
}, {
  timestamps: true,
});

quoteSchema.index({ requestId: 1 });
quoteSchema.index({ technicianId: 1 });
quoteSchema.index({ clientId: 1 });
quoteSchema.index({ status: 1 });

module.exports = mongoose.model('Quote', quoteSchema);
