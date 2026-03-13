import { execa } from "execa";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

export async function run(params = {}) {
  const path = params.path || params.folder || ".";
  try {
    await execa("code", [path], { timeout: 10000, reject: false });
    await new Promise(r => setTimeout(r, 2000));
    return { success: true, path };
  } catch (e) {
    return { success: false, error: `VSCode non trouvé: ${e.message}` };
  }
}
