/**
 * src/routes/v1/keys.js — Routes API key management
 *
 * POST /api/v1/keys        → créer une clé (nécessite admin ou premier setup)
 * GET  /api/v1/keys        → lister ses clés
 * DELETE /api/v1/keys/:id  → révoquer une clé
 * GET  /api/v1/usage       → usage stats
 */
import { createKey, listKeys, revokeKey } from '../../saas/apiKeys.js';
import { PRICING } from '../../saas/billing.js';

export function registerKeyRoutes(app) {
  // POST /api/v1/keys — créer une clé
  app.post('/api/v1/keys', async (req, res) => {
    const { name = 'Default', plan = 'free' } = req.body || {};
    const tenantId = req.tenant?.tenantId || `tenant_${Date.now()}`;

    const result = await createKey({ tenantId, name, plan });
    res.json({
      success: true,
      api_key: result.key,
      prefix: result.prefix,
      plan: result.plan,
      limits: PRICING[result.plan],
      warning: 'Save this key — it will not be shown again.',
    });
  });

  // GET /api/v1/keys — lister les clés
  app.get('/api/v1/keys', async (req, res) => {
    const tenantId = req.tenant?.tenantId;
    if (!tenantId) return res.status(401).json({ error: 'unauthorized' });
    const keys = await listKeys(tenantId);
    res.json({ keys, count: keys.length });
  });

  // DELETE /api/v1/keys/:id — révoquer
  app.delete('/api/v1/keys/:id', async (req, res) => {
    const tenantId = req.tenant?.tenantId;
    const ok = await revokeKey(req.params.id, tenantId);
    res.json({ success: ok });
  });

  // GET /api/v1/usage — stats
  app.get('/api/v1/usage', async (req, res) => {
    const tenant = req.tenant;
    if (!tenant) return res.status(401).json({ error: 'unauthorized' });
    const keys = await listKeys(tenant.tenantId);
    const total = keys.reduce((sum, k) => sum + (k.requests_total || 0), 0);
    const today = keys.reduce((sum, k) => sum + (k.requests_today || 0), 0);
    res.json({
      tenant_id: tenant.tenantId,
      plan: tenant.plan,
      limits: PRICING[tenant.plan],
      usage: { today, total, keys: keys.length },
    });
  });
}
