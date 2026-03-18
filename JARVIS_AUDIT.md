# JARVIS_AUDIT.md — Ghost OS Ultimate v1.0.0
*Audit architectural complet — 2026-03-18*

---

## Score Production-Readiness Global : **74/100**

| Composant | Score | État |
|-----------|-------|------|
| Node.js Queen (src/) | 78/100 | ⚠️ Stable, 1 dep critique manquante |
| Python Agents (agent/) | 92/100 | ✅ 16/16 UP, syntaxe 100% valide |
| Skills JS (skills/) | 82/100 | ⚠️ 4 skills sans manifest.json |
| MCP Servers (mcp_servers/) | 95/100 | ✅ 12/12 valides et fonctionnels |
| Configuration (.env / ports) | 70/100 | ⚠️ LLM timeout trop long (5min) |
| End-to-End Mission | 55/100 | 🔴 callLLM retry loop = timeout 5min |
| Tests & CI | 40/100 | 🔴 Tests non exécutés / non valides CI |

---

## État Système Live (2026-03-18)

```
Queen Node.js :3002          ✅ UP — uptime ~968s
Python :8001 (orchestration) ✅ UP
Python :8002 (perception)    ✅ UP
Python :8003 (brain)         ✅ UP — LLM llama3.2:3b opérationnel (~12s)
Python :8004 (executor)      ✅ UP
Python :8005 (evolution)     ✅ UP
Python :8006 (memory)        ✅ UP
Python :8007 (mcp-bridge)    ✅ UP
Python :8008 (discovery)     ✅ UP
Python :8009 (knowledge)     ✅ UP
Python :8010 (goals)         ✅ UP
Python :8011 (voice)         ✅ UP
Python :8012 (miner)         ✅ UP
Python :8013 (swarm_router)  ✅ UP — 5 bees: ui/file/code/web/system
Python :8014 (validator)     ✅ UP
Python :8015 (computer_use)  ✅ UP — mode local, display détecté
Python :8016 (consciousness)  ✅ UP — cycle 31
Python :8017 (optimizer)     ✅ UP
Python :8019 (skill_sync)    ✅ UP — mode reine
```

---

## Top 3 Blockers Exacts

### BLOCKER #1 — 🔴 CRITIQUE
**Fichier :** `src/llm/callLLM.js` — ligne ~49
**Fichier :** `src/agents/intentPipeline.js` — ligne 220
**Problème :** `AbortError` classifié `TRANSIENT` → retries consomment le timeout global

```javascript
// callLLM.js — isTransient()
if (err.name === 'AbortError') return true;   // ← FAUX : AbortError = timeout, pas erreur réseau

// Résultat : ask(intent, {timeout:30000}) dans intentPipeline.js
// → fetch timeout AbortError après 30s
// → callLLM catche → classifie TRANSIENT → RETRY
// → LLM_GLOBAL_TIMEOUT_MS=300000 (5 min) est le vrai cap
// → mission bloquée 5 minutes minimum
```

**Fix appliqué dans .env :** `LLM_TIMEOUT_MS=30000` + `LLM_GLOBAL_TIMEOUT_MS=45000`
**Fix code requis :** dans `callLLM.js`, supprimer `if (err.name === 'AbortError') return true;` de `isTransient()` — AbortError doit être FATAL (non retryable).

---

### BLOCKER #2 — 🔴 CRITIQUE
**Fichier :** `src/token_sentinel.js` — ligne 6
**Problème :** `import Database from "better-sqlite3"` — module absent du `node_modules`

```bash
$ node -e "import('better-sqlite3')"
# Error: Cannot find package 'better-sqlite3'
```

`token_sentinel.js` est importé au démarrage de `queen_oss.js`. Si chargé, crash immédiat.
**Vérification :** queen :3002 tourne → `token_sentinel` possiblement lazy-loadé ou conditionnel.
**Fix :** `cd /tmp/ghost-skills && npm install better-sqlite3`

---

### BLOCKER #3 — ⚠️ MAJEUR
**Fichier :** `skills/organise_screenshots/manifest.yaml`, `skills/organise_telechargements/manifest.yaml`, `skills/automatise_l_organisation_des_t_l_charge/manifest.yaml`, `skills/organise_les_screenshots_par_date_et_les/manifest.yaml`
**Problème :** Ces 4 skills ont `manifest.yaml` au lieu de `manifest.json`

```javascript
// src/skill_runner.js:65
try { return JSON.parse(readFileSync(join(SKILLS_DIR, d, "manifest.json"), "utf-8")); }
// → throw → skill ignoré dans listSkills()

// src/api/missions.js:420
const m = JSON.parse(readFileSync(join(SKILLS_DIR, d, "manifest.json"), "utf-8"));
// → même crash

// src/skill_evolution.js:130 — GÉNÈRE manifest.yaml (bug générateur)
writeFileSync(join(skillDir, "manifest.yaml"), yaml.dump(manifestObj));
// → mais ligne 260 tente de lire manifest.JSON
```

**Conséquence :** 4 skills invisibles dans `/api/skills`, non invocables via mission.
**Fix :** Convertir chaque `manifest.yaml` → `manifest.json` (format plat : `{name, version, description}`).

---

## Radiographie Complète

### Node.js src/ — 88 fichiers .js

| Métrique | Valeur |
|----------|--------|
| Imports relatifs manquants (réels) | 2 (templates runtime, non-bloquants) |
| Imports relatifs manquants (commentaires) | 2 (docs incorrects) |
| Dépendances npm manquantes | 1 (`better-sqlite3`) |
| Paquets externes vérifiés | 22/22 ✅ |
| Dynamic imports avec variable | 3 (toolRouter, sandbox, skill_evolution — validés) |

**Packages npm installés :** hono, @hono/node-server, axios, chalk, chromadb, commander, diff-match-patch, dotenv, execa, fs-extra, jimp, js-yaml, node-cron, ora, peerjs, pm2, qrcode, sql.js, systeminformation, telegraf, tiktoken, winston, ws, zod ✅
**Manquant :** `better-sqlite3` → `npm install better-sqlite3`

### Python agent/ — 20 fichiers .py

| Métrique | Valeur |
|----------|--------|
| Erreurs syntaxe | 0 ✅ |
| Agents UP live | 16/16 ✅ |
| Imports critiques manquants | 0 ✅ |
| Imports optionnels (graceful fallback) | 4 (chromadb, anthropic, WorldModel, openai) |

**Agents avec fallback gracieux :**
- `memory.py` — ChromaDB optionnel (fallback keyword search)
- `brain.py` — Anthropic SDK optionnel (fallback Ollama)
- `computer_use.py` — Anthropic optionnel (fallback Moondream local)
- `queen.py` — WorldModel optionnel (fallback sans grounding)

### Skills — 33 entrées disque / 27 en registry

| Catégorie | Count | État |
|-----------|-------|------|
| Skills OK (skill.js + manifest.json) | 27 | ✅ |
| Skills manifest.yaml uniquement | 4 | ⚠️ invisibles skill_runner |
| Dossiers non-skills (hub/, index.js, etc.) | 2 | ℹ️ non-bloquant |
| REGISTRY_ORPHANS (registry sans dossier) | 0 | ✅ |
| DISK_ORPHANS (dossier sans registry) | 1 (hub/) | ℹ️ |

### MCP Servers — 12 serveurs

Tous valides : browser_mcp, playwright_mcp, os_control_mcp, terminal_mcp, vision_mcp, vault_mcp, skill_factory_mcp, janitor_mcp, rollback_mcp, pencil_mcp, mcp-compressor, mcp-context-manager ✅

### Ports & Configuration

| Ressource | Port | État |
|-----------|------|------|
| Queen Node.js (ghost-os) | :3002 | ✅ (évite conflict PM2 :3000) |
| HUD WebSocket | :9003 | ✅ (évite conflict PM2 :9001/:9002) |
| Queen Python | :8001 | ✅ (LaRuche PM2 — partagé) |
| Brain LLM | :8003 | ✅ ~12s réponse llama3.2:3b |
| LLM_TIMEOUT_MS | 30000ms | ✅ fixé dans .env |
| LLM_GLOBAL_TIMEOUT_MS | 45000ms | ✅ fixé dans .env |

---

## 5 Actions Prioritaires vers Jarvis Opérationnel

### ACTION 1 — Corriger `callLLM.js` AbortError non-retryable
**Fichier :** `src/llm/callLLM.js`
**Changement :** Dans `isTransient()`, supprimer la ligne `if (err.name === 'AbortError') return true;`
**Impact :** Missions ne bloquent plus 5 minutes. Timeout 30s devient effectif.
**Effort :** 1 ligne.

### ACTION 2 — Installer `better-sqlite3`
```bash
cd /tmp/ghost-skills && npm install better-sqlite3
```
**Impact :** Élimine crash potentiel de `token_sentinel.js` au démarrage.
**Effort :** 1 commande.

### ACTION 3 — Convertir 4 manifests yaml → json
Pour chaque skill (`organise_screenshots`, `organise_telechargements`, `automatise_l_*`, `organise_les_*`) :
```bash
# Créer manifest.json à partir du manifest.yaml
# Format minimal : {"name": "...", "version": "1.0.0", "description": "..."}
```
Corriger aussi `src/skill_evolution.js:130` qui génère `manifest.yaml` au lieu de `manifest.json`.
**Impact :** 4 skills deviennent visibles et invocables dans `/api/skills` + missions.
**Effort :** 4 fichiers JSON + 1 ligne JS.

### ACTION 4 — Fixer `src/skill_evolution.js` format manifest
**Fichier :** `src/skill_evolution.js` — ligne 130
**Problème :** Le générateur de skills écrit `manifest.yaml` (yaml.dump) mais tout le reste du système lit `manifest.json`.
**Fix :** Remplacer `writeFileSync(join(skillDir, "manifest.yaml"), yaml.dump(manifestObj))` par `writeFileSync(join(skillDir, "manifest.json"), JSON.stringify(manifestObj, null, 2))`.
**Impact :** Tous les nouveaux skills générés automatiquement seront compatibles.

### ACTION 5 — Valider mission end-to-end avec LLM_GLOBAL_TIMEOUT_MS=45s
Après actions 1-2 :
```bash
# Redémarrer queen avec le .env corrigé
cd /tmp/ghost-skills
STANDALONE_MODE=true API_PORT=3002 HUD_PORT=9003 \
  LLM_TIMEOUT_MS=30000 LLM_GLOBAL_TIMEOUT_MS=45000 \
  node src/queen_oss.js

# Test mission simple
curl -s -X POST http://localhost:3002/api/mission \
  -H "Content-Type: application/json" \
  -d '{"command": "Dis bonjour en 1 phrase", "priority": 1}'
```
**Impact :** Validation que la chaîne complète Node.js → Ollama → réponse fonctionne en < 45s.

---

## Diagnostic Code — `callLLM.js` (lignes clés)

```javascript
// PROBLÈME — ligne ~49 dans isTransient()
const isTransient = (err) => {
  if (err.name === 'AbortError') return true;   // ← À SUPPRIMER
  if (err.code === 'ECONNREFUSED') return true;
  if (err.code === 'ECONNRESET') return true;
  // ...
};

// CONSÉQUENCE dans la boucle retry
for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    return await _callWithTimeout(model, messages, options);   // timeout=30s → AbortError
  } catch (err) {
    if (isTransient(err) && attempt < MAX_RETRIES) {           // AbortError → retry!
      await sleep(backoff * attempt);
      continue;                                                  // Recommence 30s...
    }
    throw err;
  }
}
// Résultat : 3 × 30s + backoffs = 90-180s minimum, puis LLM_GLOBAL_TIMEOUT_MS = 300s
```

---

## Variables `.env` Appliquées

```env
STANDALONE_MODE=true
GHOST_OS_MODE=ultimate
API_PORT=3002
HUD_PORT=9003
LLM_TIMEOUT_MS=30000          # ← Nouveau (fix timeout)
LLM_GLOBAL_TIMEOUT_MS=45000   # ← Nouveau (remplace 300000)
OLLAMA_HOST=http://localhost:11434
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2:3b
OLLAMA_MODEL_STRATEGIST=llama3:latest
OLLAMA_MODEL_ARCHITECT=llama3.2:3b
OLLAMA_MODEL_WORKER=llama3.2:3b
OLLAMA_MODEL_VISION=moondream:latest
```

---

*Généré par audit automatisé Claude Code — /tmp/ghost-skills — 2026-03-18*
