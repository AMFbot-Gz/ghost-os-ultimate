#!/usr/bin/env node
/**
 * bin/ghost.js — CLI Ghost OS Ultimate
 *
 * Usage :
 *   ghost start [--mode ultimate|lite|cloud]
 *   ghost status
 *   ghost mission "Ta mission ici"
 *   ghost setup          → Analyse l'environnement et génère la config
 *   ghost skill list
 *   ghost skill install <name>
 */

import { Command } from 'commander';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');

const program = new Command();

program
  .name('ghost')
  .description('Ghost OS Ultimate — Agent autonome hybride')
  .version('1.0.0');

// ─── start ─────────────────────────────────────────────────────────────────

program
  .command('start')
  .description('Démarrer Ghost OS Ultimate')
  .option('-m, --mode <mode>', 'Mode d\'exécution: ultimate|lite|cloud', 'ultimate')
  .option('--no-python', 'Démarrer uniquement la queen Node.js')
  .action(async (opts) => {
    console.log(`\n🚀 Ghost OS Ultimate — démarrage en mode ${opts.mode.toUpperCase()}\n`);

    // Démarrer les couches Python si demandé
    if (opts.python !== false) {
      console.log('  → Démarrage des 7 couches Python...');
      const pyProc = spawn('python3', ['start_agent.py'], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, GHOST_OS_MODE: opts.mode },
        detached: false,
      });
      pyProc.on('error', err => console.error('  ❌ Couches Python:', err.message));
    }

    // Démarrer la queen Node.js
    console.log('  → Démarrage de la Queen Node.js...');
    const env = {
      ...process.env,
      STANDALONE_MODE:  'true',
      GHOST_OS_MODE:    opts.mode,
    };

    const nodeProc = spawn('node', ['src/queen_oss.js'], {
      cwd: ROOT, stdio: 'inherit', env,
    });

    nodeProc.on('error', err => console.error('  ❌ Queen Node.js:', err.message));
    nodeProc.on('exit', code => {
      if (code !== 0) console.error(`  ❌ Queen terminée avec code ${code}`);
    });
  });

// ─── status ────────────────────────────────────────────────────────────────

program
  .command('status')
  .description('État des couches')
  .action(async () => {
    console.log('\n📊 Ghost OS Ultimate — État des couches\n');
    try {
      execSync('python3 scripts/status_agent.py', { cwd: ROOT, stdio: 'inherit' });
    } catch {
      // Fallback : curl direct
      const ports = { queen: 8001, perception: 8002, brain: 8003, executor: 8004,
                      evolution: 8005, memory: 8006, mcp_bridge: 8007, 'node-queen': 3000 };
      for (const [name, port] of Object.entries(ports)) {
        try {
          execSync(`curl -s --max-time 1 http://localhost:${port}/health > /dev/null 2>&1`);
          console.log(`  ✅ ${name.padEnd(12)} :${port}`);
        } catch {
          console.log(`  ❌ ${name.padEnd(12)} :${port}`);
        }
      }
    }
  });

// ─── mission ───────────────────────────────────────────────────────────────

program
  .command('mission <text>')
  .description('Lancer une mission')
  .option('-p, --priority <n>', 'Priorité (1-5)', '3')
  .action(async (text, opts) => {
    console.log(`\n🎯 Mission: "${text}"\n`);
    // Utilise fetch natif Node.js 18+ — pas d'interpolation shell, pas d'injection possible
    try {
      const res = await fetch('http://localhost:8001/mission', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ command: text, priority: parseInt(opts.priority, 10) }),
        signal:  AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const result = await res.json();
      console.log(result);
    } catch (err) {
      console.error('❌ Erreur:', err.message);
      console.error('   Vérifie que les couches Python sont démarrées (ghost start)');
    }
  });

// ─── setup ─────────────────────────────────────────────────────────────────

program
  .command('setup')
  .description('Analyser l\'environnement et générer la configuration optimale')
  .action(async () => {
    const { AutoDeployment } = await import('../runtime/deployment/auto_deployment.js');
    const deployer = new AutoDeployment();
    await deployer.analyzeEnvironment();
    deployer.printReport();
    await deployer.deploy();
  });

// ─── skill ─────────────────────────────────────────────────────────────────

program
  .command('skill <action> [name]')
  .description('Gérer les skills: list | install <name> | update <name> | uninstall <name> | stats')
  .action(async (action, name) => {
    const { SkillsMarketplace } = await import('../ecosystem/marketplace/skills_marketplace.js');
    const market = new SkillsMarketplace({ skills_dir: join(ROOT, 'skills') });

    switch (action) {
      case 'list': {
        const installed = market.listInstalled();
        console.log(`\n📦 Skills installés (${installed.length}) :\n`);
        installed.forEach(s => console.log(`  • ${s.name.padEnd(35)} v${s.version || '?'}`));
        break;
      }
      case 'install': {
        if (!name) { console.error('Usage: ghost skill install <name>'); process.exit(1); }
        console.log(`\n📦 Installation de "${name}"...`);
        const result = await market.install(name);
        if (result.skipped)  console.log(`  ⏭  ${name} ${result.message}`);
        else if (result.success) console.log(`  ✅ ${name} installé`);
        else console.error(`  ❌ ${result.error || JSON.stringify(result.errors)}`);
        break;
      }
      case 'update': {
        if (!name) { console.error('Usage: ghost skill update <name> [<source_path>]'); process.exit(1); }
        console.log(`\n🔄 Mise à jour de "${name}"...`);
        const upResult = await market.upgrade(name);
        if (!upResult.success) {
          console.error(`  ❌ ${upResult.error}`);
        } else if (upResult.upgraded) {
          console.log(`  ✅ ${name} mis à jour v${upResult.from} → v${upResult.to}`);
        } else {
          console.log(`  ⏭  ${name} déjà à jour (v${upResult.to || '?'})`);
        }
        break;
      }
      case 'uninstall': {
        if (!name) { console.error('Usage: ghost skill uninstall <name>'); process.exit(1); }
        const unResult = market.uninstall(name);
        console.log(unResult.success ? `  ✅ ${name} désinstallé` : `  ❌ ${unResult.error}`);
        break;
      }
      case 'stats': {
        const stats = market.getStats();
        console.log('\n📊 Marketplace stats:', stats);
        break;
      }
      default:
        console.error(`Action inconnue: ${action}. Options: list | install | update | uninstall | stats`);
    }
  });

program.parse();
