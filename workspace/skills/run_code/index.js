import { execa } from "execa";
import { writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

export async function run(params = {}) {
  const { code, language = "python" } = params;
  if (!code) return { success: false, error: "code requis" };

  const ext = language === "javascript" || language === "js" ? "js" : "py";
  const tmpFile = `/tmp/laruche_code_${Date.now()}.${ext}`;

  try {
    writeFileSync(tmpFile, code);
    const cmd = ext === "js" ? "node" : "python3";
    const { stdout, stderr, exitCode } = await execa(cmd, [tmpFile], { timeout: 30000, reject: false });
    return { success: exitCode === 0, output: stdout || stderr, exitCode };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    try { unlinkSync(tmpFile); } catch {}
  }
}
