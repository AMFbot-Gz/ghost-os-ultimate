import { execa } from "execa";

export async function run(params = {}) {
  const app = params.app || params.name;
  if (!app) return { success: false, error: "app requis" };
  try {
    await execa("osascript", ["-e", `tell application "${app}" to quit`], { timeout: 5000, reject: false });
    return { success: true, app };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
