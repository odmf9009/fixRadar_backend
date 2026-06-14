function errorHandler(err, req, res, _next) {
  const status = err.status || 500;
  // Always show error message in dev or if it's not a generic 500
  const message = err.message || 'Internal server error';

  console.error(`[Error] ${req.method} ${req.path}:`, err);

  res.status(status).json({
    error: message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
}

module.exports = errorHandler;
