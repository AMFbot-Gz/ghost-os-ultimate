/**
 * skills/picoclaw-satellite/skill.js
 * Délègue une mission au satellite PicoClaw léger (:8090)
 * Fallback silencieux si PicoClaw inactif.
 */

export async function run({ command = '' }) {
  const enabled = process.env.PICOCLAW_ENABLED === 'true';
  if (!enabled) {
    return { skipped: true, reason: 'PICOCLAW_ENABLED=false — activer avec PICOCLAW_ENABLED=true' };
  }

  const host = process.env.PICOCLAW_HOST || 'http://localhost:8090';

  try {
    const res = await fetch(`${host}/agent/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: command }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    return {
      success: true,
      result: data.response || data.result || JSON.stringify(data).substring(0, 300),
      source: 'picoclaw',
      model: 'ollama/llama3.2:3b',
    };
  } catch (err) {
    return {
      success: false,
      error: err.message,
      fallback: 'queen-local',
      hint: 'Démarrer PicoClaw: bash scripts/start-picoclaw.sh',
    };
  }
}
