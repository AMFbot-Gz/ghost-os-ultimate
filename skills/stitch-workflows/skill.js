/**
 * skills/stitch-workflows/skill.js
 * Déclenche un workflow stitch depuis Telegram
 * Exemples: "analyse mon appel de vente", "rapport ventes cette semaine"
 */

export async function run({ workflow = '', params = {} }) {
  const BRIDGE = process.env.STITCH_BRIDGE_URL || 'http://localhost:3006';

  // Si pas de workflow spécifié → lister les disponibles
  if (!workflow) {
    try {
      const res = await fetch(`${BRIDGE}/workflows`);
      const data = await res.json();
      const list = data.workflows.map(w => `• ${w.name}: ${w.description}`).join('\n');
      return { success: true, result: `Workflows disponibles:\n${list}` };
    } catch {
      return { success: false, error: 'Stitch bridge non disponible (port 3006)' };
    }
  }

  try {
    const res = await fetch(`${BRIDGE}/workflow/${workflow}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(30000)
    });
    const data = await res.json();
    if (data.source === 'stitch-mock') {
      return { success: true, result: JSON.stringify(data.result, null, 2), note: data.note, mode: 'demo' };
    }
    return { success: true, result: JSON.stringify(data.result, null, 2), mode: 'live' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
