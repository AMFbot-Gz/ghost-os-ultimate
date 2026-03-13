import { execa } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

async function callPW(fn, args) {
  const rpc = JSON.stringify({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:fn, arguments:args } });
  try {
    const { stdout } = await execa("node", [join(ROOT,"mcp_servers/playwright_mcp.js")], { input:rpc, cwd:ROOT, timeout:20000, reject:false });
    const r = JSON.parse(stdout.trim());
    const text = r.result?.content?.[0]?.text;
    return text ? JSON.parse(text) : r;
  } catch(e) { return { success:false, error:e.message }; }
}

export async function run(params = {}) {
  const { to, subject, body } = params;
  if (!to || !subject) return { success: false, error: "to et subject requis" };

  // Ouvrir Gmail composition directe
  const goto = await callPW("pw.goto", { url: "https://mail.google.com/mail/u/0/#compose" });
  if (!goto.success) return goto;

  await new Promise(r => setTimeout(r, 3000)); // attendre Gmail

  // Remplir le formulaire
  await callPW("pw.fill", { selector: "input[name='to'], [aria-label='To']", text: to });
  await callPW("pw.fill", { selector: "input[name='subjectbox'], [aria-label='Subject']", text: subject });
  await callPW("pw.fill", { selector: "[role='textbox'][aria-label*='Message'], [aria-label='Message Body']", text: body || "" });

  // Envoyer (Ctrl+Enter)
  const sent = await callPW("pw.press", { key: "Control+Enter" });

  return { success: true, to, subject, sent };
}
