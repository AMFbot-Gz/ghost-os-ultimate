import { execSync } from "child_process";

export async function run({ app = "Safari" } = {}) {
  try {
    execSync(`osascript -e 'tell application "${app}" to activate'`, { timeout: 5000 });
    return { success: true, app, message: `${app} opened` };
  } catch {
    // Fallback: open -a
    try {
      execSync(`open -a "${app}"`, { timeout: 5000 });
      return { success: true, app, message: `${app} opened via open -a` };
    } catch (e2) {
      return { success: false, error: e2.message };
    }
  }
}
