/**
 * Middleware: require database pool. Use for API routes that need DB access.
 * Returns 503 Service Unavailable when DATABASE_URL is missing or pool is not available.
 */
export function requirePool(req, res, next) {
  if (req.app.locals.pool) {
    return next();
  }
  res.status(503).json({ error: 'Service unavailable', message: 'Database not configured or unavailable' });
}
