/**
 * src/stitch-bridge.js — Stitch Workflow Bridge
 * Expose les workflows stitch à Jarvis via HTTP :3006
 * Si stitch non actif → mock responses réalistes
 */
import { createServer } from 'http';
import dotenv from 'dotenv';
dotenv.config();

const PORT = parseInt(process.env.STITCH_BRIDGE_PORT || '3006');
const STITCH_URL = process.env.STITCH_URL || 'http://localhost:3010';

export const STITCH_WORKFLOWS = {
  'analyse-appel-vente': {
    description: 'Analyse un call de vente et extrait les insights',
    endpoint: `${STITCH_URL}/api/workflow/sales-call-analysis`,
    mock: {
      insights: ['Objection prix mentionnée 3 fois', 'Prospect très intéressé par feature X', 'Follow-up dans 48h recommandé'],
      score: 78,
      nextAction: 'Envoyer devis personnalisé'
    }
  },
  'crm-pipeline': {
    description: 'Met à jour le CRM pipeline',
    endpoint: `${STITCH_URL}/api/workflow/crm-update`,
    mock: { updated: true, pipeline: 'Qualification → Proposition', deals: 3 }
  },
  'rapport-ventes': {
    description: 'Génère un rapport de performance ventes',
    endpoint: `${STITCH_URL}/api/workflow/sales-report`,
    mock: {
      period: 'Cette semaine',
      revenue: '12,450€',
      deals_closed: 4,
      pipeline_value: '87,200€',
      top_skill: 'email-triage'
    }
  },
  'lead-scoring': {
    description: 'Score un prospect selon son comportement',
    endpoint: `${STITCH_URL}/api/workflow/lead-scoring`,
    mock: { score: 85, grade: 'A', recommendation: 'Contacter immédiatement' }
  }
};

// Tente d'appeler stitch réel, fallback mock si indisponible
async function callWorkflow(name, params = {}) {
  const wf = STITCH_WORKFLOWS[name];
  if (!wf) return { success: false, error: `Workflow inconnu: ${name}. Disponibles: ${Object.keys(STITCH_WORKFLOWS).join(', ')}` };

  try {
    const res = await fetch(wf.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();
    return { success: true, result: data, source: 'stitch-live' };
  } catch {
    // stitch non actif → mock
    return {
      success: true,
      result: wf.mock,
      source: 'stitch-mock',
      note: 'Stitch non actif — démarrer stitch pour les vraies données'
    };
  }
}

// HTTP server
const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'GET' && url.pathname === '/health') {
    return res.end(JSON.stringify({ ok: true, service: 'stitch-bridge', port: PORT, workflows: Object.keys(STITCH_WORKFLOWS).length }));
  }

  if (req.method === 'GET' && url.pathname === '/workflows') {
    return res.end(JSON.stringify({ workflows: Object.entries(STITCH_WORKFLOWS).map(([k,v]) => ({ name: k, description: v.description })) }));
  }

  if (req.method === 'POST' && url.pathname.startsWith('/workflow/')) {
    const name = url.pathname.replace('/workflow/', '');
    let body = {};
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch {}
    const result = await callWorkflow(name, body);
    return res.end(JSON.stringify(result));
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => console.log(`[StitchBridge] Démarré sur :${PORT} — ${Object.keys(STITCH_WORKFLOWS).length} workflows`));
