import { execSync } from "child_process";

export async function run({} = {}) {
  try {
    execSync(`osascript -e 'tell application "System Events" to key code 36'`, { timeout: 3000 });
    return { success: true, message: "Enter pressed" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
