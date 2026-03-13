import { execa } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

export async function run(params = {}) {
  const rpc = JSON.stringify({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:"pw.screenshot", arguments:{} } });
  try {
    const { stdout } = await execa("node", [join(ROOT,"mcp_servers/playwright_mcp.js")], { input:rpc, cwd:ROOT, timeout:10000, reject:false });
    const r = JSON.parse(stdout.trim());
    const text = r.result?.content?.[0]?.text;
    return text ? JSON.parse(text) : r;
  } catch(e) {
    // Fallback PyAutoGUI
    const pyResult = await execa("python3", ["-c", `
import pyautogui, base64, io
img = pyautogui.screenshot()
buf = io.BytesIO()
img.save(buf, 'PNG')
print(base64.b64encode(buf.getvalue()).decode())
`], { timeout: 8000, reject: false });
    return { success: true, base64: pyResult.stdout?.trim(), method: "pyautogui" };
  }
}
