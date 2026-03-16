/**
 * src/saas/auth.js — Middleware d'authentification SaaS
 *
 * Supporte :
 *   Authorization: Bearer sk-ghost-XXXX    (API key SaaS)
 *   Authorization: Bearer <CHIMERA_SECRET> (admin rétrocompat)
 *   X-API-Key: sk-ghost-XXXX              (header alternatif)
 *
 * Routes publiques (pas d'auth) : /health, /api/health, /mcp/health
 */
import { validateKey, logUsage } from './apiKeys.js';

const PUBLIC_ROUTES = new Set([
  '/health',
  '/api/health',
  '/mcp/health',
  '/api/v1/health',
]);

/**
 * Extrait le token depuis la requête
 */
function extractToken(req) {
  // Authorization: Bearer TOKEN
  const authHeader = req.headers['authorization'] || req.headers['Authorization'];
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  // X-API-Key: TOKEN
  const xApiKey = req.headers['x-api-key'] || req.headers['X-Api-Key'];
  if (xApiKey) return xApiKey.trim();

  // Query param ?api_key=TOKEN (déconseillé mais supporté)
  const { api_key } = req.query || {};
  if (api_key) return api_key;

  return null;
}

/**
 * Middleware Express/Hono d'authentification SaaS
 * Injecte req.tenant sur succès
 */
export function authMiddleware(req, res, next) {
  const path = req.path || req.url?.split('?')[0] || '/';

  // Routes publiques → skip auth
  if (PUBLIC_ROUTES.has(path)) return next();

  // Mode dev sans CHIMERA_SECRET → auth désactivée avec warning
  const chimera = process.env.CHIMERA_SECRET;
  if (!chimera || chimera === 'dev') {
    req.tenant = { tenantId: 'dev', plan: 'enterprise', name: 'Dev' };
    return next();
  }

  const token = extractToken(req);

  // Pas de token
  if (!token) {
    return res.status(401).json({
      error: 'unauthorized',
      message: 'API key required. Add: Authorization: Bearer sk-ghost-XXXX',
      docs: 'https://ghost-os.dev/docs/auth',
    });
  }

  const t_start = Date.now();

  validateKey(token).then(tenant => {
    if (!tenant) {
      logUsage({ tenantId: 'unknown', endpoint: path, status: 401 });
      return res.status(401).json({ error: 'invalid_api_key', message: 'Invalid or revoked API key.' });
    }

    if (tenant.rate_limited) {
      logUsage({ tenantId: tenant.tenantId, endpoint: path, status: 429 });
      return res.status(429).json({
        error: 'rate_limited',
        message: `Daily limit reached for ${tenant.plan} plan.`,
        reset: 'Tomorrow 00:00 UTC',
        upgrade: 'https://ghost-os.dev/pricing',
      });
    }

    req.tenant = tenant;

    // Log usage après réponse
    res.on('finish', () => {
      logUsage({
        tenantId: tenant.tenantId,
        endpoint: path,
        status: res.statusCode,
        duration_ms: Date.now() - t_start,
      });
    });

    next();
  }).catch(err => {
    console.error('[Auth] Error:', err);
    next(); // fail-open en cas d'erreur DB
  });
}

/**
 * Version async pour Hono (framework Node.js utilisé par queen_oss.js)
 */
export async function honoAuth(c, next) {
  const path = c.req.path;

  if (PUBLIC_ROUTES.has(path) || path.startsWith('/health')) {
    return next();
  }

  const chimera = process.env.CHIMERA_SECRET;
  if (!chimera || chimera === 'dev') {
    c.set('tenant', { tenantId: 'dev', plan: 'enterprise' });
    return next();
  }

  const token = c.req.header('Authorization')?.replace('Bearer ', '')
    || c.req.header('X-API-Key')
    || c.req.query('api_key');

  if (!token) {
    return c.json({ error: 'unauthorized', message: 'API key required.' }, 401);
  }

  const tenant = await validateKey(token);
  if (!tenant) return c.json({ error: 'invalid_api_key' }, 401);
  if (tenant.rate_limited) return c.json({ error: 'rate_limited' }, 429);

  c.set('tenant', tenant);
  return next();
}
