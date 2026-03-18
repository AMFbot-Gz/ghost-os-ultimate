/**
 * skills/shopify-backend/skill.js
 * Shopify Admin API — orders, products, inventory
 * Variables : SHOPIFY_STORE_URL, SHOPIFY_API_KEY (Admin API token)
 */

const SHOPIFY_STORE = process.env.SHOPIFY_STORE_URL || '';
const SHOPIFY_KEY   = process.env.SHOPIFY_API_KEY   || '';
const API_VERSION   = '2024-01';

async function shopifyFetch(path, method = 'GET', body = null) {
  if (!SHOPIFY_STORE || !SHOPIFY_KEY) {
    throw new Error('SHOPIFY_STORE_URL et SHOPIFY_API_KEY requis dans .env');
  }
  const url = `https://${SHOPIFY_STORE}/admin/api/${API_VERSION}/${path}`;
  const res = await fetch(url, {
    method,
    headers: { 'X-Shopify-Access-Token': SHOPIFY_KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getOrders(status = 'any', limit = 10) {
  if (!SHOPIFY_STORE) return { success: true, mock: true, orders: [
    { id: 'mock-1001', name: '#1001', status: 'fulfilled', total_price: '49.99', customer: 'Client Mock', created_at: new Date().toISOString() }
  ]};
  const data = await shopifyFetch(`orders.json?status=${status}&limit=${limit}`);
  return { success: true, orders: data.orders.map(o => ({
    id: o.id, name: o.name, status: o.financial_status, total_price: o.total_price,
    customer: `${o.customer?.first_name || ''} ${o.customer?.last_name || ''}`.trim(),
    created_at: o.created_at,
  }))};
}

async function getProducts(limit = 10) {
  if (!SHOPIFY_STORE) return { success: true, mock: true, products: [
    { id: 'mock-p1', title: 'Produit Mock', status: 'active', variants: [{ inventory_quantity: 42 }] }
  ]};
  const data = await shopifyFetch(`products.json?limit=${limit}`);
  return { success: true, products: data.products.map(p => ({
    id: p.id, title: p.title, status: p.status,
    variants: p.variants.map(v => ({ id: v.id, sku: v.sku, inventory_quantity: v.inventory_quantity })),
  }))};
}

async function updateInventory(variantId, quantity) {
  if (!SHOPIFY_STORE) return { success: false, error: 'SHOPIFY_STORE_URL requis', mock: true };
  // Récupère inventory_item_id
  const variant = await shopifyFetch(`variants/${variantId}.json`);
  const inventoryItemId = variant.variant.inventory_item_id;
  // Récupère location_id
  const locations = await shopifyFetch('locations.json');
  const locationId = locations.locations[0]?.id;
  // Set quantity
  const result = await shopifyFetch('inventory_levels/set.json', 'POST', {
    location_id: locationId, inventory_item_id: inventoryItemId, available: quantity,
  });
  return { success: true, inventory_level: result.inventory_level };
}

export async function run(params = {}) {
  const { action = 'getOrders', status, limit, variantId, quantity } = params;
  try {
    switch (action) {
      case 'getOrders':        return await getOrders(status, limit);
      case 'getProducts':      return await getProducts(limit);
      case 'updateInventory':  return await updateInventory(variantId, quantity);
      default: return { success: false, error: `Action inconnue: ${action}. Disponibles: getOrders, getProducts, updateInventory` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}
