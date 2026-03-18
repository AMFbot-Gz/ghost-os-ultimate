/**
 * skills/email-triage/skill.js
 * Triage intelligent des emails — urgents, normaux, spam
 * Dépend de google-workspace pour la récupération
 */
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');

async function fetchRecent(hours = 24) {
  const { run: gsRun } = await import('../google-workspace/skill.js');
  const after = Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
  return gsRun({ action: 'listEmails', query: `after:${after}`, maxResults: 50 });
}

const URGENT_KEYWORDS = ['urgent', 'asap', 'immédiat', 'critique', 'important', 'action required', 'deadline', 'relance', 'impayé', 'rappel'];
const SPAM_KEYWORDS   = ['unsubscribe', 'désabonner', 'promotion', 'offre', 'newsletter', 'noreply', 'no-reply', 'marketing'];

function classify(emails) {
  const urgent = [], normal = [], spam = [];
  for (const email of emails) {
    const text = `${email.subject || ''} ${email.from || ''}`.toLowerCase();
    if (SPAM_KEYWORDS.some(k => text.includes(k))) { spam.push(email); }
    else if (URGENT_KEYWORDS.some(k => text.includes(k))) { urgent.push(email); }
    else { normal.push(email); }
  }
  return { urgent, normal, spam };
}

function formatTelegramReport(classified, hours) {
  const { urgent, normal, spam } = classified;
  const lines = [`📧 *Email Triage — ${hours}h*\n`];
  if (urgent.length) {
    lines.push(`🔴 *Urgents (${urgent.length})* :`);
    urgent.slice(0, 5).forEach(e => lines.push(`  • ${e.subject?.slice(0,50)} _(${e.from?.split('<')[0].trim().slice(0,20)})_`));
  }
  if (normal.length) lines.push(`\n🟡 *Normaux* : ${normal.length} emails`);
  if (spam.length)   lines.push(`⚪ *Spam/Promo* : ${spam.length} emails`);
  return lines.join('\n');
}

export async function run(params = {}) {
  const { action = 'triage', hours = 24 } = params;
  try {
    const fetched = await fetchRecent(hours);
    if (!fetched.success) return { success: false, error: fetched.error || 'Fetch failed' };
    const emails = fetched.emails || [];
    if (action === 'fetchRecent') return { success: true, emails, count: emails.length };
    const classified = classify(emails);
    const report = formatTelegramReport(classified, hours);
    return {
      success: true,
      urgent_count: classified.urgent.length,
      normal_count: classified.normal.length,
      spam_count:   classified.spam.length,
      total:        emails.length,
      report,
      urgent: classified.urgent,
      mock: fetched.mock || false,
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}
