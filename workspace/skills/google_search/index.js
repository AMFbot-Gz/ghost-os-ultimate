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
  const { query, limit = 5 } = params;
  if (!query) return { success: false, error: "query requis" };

  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  const goto = await callPW("pw.goto", { url });
  if (!goto.success) return goto;

  await new Promise(r => setTimeout(r, 2000));

  const titlesResult = await callPW("pw.extract", { selector: "h3", limit });
  const urlsResult   = await callPW("pw.extract", { selector: "cite", limit });

  const titles = titlesResult?.results || [];
  const urls   = urlsResult?.results || [];

  const results = titles.map((title, i) => ({ title, url: urls[i] || "" }));

  return { success: true, query, count: results.length, results };
}
