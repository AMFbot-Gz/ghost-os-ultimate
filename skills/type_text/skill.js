import { execSync } from "child_process";

export async function run({ text = "" } = {}) {
  // Escape single quotes in text for AppleScript
  const escaped = text.replace(/'/g, "'\\''");
  try {
    execSync(`osascript -e 'tell application "System Events" to keystroke "${escaped}"'`, { timeout: 5000 });
    return { success: true, text, message: "Text typed" };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
