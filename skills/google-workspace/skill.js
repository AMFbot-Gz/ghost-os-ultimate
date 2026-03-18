/**
 * skills/google-workspace/skill.js
 * Google Workspace : Gmail + Calendar via OAuth2
 * Auth : vault/google-token.json (access_token + refresh_token)
 * Variables : GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI dans .env
 */
import { google } from 'googleapis';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../..');
const TOKEN_PATH = resolve(ROOT, 'vault/google-token.json');

function getAuth() {
  const credentials = {
    client_id:     process.env.GOOGLE_CLIENT_ID     || 'mock-client-id',
    client_secret: process.env.GOOGLE_CLIENT_SECRET || 'mock-client-secret',
    redirect_uris: [process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3002/oauth/google'],
  };
  const oAuth2Client = new google.auth.OAuth2(
    credentials.client_id,
    credentials.client_secret,
    credentials.redirect_uris[0]
  );
  if (existsSync(TOKEN_PATH)) {
    const token = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);
    oAuth2Client.on('tokens', (tokens) => {
      const current = JSON.parse(readFileSync(TOKEN_PATH, 'utf8'));
      writeFileSync(TOKEN_PATH, JSON.stringify({ ...current, ...tokens }, null, 2));
    });
  }
  return oAuth2Client;
}

async function listEmails(query = 'is:unread', maxResults = 10) {
  const auth = getAuth();
  if (!existsSync(TOKEN_PATH)) {
    return { success: true, mock: true, emails: [
      { id: 'mock-1', subject: 'Test email (mode mock — configurer vault/google-token.json)', from: 'test@example.com', date: new Date().toISOString() }
    ]};
  }
  const gmail = google.gmail({ version: 'v1', auth });
  const list = await gmail.users.messages.list({ userId: 'me', q: query, maxResults });
  const messages = await Promise.all(
    (list.data.messages || []).slice(0, maxResults).map(async (m) => {
      const msg = await gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['Subject','From','Date'] });
      const headers = msg.data.payload.headers;
      const h = (name) => headers.find(h => h.name === name)?.value || '';
      return { id: m.id, subject: h('Subject'), from: h('From'), date: h('Date') };
    })
  );
  return { success: true, emails: messages, count: messages.length };
}

async function sendEmail(to, subject, body) {
  const auth = getAuth();
  if (!existsSync(TOKEN_PATH)) return { success: false, error: 'Pas de token Google — configurer vault/google-token.json', mock: true };
  const gmail = google.gmail({ version: 'v1', auth });
  const raw = Buffer.from(`To: ${to}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${body}`).toString('base64url');
  const result = await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  return { success: true, messageId: result.data.id };
}

async function listEvents(days = 7) {
  const auth = getAuth();
  if (!existsSync(TOKEN_PATH)) {
    return { success: true, mock: true, events: [
      { id: 'mock-evt-1', summary: 'Réunion mock (mode mock — configurer vault/google-token.json)', start: new Date().toISOString() }
    ]};
  }
  const calendar = google.calendar({ version: 'v3', auth });
  const now = new Date();
  const end = new Date(now.getTime() + days * 24 * 3600 * 1000);
  const res = await calendar.events.list({
    calendarId: 'primary', timeMin: now.toISOString(), timeMax: end.toISOString(),
    singleEvents: true, orderBy: 'startTime', maxResults: 20,
  });
  return { success: true, events: (res.data.items || []).map(e => ({ id: e.id, summary: e.summary, start: e.start?.dateTime || e.start?.date })) };
}

export async function run(params = {}) {
  const { action = 'listEmails', query, maxResults, to, subject, body, days } = params;
  try {
    switch (action) {
      case 'listEmails':  return await listEmails(query, maxResults);
      case 'sendEmail':   return await sendEmail(to, subject, body);
      case 'listEvents':  return await listEvents(days);
      default: return { success: false, error: `Action inconnue: ${action}. Disponibles: listEmails, sendEmail, listEvents` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}
