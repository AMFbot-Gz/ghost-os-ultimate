import { execSync } from "child_process";
import { existsSync } from "fs";

export async function run({ path = "/tmp/laruche_screenshot.png" } = {}) {
  try {
    execSync(`screencapture -x "${path}"`, { timeout: 5000 });
    if (!existsSync(path)) throw new Error("Screenshot file not created");
    return { success: true, path, message: `Screenshot saved: ${path}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
