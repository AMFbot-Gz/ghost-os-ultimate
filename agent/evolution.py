"""
Couche évolution — port 8005
Self-repair · génération skills Node.js · évaluation · évolution · métriques · auto-amélioration continue
"""
import json
import os
import subprocess
import asyncio
import httpx
import re
import tempfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Any
import yaml
from dotenv import load_dotenv
from contextlib import asynccontextmanager
load_dotenv()

# ─── Locks et executor ────────────────────────────────────────────────────────
_SKILL_LOCKS: dict[str, asyncio.Lock] = {}
_REGISTRY_LOCK = asyncio.Lock()
_METRICS_LOCK  = asyncio.Lock()
_TEST_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="evolution_test")

ROOT = Path(__file__).resolve().parent.parent

with open(ROOT / "agent_config.yml") as f:
    CONFIG = yaml.safe_load(f)


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(auto_evolve_loop())
    print("🧬 PICO-RUCHE Evolution actif — port 8005 · auto-évolution 30min")
    yield

app = FastAPI(title="PICO-RUCHE Evolution", version="2.0.0", lifespan=lifespan)

# ─── Paths ────────────────────────────────────────────────────────────────────
SKILLS_PY_DIR  = ROOT / "agent" / "skills"           # skills Python (legacy)
SKILLS_NODE_DIR = ROOT / "skills"                    # skills Node.js ESM
REGISTRY_FILE  = SKILLS_NODE_DIR / "registry.json"
METRICS_FILE   = SKILLS_NODE_DIR / "metrics.json"
EVOLUTION_LOG  = ROOT / "agent" / "evolution_log.jsonl"
LAYERS_DIR     = ROOT / "agent" / "layers"

SKILLS_PY_DIR.mkdir(parents=True, exist_ok=True)
LAYERS_DIR.mkdir(parents=True, exist_ok=True)
SKILLS_NODE_DIR.mkdir(parents=True, exist_ok=True)

# Crée les fichiers de persistance si absents
if not METRICS_FILE.exists():
    METRICS_FILE.write_text("{}", encoding="utf-8")
if not EVOLUTION_LOG.exists():
    EVOLUTION_LOG.write_text("", encoding="utf-8")

# ─── Prompts LLM pour génération/évolution ───────────────────────────────────

GENERATE_SKILL_PROMPT = """Tu génères un skill Node.js ESM pour Ghost OS Ultimate.

Format obligatoire (skill.js) :
```
// Skill: {name} — {description}
import {{ ... }} from "...";  // uniquement built-ins Node.js

export async function run({{ param1, param2 = "default" }}) {{
  try {{
    // implémentation
    return {{ success: true, result: ... }};
  }} catch (e) {{
    return {{ success: false, error: e.message }};
  }}
}}
```

Règles strictes :
- ESM uniquement (import/export, jamais require)
- Retourner toujours {{ success: bool, result: ..., error: "..." }}
- Gestion d'erreurs try/catch obligatoire
- Paramètres avec valeurs par défaut si optionnels
- Uniquement built-ins Node.js 20 (fs, path, child_process, crypto, fetch natif)
- Zéro dépendance npm externe
- Code production-ready

Objectif du skill : {goal}
Exemples d'utilisation : {examples}

Réponds UNIQUEMENT avec le code skill.js. Sans markdown, sans explication."""


EVOLVE_SKILL_PROMPT = """Tu améliores un skill Node.js ESM existant pour Ghost OS Ultimate.

Skill : {name}
Version actuelle : {version}
Code actuel :
{current_code}

Problèmes observés (depuis mémoire des missions) :
{failures}

Raison d'évolution demandée : {reason}

Mission : améliore le skill pour corriger ces problèmes.
Consignes :
- Garde exactement la même interface (paramètres, format de retour {{ success, result/error }})
- Commente les changements avec // ÉVOLUTION {new_version}: raison
- Améliore : robustesse, gestion d'erreurs, edge cases, performance
- Ne change PAS les imports ou la signature de run() sans raison impérative

Réponds UNIQUEMENT avec le code skill.js amélioré. Sans markdown, sans explication."""


# ─── Helpers fichiers ────────────────────────────────────────────────────────

def _atomic_write(path: Path, content: str) -> None:
    """Écriture atomique via temp + rename."""
    fd, tmp = tempfile.mkstemp(dir=str(path.parent), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(content)
        os.replace(tmp, str(path))
    except Exception:
        try: os.unlink(tmp)
        except OSError: pass
        raise


def _read_registry() -> dict:
    try:
        return json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"skills": []}


def _read_metrics() -> dict:
    try:
        return json.loads(METRICS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _skill_lock(name: str) -> asyncio.Lock:
    if name not in _SKILL_LOCKS:
        _SKILL_LOCKS[name] = asyncio.Lock()
    if len(_SKILL_LOCKS) > 100:
        for k in list(_SKILL_LOCKS.keys())[:20]:
            _SKILL_LOCKS.pop(k, None)
    return _SKILL_LOCKS[name]


def _semver_bump(version: str, part: str = "patch") -> str:
    """Incrémente une version sémantique (major.minor.patch)."""
    try:
        parts = [int(x) for x in version.split(".")]
        while len(parts) < 3:
            parts.append(0)
        if part == "major":   parts[0] += 1; parts[1] = 0; parts[2] = 0
        elif part == "minor": parts[1] += 1; parts[2] = 0
        else:                 parts[2] += 1
        return ".".join(str(p) for p in parts)
    except Exception:
        return "2.0.0"


async def _log_evolution(event: dict) -> None:
    """Append un événement dans evolution_log.jsonl."""
    entry = {"timestamp": datetime.utcnow().isoformat(), **event}
    try:
        with open(EVOLUTION_LOG, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[Evolution] log error: {e}")


async def _registry_add_or_update(skill_info: dict) -> None:
    """Met à jour registry.json de manière atomique."""
    async with _REGISTRY_LOCK:
        reg = _read_registry()
        skills = reg.get("skills", [])
        existing = next((i for i, s in enumerate(skills) if s["name"] == skill_info["name"]), None)
        if existing is not None:
            skills[existing] = {**skills[existing], **skill_info}
        else:
            skills.append(skill_info)
        reg["skills"] = skills
        _atomic_write(REGISTRY_FILE, json.dumps(reg, indent=2, ensure_ascii=False))


async def _update_metrics(name: str, success: bool, duration_ms: int = 0) -> None:
    """Met à jour les métriques d'un skill (thread-safe)."""
    async with _METRICS_LOCK:
        metrics = _read_metrics()
        m = metrics.get(name, {
            "total_calls": 0, "successful_calls": 0, "failed_calls": 0,
            "avg_duration_ms": 0.0, "last_called_at": None,
            "last_evolved_at": None, "evolution_count": 0,
        })
        m["total_calls"]     += 1
        m["successful_calls"] += 1 if success else 0
        m["failed_calls"]     += 0 if success else 1
        if duration_ms > 0:
            prev_avg = m.get("avg_duration_ms", 0.0) or 0.0
            total    = m["total_calls"]
            m["avg_duration_ms"] = (prev_avg * (total - 1) + duration_ms) / total
        m["last_called_at"] = datetime.utcnow().isoformat()
        metrics[name] = m
        _atomic_write(METRICS_FILE, json.dumps(metrics, indent=2, ensure_ascii=False))


# ─── Legacy : repair + tests ──────────────────────────────────────────────────

def get_repair_backend() -> Optional[str]:
    for tool in ["claude", "aider"]:
        try:
            subprocess.run(["which", tool], check=True, capture_output=True)
            return tool
        except Exception:
            continue
    return None


async def repair_file(file_path: str, error: str) -> dict:
    backend = get_repair_backend()
    if not backend:
        return {"success": False, "error": "Ni claude CLI ni aider disponible"}
    args = (
        ["claude", "-p", f"Fix this error in {file_path}: {error}"]
        if backend == "claude"
        else ["aider", "--message", f"Fix: {error}", file_path]
    )
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=120)
        return {
            "success": result.returncode == 0,
            "output":  result.stdout[-2000:],
            "backend": backend,
            "file":    file_path,
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Timeout 120s"}


async def run_tests() -> dict:
    try:
        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(
            _TEST_EXECUTOR,
            lambda: subprocess.run(
                ["npm", "test"], capture_output=True, text=True, timeout=120, cwd=str(ROOT)
            )
        )
        output = result.stdout + result.stderr
        passed = output.count("passing") + output.count("✓")
        failed = output.count("failing") + output.count("✗")
        return {"success": result.returncode == 0, "output": output[-2000:], "passed": passed, "failed": failed}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Timeout 120s"}
    except FileNotFoundError:
        return {"success": False, "error": "npm non trouvé"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# ─── Legacy : génération Python (conservé) ───────────────────────────────────

async def generate_skill(name: str, goal: str, examples: List[dict] = []) -> dict:
    if not re.match(r'^[a-zA-Z0-9_\-]+$', name):
        raise HTTPException(status_code=400, detail=f"Nom invalide: {name}")
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(
            f"http://localhost:{CONFIG['ports']['brain']}/raw",
            json={
                "role": "worker",
                "prompt": f"Crée un skill Python nommé '{name}' qui accomplit: {goal}\nExemples: {json.dumps(examples)}\nRéponds UNIQUEMENT avec du code Python valide, sans markdown.",
                "system": "Tu génères des skills Python pour un agent autonome. Code uniquement, pas d'explication."
            }
        )
    code = r.json().get("content", "").replace("```python", "").replace("```", "").strip()
    skill_file = SKILLS_PY_DIR / f"{name}.py"
    async with _skill_lock(name):
        skill_file.write_text(code)
    try:
        compile(code, str(skill_file), "exec")
        return {"created": True, "file": str(skill_file), "valid_syntax": True}
    except SyntaxError as e:
        return {"created": True, "file": str(skill_file), "valid_syntax": False, "syntax_error": str(e)}


# ─── Phase 7 : génération Node.js skills ─────────────────────────────────────

async def generate_skill_node(
    name: str,
    goal: str,
    examples: List[dict] = [],
    description: str = "",
    params: dict = {},
) -> dict:
    """Génère un skill Node.js ESM complet (skill.js + manifest.json) et l'enregistre dans registry.json."""
    if not re.match(r'^[a-zA-Z0-9_\-]+$', name):
        raise HTTPException(status_code=400, detail=f"Nom de skill invalide: {name}")

    skill_dir = SKILLS_NODE_DIR / name
    desc = description or goal[:120]
    examples_txt = json.dumps(examples[:3], ensure_ascii=False) if examples else "[]"

    # ── Génération skill.js via LLM ───────────────────────────────────────
    prompt = (
        GENERATE_SKILL_PROMPT
        .replace("{name}",        name)
        .replace("{description}", desc)
        .replace("{goal}",        goal)
        .replace("{examples}",    examples_txt)
    )
    try:
        async with httpx.AsyncClient(timeout=90) as c:
            r = await c.post(
                f"http://localhost:{CONFIG['ports']['brain']}/raw",
                json={"role": "worker", "prompt": "Génère le skill maintenant.", "system": prompt}
            )
        code = r.json().get("content", "")
    except Exception as e:
        return {"created": False, "error": f"LLM inaccessible: {e}"}

    # Nettoyer les balises markdown si présentes
    code = re.sub(r"```(?:javascript|js)?\n?", "", code).replace("```", "").strip()
    if not code or "export async function run" not in code:
        return {"created": False, "error": "LLM n'a pas généré de code valide (run() manquant)"}

    # ── Manifest ──────────────────────────────────────────────────────────
    manifest = {
        "name":        name,
        "description": desc,
        "version":     "1.0.0",
        "params":      params or {"...": "voir skill.js"},
        "created":     datetime.utcnow().isoformat(),
        "generated_by": "evolution_v2",
    }

    # ── Écriture atomique ─────────────────────────────────────────────────
    async with _skill_lock(name):
        skill_dir.mkdir(parents=True, exist_ok=True)
        _atomic_write(skill_dir / "skill.js",     code)
        _atomic_write(skill_dir / "manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False))

    # ── Validation syntaxique basique ─────────────────────────────────────
    syntax_ok = True
    syntax_error = None
    try:
        result = subprocess.run(
            ["node", "--input-type=module", "--check"],
            input=code, capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            syntax_ok = False
            syntax_error = (result.stderr or "").strip()[:200]
    except Exception:
        pass  # node absent → on skip la validation

    # ── Registre ─────────────────────────────────────────────────────────
    await _registry_add_or_update({
        "name":        name,
        "description": desc,
        "version":     "1.0.0",
        "created":     manifest["created"],
        "generated_by": "evolution_v2",
    })

    # ── Métriques initiales ───────────────────────────────────────────────
    async with _METRICS_LOCK:
        metrics = _read_metrics()
        metrics[name] = metrics.get(name, {
            "total_calls": 0, "successful_calls": 0, "failed_calls": 0,
            "avg_duration_ms": 0.0, "last_called_at": None,
            "last_evolved_at": None, "evolution_count": 0,
        })
        _atomic_write(METRICS_FILE, json.dumps(metrics, indent=2, ensure_ascii=False))

    await _log_evolution({
        "event":      "skill_generated",
        "skill":      name,
        "goal":       goal,
        "syntax_ok":  syntax_ok,
        "version":    "1.0.0",
    })

    return {
        "created":      True,
        "skill":        name,
        "directory":    str(skill_dir),
        "version":      "1.0.0",
        "syntax_ok":    syntax_ok,
        "syntax_error": syntax_error,
        "code_preview": code[:300],
    }


# ─── Phase 7 : évaluation d'un skill ─────────────────────────────────────────

async def evaluate_skill(name: str, test_cases: List[dict]) -> dict:
    """Exécute un skill Node.js avec des cas de test et retourne les résultats."""
    if not re.match(r'^[a-zA-Z0-9_\-]+$', name):
        raise HTTPException(status_code=400, detail=f"Nom invalide: {name}")

    skill_file = SKILLS_NODE_DIR / name / "skill.js"
    if not skill_file.exists():
        return {"error": f"Skill '{name}' introuvable dans {skill_file}", "results": []}

    results = []
    for i, case in enumerate(test_cases[:5]):  # max 5 cas de test
        params_json = json.dumps(case.get("params", {}))
        # Lance le skill via Node.js inline ESM
        script = (
            f"import {{ run }} from '{skill_file.as_posix()}';\n"
            f"const result = await run({params_json});\n"
            f"console.log(JSON.stringify(result));\n"
        )
        t0 = asyncio.get_event_loop().time()
        try:
            loop = asyncio.get_event_loop()
            proc_result = await loop.run_in_executor(
                _TEST_EXECUTOR,
                lambda: subprocess.run(
                    ["node", "--input-type=module"],
                    input=script, capture_output=True, text=True,
                    timeout=15, cwd=str(ROOT),
                )
            )
            duration_ms = int((asyncio.get_event_loop().time() - t0) * 1000)
            stdout = proc_result.stdout.strip()
            stderr = proc_result.stderr.strip()

            try:
                output = json.loads(stdout) if stdout else {}
                success = output.get("success", False) if isinstance(output, dict) else bool(output)
            except json.JSONDecodeError:
                output  = stdout[:300]
                success = proc_result.returncode == 0

            results.append({
                "case":        i + 1,
                "params":      case.get("params", {}),
                "success":     success,
                "output":      output,
                "stderr":      stderr[:200] if stderr else None,
                "duration_ms": duration_ms,
            })
            await _update_metrics(name, success, duration_ms)
        except subprocess.TimeoutExpired:
            results.append({"case": i + 1, "params": case.get("params", {}), "success": False,
                            "error": "timeout 15s", "duration_ms": 15000})
            await _update_metrics(name, False, 15000)
        except Exception as e:
            results.append({"case": i + 1, "params": case.get("params", {}), "success": False,
                            "error": str(e)[:200], "duration_ms": 0})
            await _update_metrics(name, False, 0)

    passed = sum(1 for r in results if r.get("success"))
    total  = len(results)
    await _log_evolution({
        "event":   "skill_evaluated",
        "skill":   name,
        "passed":  passed,
        "total":   total,
        "success_rate": round(passed / total, 2) if total else 0,
    })
    return {"skill": name, "passed": passed, "total": total, "results": results}


# ─── Phase 7 : évolution d'un skill existant ─────────────────────────────────

async def evolve_existing_skill(name: str, reason: str = "amélioration générale") -> dict:
    """Lit un skill existant, analyse les échecs en mémoire, génère une version améliorée."""
    if not re.match(r'^[a-zA-Z0-9_\-]+$', name):
        raise HTTPException(status_code=400, detail=f"Nom invalide: {name}")

    skill_dir  = SKILLS_NODE_DIR / name
    skill_file = skill_dir / "skill.js"
    manifest_file = skill_dir / "manifest.json"

    if not skill_file.exists():
        return {"evolved": False, "error": f"Skill '{name}' introuvable"}

    # ── Lecture version courante ──────────────────────────────────────────
    current_code = skill_file.read_text(encoding="utf-8")
    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    except Exception:
        manifest = {"version": "1.0.0", "name": name}

    old_version = manifest.get("version", "1.0.0")
    new_version = _semver_bump(old_version, "minor")

    # ── Recherche des échecs en mémoire ──────────────────────────────────
    failures_text = "Aucun échec spécifique détecté."
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"http://localhost:{CONFIG['ports']['memory']}/search",
                json={"keywords": [name, "error", "failed"]},
            )
        failures = r.json().get("results", [])
        if failures:
            lines = []
            for ep in failures[:5]:
                status = "✗" if not ep.get("success") else "✓"
                lines.append(f"{status} {ep.get('mission', '')[:80]} → {ep.get('result', '')[:100]}")
            failures_text = "\n".join(lines)
    except Exception:
        pass

    # ── Appel LLM pour amélioration ───────────────────────────────────────
    prompt = (
        EVOLVE_SKILL_PROMPT
        .replace("{name}",         name)
        .replace("{version}",      old_version)
        .replace("{new_version}",  new_version)
        .replace("{current_code}", current_code)
        .replace("{failures}",     failures_text)
        .replace("{reason}",       reason)
    )
    try:
        async with httpx.AsyncClient(timeout=90) as c:
            r = await c.post(
                f"http://localhost:{CONFIG['ports']['brain']}/raw",
                json={"role": "strategist", "prompt": "Améliore ce skill.", "system": prompt}
            )
        new_code = r.json().get("content", "")
    except Exception as e:
        return {"evolved": False, "error": f"LLM inaccessible: {e}"}

    new_code = re.sub(r"```(?:javascript|js)?\n?", "", new_code).replace("```", "").strip()
    if not new_code or "export async function run" not in new_code:
        return {"evolved": False, "error": "LLM n'a pas produit de code valide"}

    # ── Backup de l'ancienne version ──────────────────────────────────────
    backup_file = skill_dir / f"skill.v{old_version}.js"

    async with _skill_lock(name):
        # Backup
        _atomic_write(backup_file, current_code)
        # Nouvelle version
        _atomic_write(skill_file, new_code)
        # Manifest mis à jour
        manifest["version"]      = new_version
        manifest["last_evolved"] = datetime.utcnow().isoformat()
        manifest["evolution_reason"] = reason
        _atomic_write(manifest_file, json.dumps(manifest, indent=2, ensure_ascii=False))

    # ── Mise à jour registre ──────────────────────────────────────────────
    await _registry_add_or_update({
        "name":         name,
        "version":      new_version,
        "last_evolved": manifest["last_evolved"],
    })

    # ── Métriques ─────────────────────────────────────────────────────────
    async with _METRICS_LOCK:
        metrics = _read_metrics()
        m = metrics.get(name, {})
        m["last_evolved_at"]  = manifest["last_evolved"]
        m["evolution_count"]  = m.get("evolution_count", 0) + 1
        metrics[name] = m
        _atomic_write(METRICS_FILE, json.dumps(metrics, indent=2, ensure_ascii=False))

    await _log_evolution({
        "event":        "skill_evolved",
        "skill":        name,
        "old_version":  old_version,
        "new_version":  new_version,
        "reason":       reason,
        "backup":       str(backup_file),
    })

    return {
        "evolved":      True,
        "skill":        name,
        "old_version":  old_version,
        "new_version":  new_version,
        "backup":       str(backup_file),
        "code_preview": new_code[:300],
    }


# ─── Analyse des patterns d'échec ────────────────────────────────────────────

async def analyze_failures() -> dict:
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.post(
                f"http://localhost:{CONFIG['ports']['memory']}/search",
                json={"keywords": ["failed", "error", "timeout"]}
            )
        failures = r.json().get("results", [])
    except Exception:
        failures = []

    if not failures:
        return {"patterns": [], "recommendation": "Aucun échec récent détecté", "new_skill_needed": False}

    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(
                f"http://localhost:{CONFIG['ports']['brain']}/raw",
                json={
                    "role": "strategist",
                    "prompt": (
                        f"Analyse ces {len(failures)} échecs et identifie les patterns.\n"
                        f"{json.dumps(failures[-10:])}\n"
                        "Réponds JSON: {\"patterns\": [\"string\"], \"recommendation\": \"string\", "
                        "\"new_skill_needed\": true/false, \"skill_name\": \"snake_case\", \"skill_description\": \"string\", "
                        "\"skill_to_evolve\": \"existing_skill_name_or_null\"}"
                    ),
                    "system": "Tu analyses des patterns d'échecs pour améliorer un agent autonome. Réponds uniquement en JSON valide.",
                }
            )
        raw = r.json().get("content", "{}")
        start, end = raw.find("{"), raw.rfind("}") + 1
        return json.loads(raw[start:end]) if start != -1 else {"patterns": [], "recommendation": raw[:200]}
    except Exception as e:
        return {"patterns": [], "recommendation": f"Analyse échouée: {e}", "new_skill_needed": False}


# ─── Auto-évolution améliorée (cycle 30min) ───────────────────────────────────

async def auto_evolve_loop():
    """Boucle d'auto-évolution :
    - Cycle 30min
    - Analyse les patterns d'échec en mémoire
    - Évolue les skills sous-performants (taux échec > 40% + ≥5 appels)
    - Génère de nouveaux skills si l'analyse le recommande
    """
    print("[Evolution] 🧬 Boucle auto-évolution démarrée (cycle 30min)")
    await asyncio.sleep(60)  # Laisse les autres couches démarrer

    while True:
        try:
            print("[Evolution] 🔄 Cycle auto-évolution...")
            analysis = await analyze_failures()

            patterns      = analysis.get("patterns", [])
            recommendation = analysis.get("recommendation", "")

            if patterns:
                print(f"[Evolution] 🔍 Patterns: {patterns[:2]}")
                print(f"[Evolution] 💡 {recommendation[:100]}")

            # ── Évolution d'un skill existant si recommandée ───────────────
            skill_to_evolve = analysis.get("skill_to_evolve")
            if skill_to_evolve and skill_to_evolve != "null":
                skill_path = SKILLS_NODE_DIR / skill_to_evolve / "skill.js"
                if skill_path.exists():
                    print(f"[Evolution] 🔧 Auto-évolution de '{skill_to_evolve}'")
                    result = await evolve_existing_skill(
                        skill_to_evolve,
                        reason=f"Auto-évolution: {recommendation[:100]}"
                    )
                    print(f"[Evolution] {'✅' if result.get('evolved') else '❌'} "
                          f"'{skill_to_evolve}' v{result.get('old_version')} → v{result.get('new_version', '?')}")

            # ── Évolution basée sur métriques locales ──────────────────────
            metrics = _read_metrics()
            for skill_name, m in metrics.items():
                total  = m.get("total_calls", 0)
                failed = m.get("failed_calls", 0)
                if total >= 5 and failed / total > 0.4:
                    evol_count = m.get("evolution_count", 0)
                    if evol_count < 3:  # max 3 évolutions auto par skill
                        skill_path = SKILLS_NODE_DIR / skill_name / "skill.js"
                        if skill_path.exists():
                            print(f"[Evolution] ⚠️  '{skill_name}' taux échec {failed/total:.0%} → évolution auto")
                            await evolve_existing_skill(
                                skill_name,
                                reason=f"Taux d'échec {failed/total:.0%} sur {total} appels"
                            )

            # ── Génération d'un nouveau skill si besoin ────────────────────
            if analysis.get("new_skill_needed") and analysis.get("skill_description"):
                skill_name = analysis.get("skill_name") or f"auto_skill_{int(asyncio.get_event_loop().time())}"
                if re.match(r'^[a-zA-Z0-9_\-]+$', skill_name):
                    target = SKILLS_NODE_DIR / skill_name / "skill.js"
                    if not target.exists():
                        print(f"[Evolution] ✨ Génération skill: {skill_name}")
                        result = await generate_skill_node(
                            skill_name,
                            goal=analysis["skill_description"],
                        )
                        print(f"[Evolution] {'✅' if result.get('created') else '❌'} {skill_name} — "
                              f"syntax_ok={result.get('syntax_ok')}")

            # ── Self-repair Python ─────────────────────────────────────────
            try:
                async with httpx.AsyncClient(timeout=5) as c:
                    r = await c.post(
                        f"http://localhost:{CONFIG['ports']['memory']}/search",
                        json={"keywords": ["SyntaxError", "ImportError", "ModuleNotFoundError"]}
                    )
                errors = r.json().get("results", [])
                for ep in errors[:1]:
                    err_text = ep.get("result", "")
                    match = re.search(r'File "([^"]+\.py)"', err_text)
                    if match:
                        fpath = match.group(1)
                        print(f"[Evolution] 🔧 Auto-repair: {fpath}")
                        await repair_file(fpath, err_text[:300])
            except Exception:
                pass

            await _log_evolution({"event": "cycle_complete", "patterns": patterns[:3]})

        except Exception as e:
            print(f"[Evolution] auto_evolve_loop erreur: {e}")

        await asyncio.sleep(1800)  # 30 min


# ─── Modèles Pydantic ─────────────────────────────────────────────────────────

class RepairRequest(BaseModel):
    file_path:           str
    error_description:   str


class SkillRequest(BaseModel):
    name:     str
    goal:     str
    examples: List[dict] = []


class SkillNodeRequest(BaseModel):
    name:        str
    goal:        str
    description: str = ""
    examples:    List[dict] = []
    params:      dict = {}


class EvolveRequest(BaseModel):
    name:   str
    reason: str = "amélioration générale"


class EvaluateRequest(BaseModel):
    name:       str
    test_cases: List[dict] = []


class SelfRepairLoopRequest(BaseModel):
    max_iterations: int = 3


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/repair")
async def repair(req: RepairRequest):
    return await repair_file(req.file_path, req.error_description)


@app.post("/self-repair-loop")
async def self_repair_loop(req: SelfRepairLoopRequest):
    results = []
    for i in range(req.max_iterations):
        test_result = await run_tests()
        results.append({"iteration": i + 1, "tests": test_result})
        if test_result["success"]:
            return {"success": True, "iterations": i + 1, "results": results}
        error_match = test_result.get("output", "")
        match = re.search(r"at .+\((.+\.(?:js|ts|py)):", error_match)
        if match:
            repair_result = await repair_file(match.group(1), error_match[:500])
            results[-1]["repair"] = repair_result
    return {"success": False, "iterations": req.max_iterations, "results": results}


@app.post("/generate-skill")
async def create_skill(req: SkillRequest):
    """Génère un skill Python (legacy)."""
    return await generate_skill(req.name, req.goal, req.examples)


@app.post("/generate-skill-node")
async def create_skill_node(req: SkillNodeRequest):
    """Génère un skill Node.js ESM complet avec manifest + registry."""
    return await generate_skill_node(req.name, req.goal, req.examples, req.description, req.params)


@app.post("/evolve")
async def evolve(req: EvolveRequest):
    """Évolue un skill existant (analyse échecs + amélioration LLM + versionning)."""
    return await evolve_existing_skill(req.name, req.reason)


@app.post("/evaluate")
async def evaluate(req: EvaluateRequest):
    """Évalue un skill Node.js avec des cas de test."""
    return await evaluate_skill(req.name, req.test_cases)


@app.post("/analyze-failures")
async def analyze():
    return await analyze_failures()


@app.get("/skills")
async def list_skills_all():
    """Liste tous les skills (Python + Node.js) avec métriques."""
    reg = _read_registry()
    metrics = _read_metrics()
    node_skills = []
    for s in reg.get("skills", []):
        n = s["name"]
        m = metrics.get(n, {})
        total  = m.get("total_calls", 0)
        failed = m.get("failed_calls", 0)
        node_skills.append({
            **s,
            "type":            "node",
            "total_calls":     total,
            "failed_calls":    failed,
            "success_rate":    round((total - failed) / total, 2) if total > 0 else None,
            "avg_duration_ms": round(m.get("avg_duration_ms", 0), 1),
            "last_called_at":  m.get("last_called_at"),
            "last_evolved_at": m.get("last_evolved_at"),
            "evolution_count": m.get("evolution_count", 0),
        })
    python_skills = [f.stem for f in SKILLS_PY_DIR.glob("*.py")]
    return {
        "node_skills":   node_skills,
        "python_skills": python_skills,
        "total_node":    len(node_skills),
        "total_python":  len(python_skills),
    }


@app.get("/skills/{name}")
async def get_skill_detail(name: str):
    """Détail d'un skill : code + manifest + métriques + backups."""
    if not re.match(r'^[a-zA-Z0-9_\-]+$', name):
        raise HTTPException(status_code=400, detail="Nom invalide")
    skill_dir = SKILLS_NODE_DIR / name
    if not skill_dir.exists():
        raise HTTPException(status_code=404, detail=f"Skill '{name}' introuvable")

    code, manifest = "", {}
    try: code     = (skill_dir / "skill.js").read_text(encoding="utf-8")
    except Exception: pass
    try: manifest = json.loads((skill_dir / "manifest.json").read_text(encoding="utf-8"))
    except Exception: pass

    backups = sorted([f.name for f in skill_dir.glob("skill.v*.js")])
    metrics = _read_metrics().get(name, {})

    return {
        "name":     name,
        "manifest": manifest,
        "code":     code,
        "backups":  backups,
        "metrics":  metrics,
    }


@app.get("/evolution-log")
async def get_evolution_log(limit: int = 50):
    """Retourne les derniers événements du journal d'évolution."""
    if not EVOLUTION_LOG.exists():
        return {"events": []}
    lines = [l.strip() for l in EVOLUTION_LOG.read_text(encoding="utf-8").splitlines() if l.strip()]
    events = []
    for line in lines[-limit:]:
        try: events.append(json.loads(line))
        except Exception: pass
    return {"events": list(reversed(events))}


@app.get("/metrics")
async def get_metrics():
    """Métriques de tous les skills trackés."""
    metrics = _read_metrics()
    # Enrichit avec le nom et trie par total_calls desc
    items = [{"name": k, **v} for k, v in metrics.items()]
    items.sort(key=lambda x: x.get("total_calls", 0), reverse=True)
    return {"metrics": items, "total_tracked": len(items)}


@app.get("/health")
async def health():
    reg = _read_registry()
    metrics = _read_metrics()
    return {
        "status":             "ok",
        "layer":              "evolution",
        "version":            "2.0.0",
        "repair_backend":     get_repair_backend(),
        "python_skills":      len(list(SKILLS_PY_DIR.glob("*.py"))),
        "node_skills":        len(reg.get("skills", [])),
        "tracked_skills":     len(metrics),
        "evolution_log_size": len(EVOLUTION_LOG.read_text(encoding="utf-8").splitlines()) if EVOLUTION_LOG.exists() else 0,
        "auto_evolve_cycle":  "30min",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=CONFIG["ports"]["evolution"])
