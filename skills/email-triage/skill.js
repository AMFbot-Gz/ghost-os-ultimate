/**
 * skills/email-triage/skill.js
 * Triage intelligent des emails
 * Mode DEMO si Google non configuré
 */

const DEMO_MODE = !process.env.GOOGLE_CLIENT_ID;

const DEMO_TRIAGE = {
  urgent: [
    { from: 'client@acme.com', subject: 'Suivi devis #2847', reason: 'Client mentionne un rappel urgent', action: 'Appeler aujourd\'hui' },
    { from: 'lea.martin@partner.fr', subject: 'Collaboration projet Jarvis', reason: 'Opportunité business', action: 'Répondre dans les 2h' }
  ],
  normal: [
    { from: 'facture@stripe.com', subject: 'Votre facture de mars 2026', reason: 'Confirmation de paiement', action: 'Archiver' },
    { from: 'noreply@github.com', subject: '[ghost-os-ultimate] New PR #42', reason: 'Mise à jour projet', action: 'Lire quand disponible' }
  ],
  spam: [
    { from: 'newsletter@medium.com', subject: 'Top stories this week', reason: 'Newsletter non prioritaire', action: 'Ignorer' }
  ],
  summary: '2 urgents, 2 normaux, 1 spam. Action principale : appeler client ACME.'
};

export async function run({ maxResults = 10, since = '24h' }) {
  if (DEMO_MODE) {
    return {
      success: true,
      mode: 'demo',
      triage: DEMO_TRIAGE,
      count: { urgent: 2, normal: 2, spam: 1, total: 5 },
      report: formatTriageReport(DEMO_TRIAGE),
      note: '(mode démo — configurer GOOGLE_CLIENT_ID pour trier vos vrais emails)'
    };
  }

  // Mode live : appel à google-workspace skill
  try {
    const { run: googleRun } = await import('../google-workspace/skill.js');
    const emails = await googleRun({ action: 'listEmails', maxResults });
    if (!emails.success) return emails;

    const classified = classify(emails.emails);
    return {
      success: true,
      mode: 'live',
      triage: classified,
      report: formatTriageReport(classified)
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function classify(emails) {
  const urgent = [], normal = [], spam = [];
  const urgentKeywords = /urgent|rappel|asap|important|deadline|paiement|facture impayée/i;
  const spamKeywords = /newsletter|unsubscribe|promo|offre spéciale|50% off/i;

  for (const email of (emails || [])) {
    if (spamKeywords.test(email.subject + ' ' + email.snippet)) {
      spam.push({ ...email, action: 'Archiver' });
    } else if (urgentKeywords.test(email.subject + ' ' + email.snippet) || email.urgent) {
      urgent.push({ ...email, action: 'Répondre immédiatement' });
    } else {
      normal.push({ ...email, action: 'Traiter aujourd\'hui' });
    }
  }
  return { urgent, normal, spam, summary: `${urgent.length} urgents, ${normal.length} normaux, ${spam.length} spam` };
}

function formatTriageReport(triage) {
  const lines = [`📧 Triage emails — ${triage.summary}`];
  if (triage.urgent?.length) {
    lines.push('\n🔴 URGENT:');
    triage.urgent.forEach(e => lines.push(`  • ${e.from}: ${e.subject}`));
  }
  if (triage.normal?.length) {
    lines.push('\n🟡 Normal:');
    triage.normal.slice(0, 3).forEach(e => lines.push(`  • ${e.from}: ${e.subject}`));
  }
  return lines.join('\n');
}
