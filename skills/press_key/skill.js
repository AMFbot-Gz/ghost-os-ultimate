import { execSync } from "child_process";

const KEY_MAP = {
  "Enter": "return", "Return": "return", "Space": "space", "Tab": "tab",
  "Escape": "escape", "Esc": "escape", "Backspace": "delete",
  "ArrowUp": "up arrow", "ArrowDown": "down arrow",
  "ArrowLeft": "left arrow", "ArrowRight": "right arrow",
};

export async function run({ key = "Return" } = {}) {
  const appleKey = KEY_MAP[key] || key.toLowerCase();
  try {
    execSync(`osascript -e 'tell application "System Events" to key code (key code of "${appleKey}")'`, { timeout: 3000 });
    return { success: true, key, message: `Key ${key} pressed` };
  } catch {
    // Fallback: keystroke
    try {
      execSync(`osascript -e 'tell application "System Events" to keystroke (ASCII character ${key.charCodeAt(0)})'`, { timeout: 3000 });
      return { success: true, key };
    } catch (e2) {
      return { success: false, error: e2.message };
    }
  }
}
