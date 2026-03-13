/**
 * run_command — Exécute une commande shell avec liste blanche + protection injection
 *
 * Sécurité:
 * - ALLOWED_PREFIXES: whitelist des binaires autorisés
 * - Commandes simples: execFile (pas de shell expansion)
 * - Commandes avec pipe (|): exécutées via shell uniquement si TOUS les binaires sont whitelistés
 * - Blocage des métacaractères dangereux (;, &, backtick, $, redirection, etc.)
 */
import { execFile, exec } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

const ALLOWED_PREFIXES = new Set([
  "ls","cat","echo","git","npm","node","python3","curl","find","grep",
  "head","tail","wc","pwd","df","du","ps","which","env","printenv",
  "date","uname","top","uptime","hostname","whoami","id","sort","uniq",
  "awk","sed","cut","tr","xargs","lsof","netstat","ping","nslookup",
]);

// Métacaractères dangereux hors pipe (le pipe est géré séparément)
const DANGEROUS_NO_PIPE = /[;&`$><\\!{}()\[\]]/;

function getBinName(segment) {
  const parts = segment.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  return parts[0]?.split('/').pop() || "";
}

function isSegmentSafe(segment) {
  const trimmed = segment.trim();
  if (!trimmed) return false;
  // Vérifie que le binaire est dans la whitelist
  const bin = getBinName(trimmed);
  if (!ALLOWED_PREFIXES.has(bin)) return false;
  // Vérifie l'absence de métacaractères dangereux dans le segment entier
  if (DANGEROUS_NO_PIPE.test(trimmed)) return false;
  return true;
}

export async function run({ command = "", cwd = process.cwd(), timeout = 10000 } = {}) {
  const cmd = command.trim();
  if (!cmd) return { success: false, error: "Commande vide" };

  // Bloc toujours les métacaractères vraiment dangereux (pas le pipe)
  if (DANGEROUS_NO_PIPE.test(cmd)) {
    return { success: false, error: `Commande refusée: métacaractères dangereux détectés` };
  }

  // Commande avec pipe(s) — vérifier que chaque segment est safe
  if (cmd.includes("|")) {
    const segments = cmd.split("|");
    for (const seg of segments) {
      if (!isSegmentSafe(seg)) {
        const bin = getBinName(seg);
        return {
          success: false,
          error: `Segment de pipe non autorisé: "${bin || seg.trim().slice(0, 30)}"`,
        };
      }
    }
    // Tous les segments sont whitelistés → exécution shell sécurisée
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        cwd,
        timeout,
        maxBuffer: 1024 * 1024,
        encoding: "utf8",
      });
      return {
        success: true,
        output: (stdout || stderr || "").slice(0, 4000),
        command: cmd,
      };
    } catch (e) {
      return { success: false, error: (e.stderr || e.message || "Erreur").slice(0, 500), command: cmd };
    }
  }

  // Commande simple — execFile (pas de shell, aucun risque d'expansion)
  const parts = cmd.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
  if (parts.length === 0) return { success: false, error: "Commande invalide" };

  const [bin, ...args] = parts;
  const binName = bin.split('/').pop();

  if (!ALLOWED_PREFIXES.has(binName)) {
    return {
      success: false,
      error: `Commande non autorisée: "${binName}". Autorisées: ${[...ALLOWED_PREFIXES].join(", ")}`,
    };
  }

  try {
    const { stdout, stderr } = await execFileAsync(bin, args, {
      cwd,
      timeout,
      maxBuffer: 1024 * 1024,
      encoding: "utf8",
    });
    return {
      success: true,
      output: (stdout || stderr || "").slice(0, 4000),
      command: cmd,
    };
  } catch (e) {
    return { success: false, error: (e.stderr || e.message || "Erreur").slice(0, 500), command: cmd };
  }
}
