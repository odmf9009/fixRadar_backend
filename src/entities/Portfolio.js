const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
  technicianId: { type: String, ref: 'User', required: true },
  title: { type: String, required: true },
  description: { type: String, default: '' },
  imageUrl: { type: String, required: true },
  category: { type: String, required: true },
}, {
  timestamps: true,
});

portfolioSchema.index({ technicianId: 1 });

module.exports = mongoose.model('Portfolio', portfolioSchema);
