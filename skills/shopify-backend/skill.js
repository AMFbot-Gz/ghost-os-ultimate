/**
 * skills/shopify-backend/skill.js
 * Shopify Admin API
 * Mode DEMO si SHOPIFY_API_KEY absent
 */

const DEMO_MODE = !process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_STORE_URL;

const DEMO_ORDERS = [
  { id: '#1042', customer: 'Marie Dupont', total: '124.99€', status: 'fulfilled', date: new Date(Date.now() - 2*3600000).toISOString() },
  { id: '#1041', customer: 'Jean Lefebvre', total: '89.50€', status: 'paid', date: new Date(Date.now() - 6*3600000).toISOString() },
  { id: '#1040', customer: 'Sophie Bernard', total: '234.00€', status: 'fulfilled', date: new Date(Date.now() - 24*3600000).toISOString() }
];

const DEMO_PRODUCTS = [
  { id: 'P001', title: 'Jarvis Agent Pro', price: '299€', inventory: 50, status: 'active' },
  { id: 'P002', title: 'Ghost OS License', price: '199€', inventory: 120, status: 'active' },
  { id: 'P003', title: 'AI Consulting Pack', price: '999€', inventory: 10, status: 'active' },
  { id: 'P004', title: 'Automation Bundle', price: '499€', inventory: 35, status: 'active' },
  { id: 'P005', title: 'Support Premium', price: '149€/mois', inventory: 999, status: 'active' }
];

export async function run({ action = 'getOrders', limit = 10, product_id = '', quantity = 0 }) {
  if (DEMO_MODE) {
    if (action === 'getOrders') {
      return {
        success: true,
        mode: 'demo',
        orders: DEMO_ORDERS.slice(0, limit),
        total_revenue: '448.49€',
        note: '(mode démo — configurer SHOPIFY_API_KEY + SHOPIFY_STORE_URL pour activer)'
      };
    }
    if (action === 'getProducts') {
      return {
        success: true,
        mode: 'demo',
        products: DEMO_PRODUCTS.slice(0, limit),
        note: '(mode démo — configurer SHOPIFY_API_KEY pour activer)'
      };
    }
    if (action === 'updateInventory') {
      return {
        success: true,
        mode: 'demo',
        updated: true,
        product_id,
        new_quantity: quantity,
        note: '(mode démo — inventaire non mis à jour réellement)'
      };
    }
    return { success: false, error: `Action inconnue: ${action}. Disponibles: getOrders, getProducts, updateInventory` };
  }

  // Mode live Shopify Admin API
  const BASE = `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01`;
  const headers = { 'X-Shopify-Access-Token': process.env.SHOPIFY_API_KEY, 'Content-Type': 'application/json' };

  try {
    if (action === 'getOrders') {
      const res = await fetch(`${BASE}/orders.json?limit=${limit}&status=any`, { headers });
      const data = await res.json();
      return { success: true, orders: data.orders, mode: 'live' };
    }
    if (action === 'getProducts') {
      const res = await fetch(`${BASE}/products.json?limit=${limit}`, { headers });
      const data = await res.json();
      return { success: true, products: data.products, mode: 'live' };
    }
    return { success: false, error: `Action ${action} non supportée en mode live` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
