// Skill: run_shell — Exécute une commande shell (liste blanche sécurisée)
import { execSync } from "child_process";

const ALLOWED = /^(ls|echo|cat|grep|find|wc|date|pwd|node|npm|git\s+log|git\s+status|git\s+diff|du|df|ps\s+aux|which|uname)/;

export async function run({ command, cwd = ".", timeout = 10000 }) {
  if (!command) return { success: false, error: "command requis" };
  if (!ALLOWED.test(command.trim())) {
    return { success: false, error: `Commande non autorisée: "${command}". Utiliser: ls, echo, cat, grep, find, wc, date, pwd, node, npm, git log/status/diff, du, df, ps, which, uname` };
  }
  try {
    const out = execSync(command, { encoding: "utf-8", cwd, timeout });
    return { success: true, result: out.slice(0, 4000) };
  } catch (e) {
    return { success: false, error: e.stderr?.slice(0, 500) || e.message };
  }
}
