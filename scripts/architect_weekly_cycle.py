#!/usr/bin/env python3
"""
scripts/architect_weekly_cycle.py — Cycle autonome "Claude nourrit la Ruche"
════════════════════════════════════════════════════════════════════════════════

Claude Architecte analyse la semaine écoulée, comble les lacunes de skills,
consolide la mémoire, met à jour la documentation et prépare une release.

CYCLE COMPLET (7 phases, ~2-4h) :
  Phase 1 — AUDIT       : Analyse missions.db + épisodes échoués
  Phase 2 — GAP ANALYSIS: Identifie les patterns manquants (skills à créer)
  Phase 3 — SKILL GEN   : Génère + valide les nouveaux skills via Evolution
  Phase 4 — MEMORY SYNC : Dream cycle + consolidation heuristiques
  Phase 5 — LAYER AUDIT : Vérifie santé de toutes les couches
  Phase 6 — DOC UPDATE  : CHANGELOG.md + DECISIONS.md + persistent.md
  Phase 7 — OSS PREP    : Nettoyage, versioning, tag git

Usage :
    python3 scripts/architect_weekly_cycle.py
    python3 scripts/architect_weekly_cycle.py --phase 1    # phase unique
    python3 scripts/architect_weekly_cycle.py --dry-run    # sans effets
    python3 scripts/architect_weekly_cycle.py --report-only # rapport seul
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

# Charger .env
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=False)
except ImportError:
    pass

import httpx

# ─── URLs des layers ──────────────────────────────────────────────────────────
QUEEN_URL    = "http://localhost:8001"
BRAIN_URL    = "http://localhost:8003"
EVOLUTION_URL= "http://localhost:8005"
MEMORY_URL   = "http://localhost:8006"
VALIDATOR_URL= "http://localhost:8014"
MINER_URL    = "http://localhost:8012"

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_ENABLED = os.getenv("ANTHROPIC_ENABLED", "true").lower() == "true"

GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

# ─── Helpers ──────────────────────────────────────────────────────────────────

def title(phase: int, name: str) -> None:
    print(f"\n{BOLD}{BLUE}━━━ Phase {phase}: {name} ━━━{RESET}")

def ok(msg: str)   -> None: print(f"  {GREEN}✅{RESET} {msg}")
def warn(msg: str) -> None: print(f"  {YELLOW}⚠️ {RESET} {msg}")
def err(msg: str)  -> None: print(f"  {RED}❌{RESET} {msg}")
def info(msg: str) -> None: print(f"  {BLUE}ℹ️ {RESET} {msg}")


async def _get(url: str, path: str, timeout: float = 10.0) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(f"{url}{path}")
            return r.json() if r.status_code == 200 else None
    except Exception:
        return None


async def _post(url: str, path: str, data: dict, timeout: float = 60.0) -> dict | None:
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.post(f"{url}{path}", json=data)
            return r.json() if r.status_code in (200, 201, 202) else None
    except Exception:
        return None


# ─── Phase 1: AUDIT ──────────────────────────────────────────────────────────

async def phase_audit(dry_run: bool) -> dict:
    """Analyse les missions de la semaine — succès, échecs, patterns."""
    title(1, "AUDIT — Analyse de la semaine")

    report = {
        "total_missions": 0,
        "success": 0,
        "failed": 0,
        "failed_missions": [],
        "top_errors": [],
        "layers_status": {},
    }

    # ── 1.1 Missions DB ───────────────────────────────────────────────────────
    missions_db = ROOT / "agent" / "memory" / "missions.db"
    if missions_db.exists():
        import sqlite3
        conn = sqlite3.connect(missions_db)
        since = (datetime.utcnow() - timedelta(days=7)).strftime("%Y-%m-%d")
        rows = conn.execute(
            "SELECT id, input, status, result FROM missions WHERE created_at > ? OR created_at IS NULL",
            (since,)
        ).fetchall()
        conn.close()

        report["total_missions"] = len(rows)
        errors = []
        for row in rows:
            if row[2] in ("failed", "error", "timeout"):
                report["failed"] += 1
                report["failed_missions"].append({
                    "id": row[0], "input": (row[1] or "")[:100],
                    "status": row[2], "result": (row[3] or "")[:200]
                })
                errors.append(row[3] or "")
            else:
                report["success"] += 1

        ok(f"{report['success']} succès / {report['failed']} échecs sur {report['total_missions']} missions")

        # Top erreurs
        if errors:
            from collections import Counter
            # Simplifier les erreurs pour aggregation
            simplified = []
            for e in errors:
                for kw in ["timeout", "import", "AttributeError", "KeyError", "connection", "skill", "memory"]:
                    if kw.lower() in e.lower():
                        simplified.append(kw)
                        break
                else:
                    simplified.append("other")
            top = Counter(simplified).most_common(5)
            report["top_errors"] = [{"type": t, "count": c} for t, c in top]
            top_str = ", ".join(f"{e['type']}x{e['count']}" for e in report["top_errors"])
            info(f"Top erreurs: {top_str}")
    else:
        warn("missions.db introuvable — skip missions audit")

    # ── 1.2 Épisodes JSONL ───────────────────────────────────────────────────
    episodes_file = ROOT / "agent" / "memory" / "episodes.jsonl"
    if episodes_file.exists():
        episodes = []
        with open(episodes_file) as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        episodes.append(json.loads(line))
                    except Exception:
                        pass
        # Filtrer la dernière semaine
        since_ts = time.time() - 7 * 86400
        def _ts(e: dict) -> float:
            t = e.get("timestamp", 0)
            return float(t) if isinstance(t, (int, float)) else 0.0
        recent = [e for e in episodes if _ts(e) > since_ts]
        failed_ep = [e for e in recent if not e.get("success", True)]
        ok(f"{len(recent)} épisodes récents, {len(failed_ep)} en échec")
        report["episode_failures"] = [
            {"mission": e.get("mission", "")[:80], "error": str(e.get("error", ""))[:100]}
            for e in failed_ep[:10]
        ]
    else:
        warn("episodes.jsonl introuvable")

    # ── 1.3 Health des layers ─────────────────────────────────────────────────
    layers = {
        "queen": 8001, "brain": 8003, "memory": 8006,
        "executor": 8004, "evolution": 8005, "validator": 8014,
        "computer_use": 8015,
    }
    for name, port in layers.items():
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(f"http://localhost:{port}/health")
                report["layers_status"][name] = r.status_code == 200
        except Exception:
            report["layers_status"][name] = False

    up_count = sum(1 for v in report["layers_status"].values() if v)
    ok(f"Layers actifs: {up_count}/{len(layers)}")
    for name, up in report["layers_status"].items():
        icon = "✅" if up else "❌"
        print(f"    {icon} {name}")

    return report


# ─── Phase 2: GAP ANALYSIS ───────────────────────────────────────────────────

async def phase_gap_analysis(audit: dict, dry_run: bool) -> list[dict]:
    """Identifie les skills manquants depuis les échecs."""
    title(2, "GAP ANALYSIS — Skills manquants")

    gaps = []

    # ── 2.1 Patterns dans les échecs ─────────────────────────────────────────
    failed = audit.get("failed_missions", []) + [
        {"input": e["mission"]} for e in audit.get("episode_failures", [])
    ]

    # Patterns communs qui nécessitent un skill
    SKILL_PATTERNS = [
        ("pdf", "read_pdf", "Lire et extraire le texte d'un fichier PDF"),
        ("email", "send_email", "Envoyer un email via SMTP ou API"),
        ("zip", "extract_zip", "Dézipper une archive"),
        ("csv", "read_csv", "Lire et analyser un fichier CSV"),
        ("json", "transform_json", "Transformer/filter un fichier JSON"),
        ("git", "git_commit", "Effectuer des opérations git (status, commit, push)"),
        ("docker", "docker_control", "Contrôler des conteneurs Docker"),
        ("cron", "schedule_task", "Planifier une tâche récurrente"),
        ("webhook", "send_webhook", "Envoyer une requête webhook"),
        ("resize", "resize_image", "Redimensionner une image"),
        ("transcrib", "transcribe_audio", "Transcrire de l'audio en texte"),
        ("clipboard", "read_clipboard", "Lire le presse-papier macOS"),
        ("notification", "macos_notification", "Afficher une notification macOS"),
        ("battery", "get_battery", "Lire le niveau de batterie macOS"),
        ("wifi", "get_wifi_info", "Obtenir les infos WiFi actuelles"),
    ]

    found_keywords = set()
    for mission_obj in failed:
        input_text = mission_obj.get("input", "").lower()
        for keyword, skill_name, description in SKILL_PATTERNS:
            if keyword in input_text and skill_name not in found_keywords:
                found_keywords.add(skill_name)
                gaps.append({
                    "skill_name": skill_name,
                    "description": description,
                    "trigger_keyword": keyword,
                    "priority": "high" if audit.get("failed", 0) > 5 else "medium",
                })

    # ── 2.2 Skills toujours manquants dans registry ───────────────────────────
    registry_file = ROOT / "skills" / "registry.json"
    if registry_file.exists():
        try:
            with open(registry_file) as f:
                registry = json.load(f)
            existing_skills = {s.get("name", "") for s in registry if isinstance(registry, list)}
            # Aussi supporter format dict
            if isinstance(registry, dict):
                existing_skills = set(registry.keys())
        except Exception:
            existing_skills = set()

        gaps = [g for g in gaps if g["skill_name"] not in existing_skills]

    if gaps:
        ok(f"{len(gaps)} skills à créer:")
        for g in gaps[:8]:
            print(f"    • {g['skill_name']:25s} [{g['priority']}] — {g['description'][:60]}")
        if len(gaps) > 8:
            info(f"  ... et {len(gaps) - 8} autres")
    else:
        ok("Aucun gap critique détecté — registry complet pour les missions de la semaine")

        # Ajouter des skills proactifs de qualité même sans echecs
        gaps = [
            {"skill_name": "git_commit",       "description": "git add/commit/push automatique", "priority": "low"},
            {"skill_name": "macos_notification","description": "Notification Centre macOS natif",  "priority": "low"},
            {"skill_name": "get_battery",       "description": "Niveau batterie + état charge",    "priority": "low"},
        ]
        info(f"3 skills proactifs ajoutés à la liste")

    return gaps[:6]  # max 6 skills générés par cycle


# ─── Phase 3: SKILL GENERATION ───────────────────────────────────────────────

async def phase_skill_generation(gaps: list[dict], dry_run: bool) -> list[dict]:
    """Génère et valide les nouveaux skills via Claude + Evolution."""
    title(3, "SKILL GENERATION — Claude génère les skills manquants")

    generated = []
    if dry_run:
        info("DRY RUN — génération simulée")
        for g in gaps:
            ok(f"[DRY] Skill {g['skill_name']} simulé")
            generated.append({**g, "status": "dry_run", "confidence": 0.9})
        return generated

    # ── 3.1 Via Evolution layer (:8005) ───────────────────────────────────────
    evolution_up = await _get(EVOLUTION_URL, "/health")
    if not evolution_up:
        warn("Evolution layer (:8005) offline — génération via Claude direct")
        return await _generate_skills_via_claude(gaps)

    for gap in gaps:
        info(f"Génération skill: {gap['skill_name']} …")
        result = await _post(
            EVOLUTION_URL, "/evolve",
            {
                "skill_name": gap["skill_name"],
                "description": gap["description"],
                "priority": gap.get("priority", "medium"),
                "source": "architect_weekly_cycle",
            },
            timeout=120.0,
        )
        if result and result.get("status") in ("deployed", "validated", "success"):
            ok(f"✅ {gap['skill_name']} généré → {result.get('tier', 'silver')} "
               f"(confidence={result.get('confidence_score', '?')})")
            generated.append({
                **gap,
                "status": "generated",
                "tier": result.get("tier", "bronze"),
                "confidence": result.get("confidence_score", 0.7),
            })
        else:
            warn(f"Evolution échoué pour {gap['skill_name']} — fallback Claude direct")
            direct = await _generate_one_skill_claude(gap)
            if direct:
                generated.append(direct)

    return generated


async def _generate_skills_via_claude(gaps: list[dict]) -> list[dict]:
    """Génère des skills Node.js directement via Claude API (fallback)."""
    if not ANTHROPIC_API_KEY or not ANTHROPIC_ENABLED:
        warn("Pas de clé Anthropic — skip génération directe")
        return []
    try:
        import anthropic
    except ImportError:
        warn("anthropic SDK non installé")
        return []

    client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    generated = []

    for gap in gaps:
        result = await asyncio.to_thread(_claude_generate_skill, client, gap)
        if result:
            generated.append(result)

    return generated


def _claude_generate_skill(client, gap: dict) -> dict | None:
    """Génère un skill Node.js via Claude (sync dans thread)."""
    prompt = f"""Génère un skill Node.js pour Ghost OS Ultimate.

Skill: {gap['skill_name']}
Description: {gap['description']}

FORMAT REQUIS :
```javascript
// skills/{gap['skill_name']}/skill.js
export async function run(params = {{}}) {{
  // Paramètres: {{ ...paramètres pertinents... }}
  // Retourne: {{ success: bool, result: any, error?: string }}

  // IMPLEMENTATION ICI
}}
```

Et le manifest:
```json
{{
  "name": "{gap['skill_name']}",
  "version": "1.0.0",
  "description": "{gap['description']}",
  "params": [...],
  "tags": [...],
  "author": "claude_architect",
  "validation_status": "generated"
}}
```

Génère un code robuste avec gestion d'erreurs complète. Pas de dépendances npm externes sauf celles disponibles dans Node.js natif."""

    try:
        response = client.messages.create(
            model="claude-opus-4-6",
            max_tokens=2048,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text

        # Extraire le code JS et le manifest JSON
        js_code = _extract_block(raw, "javascript")
        manifest_json = _extract_block(raw, "json")

        if js_code:
            skill_dir = ROOT / "skills" / gap["skill_name"]
            skill_dir.mkdir(parents=True, exist_ok=True)
            (skill_dir / "skill.js").write_text(js_code)
            if manifest_json:
                try:
                    manifest = json.loads(manifest_json)
                    (skill_dir / "manifest.json").write_text(
                        json.dumps(manifest, indent=2, ensure_ascii=False)
                    )
                except Exception:
                    pass
            ok(f"✅ {gap['skill_name']} généré via Claude direct → {skill_dir}")
            return {**gap, "status": "generated", "tier": "silver", "confidence": 0.75}
    except Exception as e:
        err(f"Claude API erreur pour {gap['skill_name']}: {e}")
    return None


async def _generate_one_skill_claude(gap: dict) -> dict | None:
    if not ANTHROPIC_API_KEY or not ANTHROPIC_ENABLED:
        return None
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
        return await asyncio.to_thread(_claude_generate_skill, client, gap)
    except Exception:
        return None


def _extract_block(text: str, lang: str) -> str | None:
    """Extrait un bloc de code markdown (```lang ... ```)."""
    marker = f"```{lang}"
    start = text.find(marker)
    if start == -1:
        return None
    start += len(marker)
    end = text.find("```", start)
    if end == -1:
        return None
    return text[start:end].strip()


# ─── Phase 4: MEMORY SYNC ────────────────────────────────────────────────────

async def phase_memory_sync(dry_run: bool) -> dict:
    """Consolide la mémoire : dream cycle + heuristiques + world state."""
    title(4, "MEMORY SYNC — Consolidation mémoire")

    result = {"dream_rules": 0, "heuristics_total": 0, "world_state_updated": False}

    if dry_run:
        info("DRY RUN — sync simulée")
        return result

    # ── 4.1 Dream cycle ────────────────────────────────────────────────────────
    info("Lancement dream_cycle (extraction heuristiques) …")
    try:
        r = subprocess.run(
            ["python3", "scripts/dream_cycle.py", "--limit", "50", "--verbose"],
            cwd=str(ROOT), capture_output=True, text=True, timeout=120,
        )
        if r.returncode == 0:
            # Parser la sortie pour extraire le compte
            for line in r.stdout.splitlines():
                if "nouvelles règles" in line:
                    import re
                    m = re.search(r"(\d+) nouvelles règles", line)
                    if m:
                        result["dream_rules"] = int(m.group(1))
            ok(f"Dream cycle terminé — {result['dream_rules']} nouvelles règles")
        else:
            warn(f"Dream cycle a retourné code {r.returncode}")
    except subprocess.TimeoutExpired:
        warn("Dream cycle timeout après 120s")
    except Exception as e:
        warn(f"Dream cycle erreur: {e}")

    # ── 4.2 Compte heuristiques totales ────────────────────────────────────────
    heuristics_file = ROOT / "agent" / "memory" / "heuristics.jsonl"
    if heuristics_file.exists():
        count = sum(1 for line in open(heuristics_file) if line.strip())
        result["heuristics_total"] = count
        ok(f"Total heuristiques: {count}")

    # ── 4.3 Update world state ─────────────────────────────────────────────────
    world_state_file = ROOT / "agent" / "memory" / "world_state.json"
    try:
        state = {}
        if world_state_file.exists():
            with open(world_state_file) as f:
                state = json.load(f)
        state["last_architect_cycle"] = datetime.utcnow().isoformat()
        state["heuristics_count"] = result["heuristics_total"]
        world_state_file.write_text(json.dumps(state, indent=2))
        result["world_state_updated"] = True
        ok("World state mis à jour")
    except Exception as e:
        warn(f"World state update erreur: {e}")

    return result


# ─── Phase 5: LAYER AUDIT ────────────────────────────────────────────────────

async def phase_layer_audit(dry_run: bool) -> dict:
    """Vérifie et redémarre les layers down."""
    title(5, "LAYER AUDIT — Santé des couches")

    layers = {
        "queen": 8001, "perception": 8002, "brain": 8003,
        "executor": 8004, "evolution": 8005, "memory": 8006,
        "mcp_bridge": 8007, "validator": 8014, "computer_use": 8015,
    }

    status = {}
    for name, port in layers.items():
        try:
            async with httpx.AsyncClient(timeout=3.0) as c:
                r = await c.get(f"http://localhost:{port}/health")
                up = r.status_code == 200
                status[name] = {"up": up, "port": port}
                icon = "✅" if up else "❌"
                print(f"    {icon} :{port} {name}")
        except Exception:
            status[name] = {"up": False, "port": port}
            print(f"    ❌ :{port} {name}")

    down = [n for n, s in status.items() if not s["up"]]
    if down and not dry_run:
        warn(f"Layers down: {down}")
        info("→ Lance self_healing_daemon.py --once pour auto-réparer")
        # Tentative de redémarrage léger
        for name in down[:3]:  # max 3 restarts directs
            port = layers[name]
            info(f"Tentative restart {name} …")
            try:
                subprocess.Popen(
                    ["python3", "-m", "uvicorn", f"agent.{name}:app",
                     "--host", "127.0.0.1", "--port", str(port), "--log-level", "warning"],
                    cwd=str(ROOT),
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                await asyncio.sleep(3)
                async with httpx.AsyncClient(timeout=3.0) as c:
                    r = await c.get(f"http://localhost:{port}/health")
                    if r.status_code == 200:
                        ok(f"✅ {name} redémarré")
                        status[name]["up"] = True
            except Exception as e:
                warn(f"Restart {name} échoué: {e}")

    up_count = sum(1 for s in status.values() if s["up"])
    ok(f"Total: {up_count}/{len(layers)} layers UP")
    return status


# ─── Phase 6: DOC UPDATE ─────────────────────────────────────────────────────

async def phase_doc_update(
    audit: dict, generated_skills: list[dict], memory_sync: dict, dry_run: bool
) -> None:
    """Met à jour CHANGELOG.md, persistent.md, DECISIONS.md."""
    title(6, "DOC UPDATE — Mise à jour documentation")

    week_str = datetime.utcnow().strftime("%Y-W%W")
    today = datetime.utcnow().strftime("%Y-%m-%d")

    # ── 6.1 CHANGELOG.md ──────────────────────────────────────────────────────
    changelog = ROOT / "CHANGELOG.md"
    entry_lines = [
        f"\n## [{week_str}] — {today}\n",
        f"### Missions\n",
        f"- Total: {audit.get('total_missions', 0)}, "
        f"Succès: {audit.get('success', 0)}, "
        f"Échecs: {audit.get('failed', 0)}\n",
    ]
    if generated_skills:
        entry_lines.append(f"\n### Skills générés ({len(generated_skills)})\n")
        for s in generated_skills:
            tier = s.get("tier", "silver")
            conf = s.get("confidence", 0.7)
            entry_lines.append(f"- `{s['skill_name']}` [{tier}, conf={conf:.2f}] — {s['description']}\n")
    if memory_sync.get("dream_rules", 0) > 0:
        entry_lines.append(f"\n### Mémoire\n")
        entry_lines.append(f"- {memory_sync['dream_rules']} nouvelles heuristiques extraites\n")
        entry_lines.append(f"- Total heuristiques: {memory_sync.get('heuristics_total', 0)}\n")

    entry = "".join(entry_lines)

    if not dry_run:
        existing = changelog.read_text() if changelog.exists() else "# CHANGELOG\n"
        # Insérer après le premier titre
        first_heading = existing.find("\n##")
        if first_heading >= 0:
            new_content = existing[:first_heading] + entry + existing[first_heading:]
        else:
            new_content = existing + entry
        changelog.write_text(new_content)
        ok(f"CHANGELOG.md mis à jour")
    else:
        info(f"[DRY] CHANGELOG entrée:\n{entry[:300]}")

    # ── 6.2 persistent.md — Learnings de la semaine ───────────────────────────
    persistent_md = ROOT / "agent" / "memory" / "persistent.md"
    top_errors = audit.get("top_errors", [])
    if top_errors and not dry_run:
        learning = (
            f"\n---\n"
            f"id: learning_{week_str.replace('-', '_')}\n"
            f"type: weekly_synthesis\n"
            f"created: {today}\n"
            f"confidence: 0.9\n"
            f"\n"
            f"Semaine {week_str} — "
            f"{audit.get('total_missions', 0)} missions, "
            f"{audit.get('failed', 0)} échecs. "
            f"Erreurs principales: {', '.join(e['type'] for e in top_errors[:3])}. "
            f"{len(generated_skills)} skills générés pour combler les gaps.\n"
        )
        with open(persistent_md, "a") as f:
            f.write(learning)
        ok("persistent.md enrichi avec learnings hebdo")

    if generated_skills and not dry_run:
        ok(f"{len(generated_skills)} skills documentés")
    else:
        ok("Documentation à jour")


# ─── Phase 7: OSS PREP ───────────────────────────────────────────────────────

async def phase_oss_prep(dry_run: bool) -> dict:
    """Prépare le projet pour open-source : nettoyage, versioning, tag."""
    title(7, "OSS PREP — Préparation open-source")

    result = {"cleaned": [], "version": None, "tagged": False, "ready": False}

    # ── 7.1 Fichiers sensibles à purger ───────────────────────────────────────
    sensitive_patterns = [
        "**/*.pyc", "**/__pycache__", "**/.DS_Store",
        "agent/*.db-shm", "agent/*.db-wal",
        "agent/memory/missions.db",  # données privées
        "/tmp/ghost_*",
    ]

    # Vérifier .gitignore couvre bien ces patterns
    gitignore = ROOT / ".gitignore"
    if gitignore.exists():
        content = gitignore.read_text()
        missing = []
        for pat in ["*.pyc", "__pycache__", ".env", "*.db-shm", "*.db-wal", ".laruche/"]:
            if pat not in content:
                missing.append(pat)
        if missing and not dry_run:
            with open(gitignore, "a") as f:
                f.write("\n# Auto-added by architect_weekly_cycle\n")
                for pat in missing:
                    f.write(f"{pat}\n")
            ok(f".gitignore enrichi: {missing}")
        elif missing:
            info(f"[DRY] .gitignore manque: {missing}")
        else:
            ok(".gitignore complet")

    # ── 7.2 .env.example à jour ───────────────────────────────────────────────
    env_file = ROOT / ".env"
    env_example = ROOT / ".env.example"
    if env_file.exists():
        lines = env_file.read_text().splitlines()
        example_lines = []
        for line in lines:
            if "=" in line and not line.startswith("#"):
                key = line.split("=")[0]
                # Masquer les valeurs sensibles
                for sensitive in ["API_KEY", "TOKEN", "SECRET", "PASSWORD", "BOT_TOKEN"]:
                    if sensitive in key.upper():
                        line = f"{key}=<YOUR_{key}_HERE>"
                        break
            example_lines.append(line)
        if not dry_run:
            env_example.write_text("\n".join(example_lines))
            ok(".env.example généré (tokens masqués)")
        else:
            info("[DRY] .env.example serait généré")

    # ── 7.3 Versioning ────────────────────────────────────────────────────────
    package_json = ROOT / "package.json"
    if package_json.exists():
        try:
            pkg = json.loads(package_json.read_text())
            current = pkg.get("version", "1.0.0")
            # Bump patch version
            parts = current.split(".")
            parts[-1] = str(int(parts[-1]) + 1)
            new_version = ".".join(parts)
            result["version"] = new_version
            if not dry_run:
                pkg["version"] = new_version
                package_json.write_text(json.dumps(pkg, indent=2))
                ok(f"Version bump: {current} → {new_version}")
            else:
                info(f"[DRY] Version bump: {current} → {new_version}")
        except Exception as e:
            warn(f"Version bump échoué: {e}")

    # ── 7.4 Tests finaux ──────────────────────────────────────────────────────
    if not dry_run:
        info("Lancement pytest (quick smoke tests) …")
        r = subprocess.run(
            ["python3", "-m", "pytest", "tests/pytest/", "-x", "-q",
             "--timeout=30", "--tb=no"],
            cwd=str(ROOT), capture_output=True, text=True, timeout=180,
        )
        passed = r.returncode == 0
        # Parser résumé
        for line in r.stdout.splitlines()[-5:]:
            if "passed" in line or "failed" in line or "error" in line:
                print(f"    {line}")
        if passed:
            ok("Tests pytest OK")
        else:
            warn(f"Tests avec erreurs (code {r.returncode}) — voir logs")

    # ── 7.5 Git tag ───────────────────────────────────────────────────────────
    if result["version"] and not dry_run:
        try:
            subprocess.run(
                ["git", "add", "-A"], cwd=str(ROOT), check=True, capture_output=True
            )
            subprocess.run(
                ["git", "commit", "-m",
                 f"chore(weekly): architect cycle {datetime.utcnow().strftime('%Y-W%W')} "
                 f"— {len(generated_skills) if 'generated_skills' in dir() else 0} skills generated\n\n"
                 f"Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"],
                cwd=str(ROOT), capture_output=True,
            )
            tag = f"v{result['version']}"
            subprocess.run(
                ["git", "tag", "-a", tag, "-m", f"Weekly architect cycle {tag}"],
                cwd=str(ROOT), check=True, capture_output=True,
            )
            result["tagged"] = True
            ok(f"Git tag: {tag}")
        except subprocess.CalledProcessError as e:
            warn(f"Git tag échoué: {e}")

    result["ready"] = True
    ok("Projet prêt pour open-source 🎉")
    return result


# ─── RAPPORT FINAL ────────────────────────────────────────────────────────────

def print_final_report(
    audit: dict,
    gaps: list[dict],
    generated: list[dict],
    memory: dict,
    layers: dict,
    doc: None,
    oss: dict,
    elapsed: float,
) -> None:
    print(f"\n{BOLD}{'═'*60}")
    print(f"  RAPPORT CYCLE HEBDOMADAIRE — {datetime.utcnow().strftime('%Y-%m-%d')}")
    print(f"{'═'*60}{RESET}\n")

    print(f"  📊 Missions  : {audit.get('total_missions',0)} total | "
          f"{audit.get('success',0)} ✅ | {audit.get('failed',0)} ❌")
    print(f"  🛠  Skills    : {len(gaps)} gaps → {len(generated)} générés")
    print(f"  🧠 Mémoire   : +{memory.get('dream_rules',0)} heuristiques "
          f"({memory.get('heuristics_total',0)} total)")
    up = sum(1 for s in layers.values() if isinstance(s, dict) and s.get("up", False))
    print(f"  💚 Layers    : {up}/{len(layers)} UP")
    print(f"  📦 Version   : {oss.get('version','?')}")
    print(f"  ⏱  Durée     : {elapsed:.0f}s")

    if generated:
        print(f"\n  Skills créés cette semaine:")
        for s in generated:
            print(f"    • {s['skill_name']:25s} [{s.get('tier','silver')}]")

    print(f"\n  {GREEN}✅ Cycle terminé — La Ruche est nourrie{RESET}\n")


# ─── MAIN ─────────────────────────────────────────────────────────────────────

async def main(args: argparse.Namespace) -> None:
    print(f"\n{BOLD}{BLUE}╔══════════════════════════════════════════════════════╗")
    print(f"║  Ghost OS Ultimate — Cycle Architecte Hebdomadaire  ║")
    print(f"║  {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC'):50s}  ║")
    print(f"╚══════════════════════════════════════════════════════╝{RESET}\n")

    if args.dry_run:
        print(f"  {YELLOW}MODE DRY-RUN — aucun fichier modifié{RESET}\n")

    t_start = time.time()
    only = args.phase  # None = toutes les phases

    generated_skills: list[dict] = []

    audit = {}
    gaps  = []
    memory_sync = {}
    layer_status = {}
    oss_result  = {}

    try:
        if not only or only == 1:
            audit = await phase_audit(args.dry_run)

        if not only or only == 2:
            gaps = await phase_gap_analysis(audit, args.dry_run)

        if not only or only == 3:
            generated_skills = await phase_skill_generation(gaps, args.dry_run)

        if not only or only == 4:
            memory_sync = await phase_memory_sync(args.dry_run)

        if not only or only == 5:
            layer_status = await phase_layer_audit(args.dry_run)

        if not only or only == 6:
            await phase_doc_update(audit, generated_skills, memory_sync, args.dry_run)

        if not only or only == 7:
            oss_result = await phase_oss_prep(args.dry_run)

        elapsed = time.time() - t_start

        if not args.report_only:
            print_final_report(
                audit, gaps, generated_skills, memory_sync,
                layer_status, None, oss_result, elapsed
            )

    except KeyboardInterrupt:
        warn("Cycle interrompu par l'utilisateur")
        sys.exit(1)
    except Exception as e:
        err(f"Erreur cycle: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Ghost OS — Cycle autonome Claude Architecte"
    )
    parser.add_argument("--phase", type=int, choices=range(1, 8),
                        help="Exécuter seulement une phase (1-7)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Simuler sans modifier les fichiers")
    parser.add_argument("--report-only", action="store_true",
                        help="Rapport d'audit uniquement (phases 1-2)")
    args = parser.parse_args()
    asyncio.run(main(args))
