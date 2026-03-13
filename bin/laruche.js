#!/usr/bin/env node
/**
 * 🐝 LaRuche CLI v3.2
 * The sovereign AI swarm for your machine.
 * Usage: laruche <command> [options]
 */

import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import boxen from "boxen";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { execa } from "execa";
import readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const VERSION = "3.2.0";

// ─── Banner ───────────────────────────────────────────────────────────────────
const BANNER = boxen(
  chalk.hex("#F5A623").bold("🐝  L A R U C H E") + "\n" +
  chalk.hex("#7C3AED")("Ghost Swarm Autonomous Agent") + "\n" +
  chalk.dim(`v${VERSION} — SINGULARITY Edition`),
  {
    padding: { top: 1, bottom: 1, left: 3, right: 3 },
    margin: 0,
    borderStyle: "round",
    borderColor: "yellow",
  }
);

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_PATH = join(ROOT, ".laruche/config.json");
const REGISTRY_PATH = join(ROOT, ".laruche/registry.json");

function loadConfig() {
  try { return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")); }
  catch { return {}; }
}

function loadRegistry() {
  try { return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8")); }
  catch { return { skills: [] }; }
}

// ─── Ollama Health ────────────────────────────────────────────────────────────
async function checkOllama() {
  try {
    const res = await fetch(
      `${process.env.OLLAMA_HOST || "http://localhost:11434"}/api/tags`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return { ok: false, models: [] };
    const data = await res.json();
    return { ok: true, models: data.models?.map((m) => m.name) || [] };
  } catch {
    return { ok: false, models: [] };
  }
}

// ─── Program ─────────────────────────────────────────────────────────────────
const program = new Command();

program
  .name("laruche")
  .description("🐝 LaRuche — Sovereign AI Swarm CLI")
  .version(VERSION)
  .addHelpText("before", "\n" + BANNER + "\n");

// ─── laruche start ────────────────────────────────────────────────────────────
program
  .command("start")
  .description("Démarrer l'essaim LaRuche (queen + watcher + dashboard)")
  .option("--headless", "Mode VPS: core + MCP seulement (sans HUD/Dashboard)")
  .option("--full", "Mode desktop: tout inclus (HUD Electron)")
  .option("--dev", "Mode développement")
  .action(async (opts) => {
    console.log("\n" + BANNER + "\n");

    const spinner = ora(chalk.dim("Vérification système...")).start();

    // Checks
    const ollama = await checkOllama();
    const envExists = existsSync(join(ROOT, ".env"));

    spinner.stop();

    console.log(`  Ollama:    ${ollama.ok ? chalk.green("✓ Online") : chalk.red("✗ Offline")}`);
    console.log(`  Config:    ${envExists ? chalk.green("✓ .env présent") : chalk.yellow("⚠ .env manquant")}`);
    console.log(`  Modèles:   ${ollama.models.slice(0, 3).join(", ") || "aucun"}`);
    console.log();

    if (!envExists) {
      console.log(chalk.yellow("⚠ Configurez d'abord: laruche init\n"));
      process.exit(1);
    }

    const startSpinner = ora(chalk.dim("Démarrage de l'essaim...")).start();

    const runMode = opts.headless ? "headless" : opts.full ? "full" : "balanced";
    startSpinner.text = chalk.dim(`Mode ${runMode} — démarrage...`);

    try {
      const { startMode } = await import("../src/modes.js");
      await startMode(runMode, opts.dev ? "development" : "production");
      startSpinner.succeed(chalk.green(`LaRuche démarrée [${runMode}]`));
      console.log();
      console.log(boxen(
        chalk.white.bold(`🐝 LaRuche ${runMode}\n\n`) +
        (runMode !== "headless" ? chalk.dim("Dashboard: ") + chalk.cyan("http://localhost:8080") + "\n" : "") +
        chalk.dim("Telegram:  ") + chalk.cyan("Envoyez /start") + "\n\n" +
        chalk.dim("Arrêter:   ") + chalk.yellow("laruche stop"),
        { padding: 1, borderStyle: "round", borderColor: "yellow" }
      ));
    } catch (e) {
      startSpinner.fail(chalk.red(`Erreur: ${e.message}`));
      process.exit(1);
    }
  });

// ─── laruche stop ─────────────────────────────────────────────────────────────
program
  .command("stop")
  .description("Arrêter tous les processus LaRuche")
  .action(async () => {
    const spinner = ora("Arrêt de l'essaim...").start();
    await execa("npx", ["pm2", "stop", "all"], { cwd: ROOT, reject: false });
    spinner.succeed(chalk.yellow("LaRuche arrêtée."));
  });

// ─── laruche status ───────────────────────────────────────────────────────────
program
  .command("status")
  .description("État du système et des agents")
  .action(async () => {
    console.log(chalk.hex("#F5A623").bold("\n🐝 LaRuche Status\n"));

    const [ollama, pm2Result] = await Promise.all([
      checkOllama(),
      execa("npx", ["pm2", "jlist"], { cwd: ROOT, reject: false }),
    ]);

    // Ollama
    console.log(chalk.bold("  Ollama:"));
    console.log(`    Status:  ${ollama.ok ? chalk.green("Online") : chalk.red("Offline")}`);
    if (ollama.models.length) {
      console.log(`    Modèles: ${ollama.models.join(", ")}`);
    }

    // PM2 processes
    console.log(chalk.bold("\n  Processus LaRuche:"));
    try {
      const apps = JSON.parse(pm2Result.stdout || "[]").filter((a) =>
        a.name.startsWith("laruche")
      );
      if (apps.length === 0) {
        console.log(chalk.dim("    Aucun processus actif — lancez: laruche start"));
      } else {
        apps.forEach((a) => {
          const status = a.pm2_env?.status;
          const color = status === "online" ? chalk.green : chalk.red;
          const mem = Math.round((a.monit?.memory || 0) / (1024 * 1024));
          const cpu = a.monit?.cpu || 0;
          console.log(`    ${color("●")} ${a.name.padEnd(25)} ${color(status)} ${chalk.dim(`${mem}MB ${cpu}%CPU`)}`);
        });
      }
    } catch {
      console.log(chalk.dim("    PM2 non disponible"));
    }

    // Registry skills
    const registry = loadRegistry();
    console.log(chalk.bold(`\n  Skills: ${registry.skills?.length || 0} enregistrés`));

    console.log();
  });

// ─── laruche init ─────────────────────────────────────────────────────────────
program
  .command("init")
  .description("Configurer LaRuche (API keys, Telegram, etc.)")
  .action(async () => {
    console.log(chalk.hex("#F5A623").bold("\n🐝 LaRuche Init — Configuration\n"));

    const envPath = join(ROOT, ".env");
    const envExample = join(ROOT, ".env.example");

    if (!existsSync(envPath) && existsSync(envExample)) {
      const { execSync } = await import("child_process");
      execSync(`cp "${envExample}" "${envPath}"`);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ask = (q) => new Promise((res) => rl.question(chalk.cyan(q), res));

    console.log(chalk.dim("Appuyez sur Entrée pour garder la valeur actuelle.\n"));

    const token = await ask("TELEGRAM_BOT_TOKEN (depuis @BotFather): ");
    const chatId = await ask("ADMIN_TELEGRAM_ID (votre ID Telegram): ");
    const ollamaHost = await ask("OLLAMA_HOST [http://localhost:11434]: ");

    rl.close();

    // Lecture .env actuel
    let env = "";
    try { env = readFileSync(envPath, "utf-8"); } catch {}

    const setEnv = (key, val) => {
      if (!val) return;
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(env)) {
        env = env.replace(regex, `${key}=${val}`);
      } else {
        env += `\n${key}=${val}`;
      }
    };

    setEnv("TELEGRAM_BOT_TOKEN", token);
    setEnv("ADMIN_TELEGRAM_ID", chatId);
    if (ollamaHost) setEnv("OLLAMA_HOST", ollamaHost);

    writeFileSync(envPath, env);

    console.log(chalk.green("\n✅ Configuration sauvegardée dans .env"));
    console.log(chalk.dim("Lancez maintenant: ") + chalk.cyan("laruche start\n"));
  });

// ─── laruche doctor ───────────────────────────────────────────────────────────
program
  .command("doctor")
  .description("Diagnostic complet du système")
  .option("--quiet", "Silent mode — exit code only")
  .action(async (opts) => {
    const checks = [];
    const quiet = opts.quiet;

    // Node.js
    const nodeVersion = process.version;
    const nodeMajor = parseInt(nodeVersion.slice(1));
    checks.push({ name: "Node.js", ok: nodeMajor >= 20, detail: nodeVersion, fix: nodeMajor < 20 ? "Install Node.js 20+ from nodejs.org" : null });

    // Python
    try {
      const { stdout } = await execa("python3", ["--version"], { reject: false });
      checks.push({ name: "Python 3", ok: true, detail: stdout.trim() });
    } catch {
      checks.push({ name: "Python 3", ok: false, detail: "Not found", fix: "brew install python@3.11" });
    }

    // Ollama
    const ollama = await checkOllama();
    checks.push({ name: "Ollama", ok: ollama.ok, detail: ollama.ok ? `${ollama.models.length} model(s)` : "Offline", fix: !ollama.ok ? "Run: ollama serve" : null });

    // Ollama model
    if (ollama.ok) {
      const hasWorker = ollama.models.some(m => m.includes("llama3.2") || m.includes("llama3"));
      checks.push({ name: "Worker model", ok: hasWorker, detail: hasWorker ? "Found" : "Missing", fix: !hasWorker ? "ollama pull llama3.2:3b" : null });
    }

    // .env
    const envOk = existsSync(join(ROOT, ".env"));
    checks.push({ name: ".env file", ok: envOk, detail: envOk ? "Present" : "Missing", fix: !envOk ? "laruche init" : null });

    // Telegram token
    if (envOk) {
      const { isConfigured } = await import("../src/config.js");
      const configured = isConfigured();
      // Telegram est optionnel en standalone — warning seulement, non-bloquant
      checks.push({ name: "Telegram config", ok: true, detail: configured ? "Configured" : "Token/ID missing (standalone OK)", fix: !configured ? "Edit .env: set TELEGRAM_BOT_TOKEN + ADMIN_TELEGRAM_ID" : null });
    }

    // PM2
    try {
      await execa("npx", ["pm2", "--version"], { reject: false });
      checks.push({ name: "PM2", ok: true, detail: "Available" });
    } catch {
      checks.push({ name: "PM2", ok: false, detail: "Not found", fix: "npm install -g pm2" });
    }

    // Port 9001 (HUD)
    try {
      const { createServer } = await import("net");
      await new Promise((res, rej) => {
        const s = createServer();
        s.once("error", (e) => { e.code === "EADDRINUSE" ? res(false) : res(true); });
        s.once("listening", () => { s.close(); res(true); });
        s.listen(9001, "127.0.0.1");
      }).then(free => {
        checks.push({ name: "Port 9001 (HUD)", ok: true, detail: free ? "Available" : "In use (HUD running)" });
      });
    } catch { checks.push({ name: "Port 9001 (HUD)", ok: true, detail: "Unknown" }); }

    // rsync
    try {
      await execa("rsync", ["--version"], { reject: false });
      checks.push({ name: "rsync", ok: true, detail: "Available" });
    } catch {
      checks.push({ name: "rsync", ok: false, detail: "Not found", fix: "brew install rsync" });
    }

    if (!quiet) {
      console.log(chalk.hex("#F5A623").bold("\n🩺 LaRuche Doctor\n"));
    }

    let allOk = true;
    checks.forEach((c) => {
      if (!c.ok) allOk = false;
      if (!quiet) {
        const icon = c.ok ? chalk.green("✓") : chalk.red("✗");
        const name = c.name.padEnd(22);
        const detail = chalk.dim(c.detail);
        const fix = c.fix ? chalk.yellow(`  → ${c.fix}`) : "";
        console.log(`  ${icon} ${name} ${detail}${fix}`);
      }
    });

    if (!quiet) {
      console.log();
      if (allOk) {
        console.log(chalk.green("  ✅ Everything looks good. Run: laruche start\n"));
      } else {
        const failed = checks.filter(c => !c.ok).length;
        console.log(chalk.yellow(`  ⚠ ${failed} issue(s) found. Fix them then run: laruche doctor\n`));
      }
    }

    if (!allOk) process.exit(1);
  });

// ─── laruche skill ────────────────────────────────────────────────────────────
const skillCmd = program.command("skill").description("Gérer les skills de l'essaim");

skillCmd
  .command("list")
  .description("Lister les skills disponibles")
  .action(() => {
    const registry = loadRegistry();
    const skills = registry.skills || [];
    console.log(chalk.hex("#F5A623").bold(`\n🔧 Skills LaRuche (${skills.length})\n`));
    if (skills.length === 0) {
      console.log(chalk.dim("  Aucun skill enregistré.\n  Créez-en un: laruche skill create <description>\n"));
      return;
    }
    skills.forEach((s) => {
      const ttl = s.ttl ? chalk.yellow(` TTL:${s.ttl}`) : "";
      console.log(`  ${chalk.cyan("●")} ${s.name.padEnd(30)} ${chalk.dim(`v${s.version}`)}${ttl}`);
      if (s.description) console.log(chalk.dim(`      ${s.description}`));
    });
    console.log();
  });

skillCmd
  .command("create <description>")
  .description("Créer un nouveau skill via IA")
  .action(async (description) => {
    const spinner = ora(`Création du skill: "${description}"...`).start();
    try {
      const res = await fetch("http://localhost:8080/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: `/skill create ${description}` }),
      });
      spinner.succeed(chalk.green(`Skill créé: ${description}`));
    } catch {
      spinner.warn(chalk.yellow("LaRuche non démarrée. Lancez d'abord: laruche start"));
    }
  });

// ─── laruche hive ─────────────────────────────────────────────────────────────
program
  .command("hive")
  .description("🌐 Marketplace communauté — skills partagés par la ruche mondiale")
  .action(async () => {
    console.log(chalk.hex("#F5A623").bold("\n🌐 LaRuche HIVE — Communauté Mondiale\n"));

    const spinner = ora("Connexion à la ruche...").start();

    try {
      // GitHub registry (skills communauté)
      const res = await fetch(
        "https://raw.githubusercontent.com/AMFbot-Gz/LaRuche/main/.laruche/registry.json",
        { signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) throw new Error("Registry inaccessible");
      const community = await res.json();

      spinner.succeed(chalk.green(`${community.skills?.length || 0} skills communauté disponibles`));
      console.log();

      (community.skills || []).forEach((s) => {
        console.log(`  ${chalk.yellow("🐝")} ${chalk.bold(s.name).padEnd(30)} ${chalk.dim(s.description || "")}`);
      });
    } catch (e) {
      spinner.warn(chalk.dim("Registry communauté non disponible (mode offline)"));
      console.log(chalk.dim("\n  Partagez vos skills sur github.com/AMFbot-Gz/LaRuche\n"));
    }

    console.log();
    console.log(chalk.dim("  Pour contribuer: ") + chalk.cyan("laruche hive push <skill-name>"));
    console.log();
  });

// ─── laruche logs ─────────────────────────────────────────────────────────────
program
  .command("logs")
  .description("Afficher les logs en temps réel")
  .option("-n, --lines <n>", "Nombre de lignes", "50")
  .action(async (opts) => {
    await execa("npx", ["pm2", "logs", "--lines", opts.lines], {
      cwd: ROOT,
      stdio: "inherit",
      reject: false,
    });
  });

// ─── laruche rollback ─────────────────────────────────────────────────────────
program
  .command("rollback [snapshot]")
  .description("Restaurer un snapshot système")
  .action(async (snapshot) => {
    if (!snapshot) {
      // Lister les snapshots disponibles
      const { readdirSync, readFileSync, statSync } = await import("fs");
      const ROLLBACK_DIR = join(ROOT, ".laruche/rollback");
      try {
        const dirs = readdirSync(ROLLBACK_DIR)
          .filter((d) => { try { return statSync(join(ROLLBACK_DIR, d)).isDirectory(); } catch { return false; } });

        if (dirs.length === 0) {
          console.log(chalk.dim("Aucun snapshot disponible."));
          return;
        }

        console.log(chalk.hex("#F5A623").bold("\n⏪ Snapshots disponibles:\n"));
        dirs.slice(0, 10).forEach((d, i) => {
          console.log(`  ${chalk.dim(String(i + 1).padStart(2))}. ${d}`);
        });
        console.log(chalk.dim(`\nUsage: laruche rollback <snapshot-id>\n`));
      } catch {
        console.log(chalk.dim("Dossier rollback introuvable."));
      }
      return;
    }

    const spinner = ora(`Restauration: ${snapshot}...`).start();
    try {
      const { execa } = await import("execa");
      const ROLLBACK_DIR = join(ROOT, ".laruche/rollback");
      await execa("rsync", ["-av", "--checksum",
        `${ROLLBACK_DIR}/${snapshot}/src/`, `${ROOT}/src/`],
        { reject: false }
      );
      spinner.succeed(chalk.green(`Rollback vers ${snapshot} effectué.`));
    } catch (e) {
      spinner.fail(chalk.red(`Erreur: ${e.message}`));
    }
  });

// ─── laruche send ─────────────────────────────────────────────────────────────
program
  .command("send <message...>")
  .description("Envoyer une commande à l'essaim")
  .action(async (messageParts) => {
    const message = messageParts.join(" ");
    const spinner = ora(`Envoi: "${message}"...`).start();
    try {
      const res = await fetch("http://localhost:8080/api/command", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command: message }),
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json();
      if (data.success) {
        spinner.succeed(chalk.green("Commande envoyée à l'essaim."));
      } else {
        spinner.fail(chalk.red(data.error || "Erreur inconnue"));
      }
    } catch {
      spinner.fail(chalk.red("LaRuche non disponible. Lancez: laruche start"));
    }
  });

// ─── laruche models ───────────────────────────────────────────────────────────
program
  .command("models")
  .description("Voir et configurer les modèles Ollama (auto-détection)")
  .option("--set-role <role=model>", "Forcer un modèle pour un rôle (ex: architect=qwen3-coder:14b)")
  .action(async (opts) => {
    const { autoDetectRoles, getAvailableModels } = await import("../src/model_router.js");

    console.log(chalk.hex("#F5A623").bold("\n🐝 Configuration Modèles LaRuche\n"));

    const spinner = ora("Interrogation Ollama...").start();
    const [roles, available] = await Promise.all([autoDetectRoles(), getAvailableModels()]);
    spinner.stop();

    const icons = {
      strategist:  "👑 L1 Stratège   ",
      architect:   "🔧 L2 Architecte ",
      worker:      "⚡ L3 Ouvrière   ",
      vision:      "👁 L4 Vision     ",
      visionFast:  "📷 L4 Vision fast",
      synthesizer: "🧠 Synthèse      ",
    };

    for (const [role, model] of Object.entries(roles)) {
      console.log(`  ${chalk.dim(icons[role] || role)} → ${chalk.cyan(model)}`);
    }

    console.log(chalk.bold(`\n  Modèles Ollama disponibles (${available.length}):`));
    available.forEach((m) => {
      const used = Object.values(roles).includes(m);
      console.log(`  ${used ? chalk.green("✓") : chalk.dim("○")} ${m}`);
    });

    if (opts.setRole) {
      const [role, model] = opts.setRole.split("=");
      if (role && model) {
        const { readFileSync, writeFileSync } = await import("fs");
        const configPath = join(ROOT, ".laruche/config.json");
        const config = JSON.parse(readFileSync(configPath, "utf-8"));
        if (!config.models) config.models = {};
        config.models[role] = model;
        writeFileSync(configPath, JSON.stringify(config, null, 2));
        console.log(chalk.green(`\n✅ Rôle "${role}" → "${model}" configuré`));
      }
    }

    console.log(chalk.dim(`\n  Pour forcer un modèle: laruche models --set-role architect=qwen3-coder:14b\n`));
  });

// ─── laruche agent ────────────────────────────────────────────────────────────
program
  .command("agent <name> [task...]")
  .description("Lancer un agent (operator | devops | builder)")
  .option("-s, --session <id>", "Reprendre une session existante")
  .option("--no-stream", "Désactiver le streaming")
  .action(async (name, taskParts, opts) => {
    const task = taskParts?.join(" ") || "";

    if (!task) {
      console.log(chalk.hex("#F5A623").bold("\n🤖 Agents LaRuche\n"));
      const agents = ["operator", "devops", "builder"];
      agents.forEach(a => console.log(`  ${chalk.cyan("●")} ${a}`));
      console.log(chalk.dim("\n  Usage: laruche agent devops 'analyse les logs PM2'\n"));
      return;
    }

    console.log(chalk.hex("#F5A623").bold(`\n🤖 Agent: ${name}\n`));
    console.log(chalk.dim(`Task: ${task}\n`));

    const spinner = ora(chalk.dim(`Agent ${name} en cours...`)).start();

    try {
      const { runAgent } = await import("../src/agents/agentBridge.js");

      let buffer = "";
      const result = await runAgent({
        agentName: name,
        userInput: task,
        sessionId: opts.session,
        onToken: (t) => {
          spinner.stop();
          process.stdout.write(t);
          buffer += t;
        },
        onToolCall: (tool, args) => {
          if (!buffer) spinner.text = chalk.dim(`[${tool}] en cours...`);
          else console.log(chalk.dim(`\n⚙️  ${tool}(${JSON.stringify(args).slice(0, 60)})`));
        },
      });

      if (buffer) console.log(); // newline after stream
      spinner.succeed(chalk.green(`Terminé — ${result.iterations} itérations, ${result.tool_calls_count} outils`));
      console.log(chalk.dim(`Session: ${result.sessionId}\n`));

    } catch (e) {
      spinner.fail(chalk.red(`Erreur: ${e.message}`));
      process.exit(1);
    }
  });

// ─── laruche session ──────────────────────────────────────────────────────────
program
  .command("session [agent]")
  .description("Lister ou reprendre des sessions agent")
  .action(async (agentName) => {
    const { readdirSync, readFileSync, statSync } = await import("fs");
    const { join: pathJoin } = await import("path");
    const sessionsDir = pathJoin(process.cwd(), "workspace/sessions");

    console.log(chalk.hex("#F5A623").bold("\n📋 Sessions LaRuche\n"));

    try {
      const agents = agentName ? [agentName] : readdirSync(sessionsDir);
      for (const agent of agents) {
        const agentDir = pathJoin(sessionsDir, agent);
        try {
          const files = readdirSync(agentDir)
            .filter(f => f.endsWith(".json"))
            .map(f => {
              const data = JSON.parse(readFileSync(pathJoin(agentDir, f), "utf-8"));
              return { file: f, ...data };
            })
            .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
            .slice(0, 5);

          if (files.length > 0) {
            console.log(chalk.bold(`  ${agent}:`));
            files.forEach(s => {
              const status = s.status === "completed" ? chalk.green("✓") : s.status === "error" ? chalk.red("✗") : chalk.yellow("~");
              const date = new Date(s.updated_at).toLocaleString("fr-FR");
              console.log(`    ${status} ${s.id.slice(0, 30).padEnd(32)} ${chalk.dim(date)}`);
            });
          }
        } catch { /* skip */ }
      }
    } catch {
      console.log(chalk.dim("  Aucune session trouvée. Lancez: laruche agent devops 'votre tâche'\n"));
    }
    console.log();
  });

// ─── laruche dev ──────────────────────────────────────────────────────────────
program
  .command("dev")
  .description("Mode développement — lance queen_oss.js directement (sans PM2)")
  .action(async () => {
    console.log(chalk.hex("#F5A623").bold("\n🔧 LaRuche Dev Mode\n"));
    console.log(chalk.dim("queen_oss.js — logs verbose — Ctrl+C pour arrêter\n"));

    const { spawn } = await import("child_process");
    const child = spawn("node", ["src/queen_oss.js"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "development", LOG_LEVEL: "debug", LARUCHE_MODE: "balanced" },
      stdio: "inherit",
    });

    process.on("SIGINT", () => { child.kill("SIGTERM"); process.exit(0); });
    child.on("exit", (code) => process.exit(code || 0));
  });

// ─── laruche help ─────────────────────────────────────────────────────────────
program
  .command("help")
  .description("Aide détaillée avec exemples")
  .action(() => {
    console.log("\n" + BANNER + "\n");
    console.log(chalk.hex("#F5A623").bold("Commandes principales:\n"));

    const cmds = [
      ["laruche init",              "Configurer les API keys et le bot Telegram"],
      ["laruche start",             "Démarrer l'essaim (mode balanced par défaut)"],
      ["laruche start --headless",  "Démarrer en mode VPS (core + MCP seulement)"],
      ["laruche start --full",      "Démarrer en mode desktop (HUD Electron inclus)"],
      ["laruche dev",               "Lancer queen_oss.js directement (debug)"],
      ["laruche stop",              "Arrêter tous les processus"],
      ["laruche status",            "État du système et des agents"],
      ["laruche doctor",            "Diagnostic complet"],
      ["laruche doctor --quiet",    "Diagnostic silencieux (exit code uniquement)"],
      ["laruche logs",              "Logs en temps réel (PM2)"],
      ["laruche models",            "Voir/configurer les modèles Ollama"],
      ["laruche agent devops <t>",  "Lancer un agent sur une tâche"],
      ["laruche session",           "Lister les sessions agent"],
      ["laruche skill list",        "Lister les skills disponibles"],
      ["laruche skill create <d>",  "Créer un skill via IA"],
      ["laruche hive",              "Marketplace skills communauté"],
      ["laruche send <msg>",        "Envoyer une commande à l'essaim"],
      ["laruche rollback",          "Lister / restaurer un snapshot"],
    ];

    cmds.forEach(([cmd, desc]) => {
      console.log(`  ${chalk.cyan(cmd.padEnd(36))} ${chalk.dim(desc)}`);
    });

    console.log(chalk.hex("#F5A623").bold("\nExemples:\n"));
    const examples = [
      "laruche start --headless",
      "laruche start --full --dev",
      "laruche agent devops 'analyse les logs PM2 des 24 dernières heures'",
      "laruche models --set-role architect=qwen3-coder:14b",
      "laruche doctor --quiet && echo OK",
      "LARUCHE_MODE=high laruche start",
    ];
    examples.forEach(ex => console.log(`  ${chalk.yellow("$")} ${ex}`));
    console.log();
  });

// ─── laruche intent ───────────────────────────────────────────────────────────
program
  .command("intent <text...>")
  .description("Pipeline planner+operator sur une intention naturelle")
  .action(async (textParts) => {
    const intent = textParts.join(" ");
    console.log(chalk.hex("#F5A623").bold(`\n🧠 Intention: "${intent}"\n`));

    const spinner = ora(chalk.dim("Planification...")).start();

    try {
      const { runIntentPipeline } = await import("../src/agents/intentPipeline.js");

      const result = await runIntentPipeline(intent, {
        onPlanReady: (plan) => {
          spinner.succeed(chalk.green(`Plan: ${plan.goal}`));
          plan.steps.forEach((s, i) => {
            console.log(`  ${chalk.dim(i + 1 + ".")} ${chalk.cyan(s.skill)} ${chalk.dim(JSON.stringify(s.params))}`);
          });
          console.log();
        },
        onStepDone: (cur, total, step, res) => {
          const icon = res?.success !== false ? chalk.green("✓") : chalk.red("✗");
          console.log(`  ${icon} ${step.skill}`);
        },
      });

      console.log();
      if (result.success) {
        console.log(chalk.green(`✅ Terminé — ${(result.duration / 1000).toFixed(1)}s`));
      } else {
        console.log(chalk.yellow(`⚠ Partiel: ${result.error || "certaines étapes ont échoué"}`));
      }
      console.log();
    } catch (e) {
      spinner.fail(chalk.red(e.message));
      process.exit(1);
    }
  });

// ─── laruche voice ────────────────────────────────────────────────────────────
program
  .command("voice")
  .description("Écoute vocale continue — dit 'LaRuche <commande>' pour agir")
  .option("--keyword <word>", "Mot-clé de déclenchement", "laruche")
  .action(async (opts) => {
    process.env.VOICE_KEYWORD = opts.keyword;
    console.log(chalk.hex("#F5A623").bold(`\n🎤 LaRuche Voice — mot-clé: "${opts.keyword}"\n`));
    console.log(chalk.dim(`Dites "${opts.keyword} <votre commande>" pour déclencher une action.`));
    console.log(chalk.dim("Ctrl+C pour arrêter.\n"));

    const { startVoiceContinuous } = await import("../src/voice_continuous.js");
    startVoiceContinuous();

    await new Promise(() => {}); // keep alive
  });

// ─── laruche watch ────────────────────────────────────────────────────────────
program
  .command("watch")
  .description("Watcher proactif — surveille l'écran et alerte sur Telegram")
  .option("--interval <ms>", "Intervalle de scan en ms", "60000")
  .action(async (opts) => {
    console.log(chalk.hex("#F5A623").bold(`\n👁 LaRuche Watcher — scan toutes les ${parseInt(opts.interval)/1000}s\n`));
    console.log(chalk.dim("Détection: emails urgents, erreurs, notifications."));
    console.log(chalk.dim("Ctrl+C pour arrêter.\n"));

    const { startProactiveWatcher } = await import("../src/proactive_watcher.js");
    await startProactiveWatcher(parseInt(opts.interval));

    await new Promise(() => {}); // keep alive
  });

// ─── laruche playwright ───────────────────────────────────────────────────────
program
  .command("playwright <action> [args...]")
  .description("Actions Playwright directes (goto, click, fill, screenshot...)")
  .action(async (action, argsParts) => {
    const arg = argsParts?.join(" ") || "";
    const spinner = ora(chalk.dim(`pw.${action}(${arg.slice(0, 40)})`)).start();

    try {
      const { execa } = await import("execa");
      const toolMap = {
        goto: () => ["pw.goto", { url: arg }],
        click: () => ["pw.click", { selector: arg }],
        fill: () => { const [sel, ...rest] = arg.split(" "); return ["pw.fill", { selector: sel, text: rest.join(" ") }]; },
        screenshot: () => ["pw.screenshot", {}],
        close: () => ["pw.close", {}],
        state: () => ["pw.getPageState", {}],
        youtube: () => ["pw.searchYouTube", { query: arg }],
      };

      const resolved = toolMap[action];
      if (!resolved) { spinner.fail(`Action inconnue: ${action}`); return; }

      const [fn, fnArgs] = resolved();
      const rpc = JSON.stringify({ jsonrpc:"2.0", id:1, method:"tools/call", params:{ name:fn, arguments:fnArgs } });
      const { stdout } = await execa("node", ["mcp_servers/playwright_mcp.js"], { input:rpc, cwd:ROOT, timeout:20000, reject:false });
      const r = JSON.parse(stdout.trim());
      const text = r.result?.content?.[0]?.text;
      const result = text ? JSON.parse(text) : r;

      spinner.succeed(chalk.green(`${fn}`));
      if (result.title) console.log(chalk.dim(`  Title: ${result.title}`));
      if (result.results) console.log(chalk.dim(`  Results: ${JSON.stringify(result.results).slice(0, 200)}`));
      if (result.path) console.log(chalk.dim(`  Screenshot: ${result.path}`));
    } catch (e) {
      spinner.fail(chalk.red(e.message));
    }
  });

program.parse();
