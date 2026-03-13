/**
 * open_safari/index.js — Glue code pour le skill open_safari
 * Appelle directement browser_mcp sans passer par toolRouter TS
 */
import { execa } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

export async function run(params = {}) {
  const app = params.app || "Safari";
  const rpcRequest = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "tools/call",
    params: { name: "os.openApp", arguments: { app } },
  });

  try {
    const { stdout } = await execa("node", [join(ROOT, "mcp_servers/browser_mcp.js")], {
      input: rpcRequest, cwd: ROOT, timeout: 10000, reject: false,
    });
    const r = JSON.parse(stdout.trim());
    const text = r.result?.content?.[0]?.text;
    return text ? JSON.parse(text) : r;
  } catch (e) {
    return { success: false, error: e.message };
  }
}
