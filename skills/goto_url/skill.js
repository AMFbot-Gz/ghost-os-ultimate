import { execSync } from "child_process";

export async function run({ url = "https://www.google.com" } = {}) {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  try {
    execSync(`osascript -e 'tell application "Safari" to open location "${url}"'`, { timeout: 8000 });
    execSync(`osascript -e 'tell application "Safari" to activate'`, { timeout: 3000 });
    return { success: true, url, message: `Navigated to ${url}` };
  } catch (e) {
    // Fallback: open command
    try {
      execSync(`open "${url}"`, { timeout: 5000 });
      return { success: true, url, message: `Opened ${url} with default browser` };
    } catch (e2) {
      return { success: false, error: e2.message };
    }
  }
}
