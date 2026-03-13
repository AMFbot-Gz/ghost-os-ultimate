import { execa } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

export async function run(params = {}) {
  const query = params.query || "relaxing music playlist";
  const rpcRequest = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "tools/call",
    params: { name: "browser.searchYouTube", arguments: { query } },
  });

  try {
    const { stdout } = await execa("node", [join(ROOT, "mcp_servers/browser_mcp.js")], {
      input: rpcRequest, cwd: ROOT, timeout: 15000, reject: false,
    });
    const r = JSON.parse(stdout.trim());
    const text = r.result?.content?.[0]?.text;
    return text ? JSON.parse(text) : r;
  } catch (e) {
    return { success: false, error: e.message };
  }
}
