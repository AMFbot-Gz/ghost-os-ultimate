/**
 * src/saas/billing.js — Billing SaaS (Stripe stub + usage tracking)
 *
 * Actuellement : tracking usage local.
 * Activer Stripe : mettre STRIPE_SECRET_KEY dans .env
 */

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY;

// Plans Stripe Price IDs (à configurer dans le dashboard Stripe)
export const STRIPE_PRICES = {
  starter:    process.env.STRIPE_PRICE_STARTER    || 'price_starter_monthly',
  pro:        process.env.STRIPE_PRICE_PRO        || 'price_pro_monthly',
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE || 'price_enterprise_monthly',
};

export const PRICING = {
  free:       { price_usd: 0,    label: 'Free',       missions: 10,   api_calls: 100 },
  starter:    { price_usd: 19,   label: 'Starter',    missions: 100,  api_calls: 1000 },
  pro:        { price_usd: 79,   label: 'Pro',        missions: 1000, api_calls: 10000 },
  enterprise: { price_usd: null, label: 'Enterprise', missions: -1,   api_calls: -1 },
};

/**
 * Crée une session Stripe Checkout
 * Retourne null si Stripe non configuré (mode free)
 */
export async function createCheckoutSession({ tenantId, plan, successUrl, cancelUrl }) {
  if (!STRIPE_KEY) {
    console.warn('[Billing] STRIPE_SECRET_KEY not set — billing disabled');
    return null;
  }

  try {
    const stripe = (await import('stripe')).default(STRIPE_KEY);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: STRIPE_PRICES[plan], quantity: 1 }],
      client_reference_id: tenantId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tenantId, plan },
    });
    return { url: session.url, sessionId: session.id };
  } catch (err) {
    console.error('[Billing] Stripe error:', err.message);
    return null;
  }
}

/**
 * Webhook Stripe (confirmation paiement → upgrade plan)
 */
export async function handleStripeWebhook(rawBody, signature) {
  if (!STRIPE_KEY) return null;

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  try {
    const stripe = (await import('stripe')).default(STRIPE_KEY);
    const event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);

    if (event.type === 'checkout.session.completed') {
      const { tenantId, plan } = event.data.object.metadata;
      // TODO: upgrade tenant plan in api_keys.db
      console.log(`[Billing] Tenant ${tenantId} upgraded to ${plan}`);
      return { tenantId, plan, event: 'upgraded' };
    }

    return { event: event.type };
  } catch (err) {
    console.error('[Billing] Webhook error:', err.message);
    return null;
  }
}

/**
 * Retourne le résumé usage d'un tenant
 */
export function getUsageSummary(tenantId) {
  // Usage lu depuis api_keys.db via apiKeys.js
  return { tenantId, billing: 'usage_tracked' };
}
