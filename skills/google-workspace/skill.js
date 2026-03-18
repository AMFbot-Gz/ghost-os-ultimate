/**
 * skills/google-workspace/skill.js
 * Actions Google Workspace (Gmail, Calendar)
 * Mode DEMO si GOOGLE_CLIENT_ID absent
 */

const DEMO_MODE = !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET;

const DEMO_EMAILS = [
  { id: '1', from: 'client@acme.com', subject: 'Suivi devis #2847', date: new Date(Date.now() - 2*3600000).toISOString(), snippet: 'Bonjour, pouvez-vous me rappeler ce soir ?', urgent: true },
  { id: '2', from: 'newsletter@medium.com', subject: 'Top stories this week', date: new Date(Date.now() - 5*3600000).toISOString(), snippet: '10 articles vous attendent', urgent: false },
  { id: '3', from: 'facture@stripe.com', subject: 'Votre facture de mars 2026', date: new Date(Date.now() - 8*3600000).toISOString(), snippet: 'Montant : 89€ — Payé', urgent: false },
  { id: '4', from: 'lea.martin@partner.fr', subject: 'Collaboration projet Jarvis', date: new Date(Date.now() - 12*3600000).toISOString(), snippet: 'Je suis très intéressée par votre approche...', urgent: true },
  { id: '5', from: 'noreply@github.com', subject: '[ghost-os-ultimate] New PR #42', date: new Date(Date.now() - 24*3600000).toISOString(), snippet: 'feat: Phase 4 final', urgent: false }
];

const DEMO_EVENTS = [
  { id: '1', title: 'Standup équipe', start: new Date(Date.now() + 2*3600000).toISOString(), duration: '30min', attendees: 3 },
  { id: '2', title: 'Démo client ACME', start: new Date(Date.now() + 26*3600000).toISOString(), duration: '1h', attendees: 5 },
  { id: '3', title: 'Review sprint', start: new Date(Date.now() + 50*3600000).toISOString(), duration: '2h', attendees: 8 }
];

export async function run({ action = 'listEmails', query = '', maxResults = 10 }) {
  if (DEMO_MODE) {
    if (action === 'listEmails') {
      return {
        success: true,
        mode: 'demo',
        emails: DEMO_EMAILS.slice(0, maxResults),
        total: DEMO_EMAILS.length,
        note: '(mode démo — configurer GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET pour activer)'
      };
    }
    if (action === 'listEvents') {
      return {
        success: true,
        mode: 'demo',
        events: DEMO_EVENTS,
        note: '(mode démo — configurer GOOGLE_CLIENT_ID pour activer)'
      };
    }
    if (action === 'sendEmail') {
      return {
        success: true,
        mode: 'demo',
        sent: true,
        note: '(mode démo — email non envoyé réellement)'
      };
    }
    return { success: false, error: `Action inconnue: ${action}. Disponibles: listEmails, listEvents, sendEmail` };
  }

  // Mode live OAuth2 (nécessite token dans vault/google-token.json)
  try {
    const tokenPath = './vault/google-token.json';
    const { readFileSync, existsSync } = await import('fs');
    if (!existsSync(tokenPath)) {
      return { success: false, error: 'Token Google absent — lancer le flow OAuth2 d\'abord' };
    }
    // Ici irait le vrai code OAuth2 — placeholder
    return { success: false, error: 'OAuth2 live non implémenté — utiliser mode démo' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
