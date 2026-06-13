const Review = require('../entities/Review');
const ServiceRequest = require('../entities/ServiceRequest');
const User = require('../entities/User');
const Activity = require('../entities/Activity');
const { notifyUser } = require('../socket/socketManager');

async function createReview(req, res, next) {
  try {
    const { requestId, rating, comment } = req.body;

    const request = await ServiceRequest.findById(requestId);
    if (!request) return res.status(404).json({ error: 'Request not found' });
    if (request.clientId !== req.uid) return res.status(403).json({ error: 'Only the client can review' });
    if (request.status !== 'completed' && request.status !== 'finishedByTechnician') {
      return res.status(400).json({ error: 'Service must be completed to leave a review' });
    }

    const existing = await Review.findOne({ requestId });
    if (existing) return res.status(400).json({ error: 'Review already submitted' });

    const client = await User.findById(req.uid);

    const review = await Review.create({
      requestId,
      technicianId: request.technicianId,
      clientId: req.uid,
      clientName: client?.username || client?.name || 'Cliente',
      clientPhotoUrl: client?.profileImageUrl || null,
      rating,
      comment: comment || '',
    });

    // Update technician's average rating
    const allReviews = await Review.find({ technicianId: request.technicianId });
    const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;

    await User.findByIdAndUpdate(request.technicianId, {
      rating: Math.round(avg * 10) / 10,
      reviewsCount: allReviews.length,
      $inc: { completedJobsCount: 1 },
    });

    // Update request with review data
    await ServiceRequest.findByIdAndUpdate(requestId, {
      reviewRating: rating,
      reviewComment: comment || '',
      status: 'completed',
    });

    await Activity.create({
      userId: req.uid,
      type: 'review_given',
      title: 'Reseña enviada',
      description: `Calificaste a ${request.technicianName} con ${rating} estrellas`,
      relatedId: review._id.toString(),
    });

    notifyUser(request.technicianId, 'review:new', {
      review: review.toObject(),
      newRating: Math.round(avg * 10) / 10,
    });

    res.status(201).json(review);
  } catch (err) {
    next(err);
  }
}

async function getTechnicianReviews(req, res, next) {
  try {
    const reviews = await Review.find({ technicianId: req.params.technicianId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json(reviews);
  } catch (err) {
    next(err);
  }
}

module.exports = { createReview, getTechnicianReviews };
