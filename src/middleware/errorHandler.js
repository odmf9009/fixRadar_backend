function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  const message = process.env.NODE_ENV === 'production' && status === 500
    ? 'Internal server error'
    : err.message;

  if (status === 500) {
    console.error('[Error]', err);
  }

  res.status(status).json({ error: message });
}

module.exports = errorHandler;
