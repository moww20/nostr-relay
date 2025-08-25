const DEFAULT_ALLOWED_ORIGINS = ['*'];

function resolveAllowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return fromEnv.length ? fromEnv : DEFAULT_ALLOWED_ORIGINS;
}

function setCorsHeaders(res, origin) {
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Apply CORS policy. Returns an object with:
 * - allowed: boolean (whether the request origin is allowed)
 * - ended: boolean (whether the response has been ended, e.g., preflight)
 */
function applyCors(req, res) {
  const origins = resolveAllowedOrigins();
  const reqOrigin = (req.headers && (req.headers.origin || req.headers.Origin)) || '*';
  const allowed = origins.includes('*') || (reqOrigin && origins.includes(reqOrigin));

  if (req.method === 'OPTIONS') {
    if (allowed) {
      setCorsHeaders(res, reqOrigin);
      res.statusCode = 204;
      res.end();
      return { allowed: true, ended: true };
    } else {
      res.statusCode = 403;
      res.end();
      return { allowed: false, ended: true };
    }
  }

  if (allowed) {
    setCorsHeaders(res, reqOrigin);
    return { allowed: true, ended: false };
  }

  return { allowed: false, ended: false };
}

module.exports = { applyCors };


