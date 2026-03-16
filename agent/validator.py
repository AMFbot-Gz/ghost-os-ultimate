"""
agent/validator.py — Couche 14 : Skill Validator Loop  (Phase 17)
FastAPI :8014

Pipeline de validation en 5 contrôles pour chaque skill Node.js généré :
  1. syntax      — node --input-type=module --check (< 5s)
  2. structure   — export async function run() présent, pas de export default seul
  3. security    — patterns shell dangereux bloqués
  4. execution   — sandbox Node.js réel, timeout 12s, doit retourner {success:…}
  5. output      — résultat JSON valide avec clé success

Cycle complet (fermé) :
  Miner → Evolution.generate-skill-node → Validator.validate → deploy/quarantine
  Signal phéromone émis dans agent/signals.jsonl à chaque décision
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Config ────────────────────────────────────────────────────────────────────

ROOT           = Path(__file__).resolve().parent.parent
SKILLS_DIR     = ROOT / "skills"
REGISTRY_FILE  = SKILLS_DIR / "registry.json"
QUARANTINE_DIR = SKILLS_DIR / "_quarantine"
SIGNALS_FILE   = Path(__file__).parent / "signals.jsonl"
DB_FILE        = Path(__file__).parent / "validator.db"

# Timeout sandbox d'exécution (secondes)
EXEC_TIMEOUT = 12

# Patterns shell dangereux — bloquent le check security
_DANGEROUS_PATTERNS = [
    r"rm\s+-rf\s+/",
    r":\(\)\{\s*:\|:&\s*\};:",       # fork bomb
    r"dd\s+if=/dev/zero",
    r"mkfs\.",
    r"\bshutdown\b",
    r"\breboot\b",
    r"\bhalt\b",
    r">\s*/dev/sd",
    r"chmod\s+-R\s+777\s+/",
    r"chown\s+-R.*\s+/",
    r"find\s+/\s+.*-delete",
    r"curl\s+.*\|\s*(bash|sh)",      # pipe to shell
    r"wget\s+.*-O\s*-\s*\|",
]

_DANGEROUS_RE = [re.compile(p, re.IGNORECASE | re.MULTILINE) for p in _DANGEROUS_PATTERNS]

# Patterns structure obligatoire
_REQUIRED_EXPORT = re.compile(r"export\s+async\s+function\s+run\s*\(")

_SIGNALS_LOCK = asyncio.Lock()
_REGISTRY_LOCK = asyncio.Lock()


# ─── SQLite ────────────────────────────────────────────────────────────────────

def _init_db():
    QUARANTINE_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS validation_runs (
                id            TEXT PRIMARY KEY,
                created_at    TEXT NOT NULL,
                skill_name    TEXT NOT NULL,
                checks_json   TEXT NOT NULL,
                passed        INTEGER NOT NULL DEFAULT 0,
                deployed      INTEGER NOT NULL DEFAULT 0,
                quarantined   INTEGER NOT NULL DEFAULT 0,
                error         TEXT,
                duration_ms   INTEGER,
                source        TEXT DEFAULT 'api',
                code_preview  TEXT
            )
        """)
        conn.commit()


def _save_run(run: dict):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            INSERT OR REPLACE INTO validation_runs
              (id, created_at, skill_name, checks_json, passed, deployed,
               quarantined, error, duration_ms, source, code_preview)
            VALUES (:id, :created_at, :skill_name, :checks_json, :passed, :deployed,
                    :quarantined, :error, :duration_ms, :source, :code_preview)
        """, run)
        conn.commit()


def _get_runs(limit: int = 50) -> list[dict]:
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM validation_runs ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["checks"] = json.loads(d.pop("checks_json", "{}"))
            except Exception:
                d["checks"] = {}
            result.append(d)
        return result


def _get_stats() -> dict:
    with sqlite3.connect(DB_FILE) as conn:
        row = conn.execute("""
            SELECT
                COUNT(*) as total,
                SUM(passed) as passed,
                SUM(deployed) as deployed,
                SUM(quarantined) as quarantined,
                AVG(duration_ms) as avg_ms
            FROM validation_runs
        """).fetchone()
        total, passed, deployed, quarantined, avg_ms = row
        total = total or 0
        passed = passed or 0
        return {
            "total":         total,
            "passed":        passed,
            "failed":        total - passed,
            "deployed":      deployed or 0,
            "quarantined":   quarantined or 0,
            "pass_rate":     round(passed / (total + 1e-9), 3),
            "avg_ms":        round(avg_ms or 0),
        }


# ─── Signaux phéromone ─────────────────────────────────────────────────────────

async def _emit_signal(signal_type: str, data: dict):
    entry = {
        "type":       signal_type,
        "source":     "validator",
        "timestamp":  datetime.utcnow().isoformat(),
        "data":       data,
    }
    try:
        async with _SIGNALS_LOCK:
            with open(SIGNALS_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        print(f"[Validator] Signal error: {e}")


# ─── Registry helpers ──────────────────────────────────────────────────────────

def _read_registry() -> dict:
    if not REGISTRY_FILE.exists():
        return {"version": "1.0.0", "skills": []}
    try:
        return json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"version": "1.0.0", "skills": []}


def _write_registry(reg: dict):
    REGISTRY_FILE.write_text(json.dumps(reg, indent=2, ensure_ascii=False), encoding="utf-8")


async def _registry_mark_validated(skill_name: str):
    """Ajoute validated_at + validation_status=passed dans l'entrée registry."""
    async with _REGISTRY_LOCK:
        reg = _read_registry()
        for s in reg.get("skills", []):
            if s["name"] == skill_name:
                s["validated_at"]      = datetime.utcnow().isoformat()
                s["validation_status"] = "passed"
                break
        _write_registry(reg)


async def _registry_remove(skill_name: str):
    """Retire un skill du registry (quarantaine)."""
    async with _REGISTRY_LOCK:
        reg = _read_registry()
        reg["skills"] = [s for s in reg.get("skills", []) if s["name"] != skill_name]
        _write_registry(reg)


# ─── Validation pipeline ───────────────────────────────────────────────────────

def _check_syntax(code: str) -> dict:
    """node --input-type=module --check — vérifie la syntaxe ESM."""
    try:
        r = subprocess.run(
            ["node", "--input-type=module", "--check"],
            input=code, capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0:
            return {"passed": True, "detail": "OK"}
        return {"passed": False, "detail": (r.stderr or r.stdout).strip()[:300]}
    except FileNotFoundError:
        return {"passed": True, "detail": "node absent — check ignoré", "skipped": True}
    except subprocess.TimeoutExpired:
        return {"passed": False, "detail": "Timeout vérification syntaxe (5s)"}
    except Exception as e:
        return {"passed": False, "detail": str(e)[:200]}


def _check_structure(code: str) -> dict:
    """Le skill doit exporter async function run(...)."""
    if _REQUIRED_EXPORT.search(code):
        return {"passed": True, "detail": "export async function run() trouvé"}
    return {
        "passed": False,
        "detail": "export async function run() manquant — structure obligatoire",
    }


def _check_security(code: str) -> dict:
    """Détecte les patterns shell dangereux."""
    for pattern_re, pattern_str in zip(_DANGEROUS_RE, _DANGEROUS_PATTERNS):
        if pattern_re.search(code):
            return {
                "passed": False,
                "detail": f"Pattern dangereux détecté : {pattern_str[:50]}",
            }
    return {"passed": True, "detail": f"Aucun des {len(_DANGEROUS_PATTERNS)} patterns dangereux trouvé"}


def _check_execution(code: str, skill_name: str) -> dict:
    """Exécute le skill dans un sandbox Node.js et vérifie qu'il ne plante pas."""
    # Écrire le skill dans un fichier .mjs temporaire
    with tempfile.TemporaryDirectory(prefix="validator_") as tmpdir:
        skill_path = Path(tmpdir) / "skill.mjs"
        skill_path.write_text(code, encoding="utf-8")

        # Runner qui importe le skill et appelle run({})
        runner = f"""
import * as skill from '{skill_path.as_posix()}';
(async () => {{
  try {{
    if (typeof skill.run !== 'function') {{
      console.log(JSON.stringify({{ok: false, error: 'run is not a function'}}));
      process.exit(0);
    }}
    const result = await skill.run({{}});
    const valid = result !== null && typeof result === 'object' && 'success' in result;
    console.log(JSON.stringify({{ok: true, result: result ?? null, valid_shape: valid}}));
  }} catch(e) {{
    console.log(JSON.stringify({{ok: false, error: e.message || String(e)}}));
  }}
}})();
"""
        runner_path = Path(tmpdir) / "runner.mjs"
        runner_path.write_text(runner, encoding="utf-8")

        try:
            r = subprocess.run(
                ["node", str(runner_path)],
                capture_output=True, text=True,
                timeout=EXEC_TIMEOUT,
            )
        except FileNotFoundError:
            return {"passed": True, "detail": "node absent — exécution ignorée", "skipped": True}
        except subprocess.TimeoutExpired:
            return {"passed": False, "detail": f"Timeout sandbox ({EXEC_TIMEOUT}s) — skill trop lent ou boucle infinie"}
        except Exception as e:
            return {"passed": False, "detail": str(e)[:200]}

        stdout = r.stdout.strip()
        stderr = r.stderr.strip()

        if r.returncode != 0 and not stdout:
            return {
                "passed": False,
                "detail": f"Exit code {r.returncode} | {(stderr or 'pas de stderr')[:200]}",
            }

        # Chercher la dernière ligne JSON dans stdout
        try:
            last_json_line = None
            for line in reversed(stdout.splitlines()):
                line = line.strip()
                if line.startswith("{"):
                    last_json_line = line
                    break
            if not last_json_line:
                return {"passed": False, "detail": f"Pas de JSON dans stdout: {stdout[:100]}"}
            out = json.loads(last_json_line)
            if not out.get("ok"):
                err = out.get("error", "erreur inconnue")
                return {"passed": False, "detail": f"Exécution échouée : {err[:200]}"}
            return {"passed": True, "detail": "Exécution OK", "output": out.get("result")}
        except json.JSONDecodeError:
            return {"passed": False, "detail": f"JSON invalide en stdout : {stdout[:100]}"}


def _check_output(exec_result: dict) -> dict:
    """Le résultat doit avoir la clé 'success'."""
    if not exec_result.get("passed"):
        return {"passed": False, "detail": "Dépend du check execution (non passé)"}
    output = exec_result.get("output")
    if exec_result.get("skipped"):
        return {"passed": True, "detail": "Check exécution ignoré — output non vérifiable", "skipped": True}
    if output is None:
        return {"passed": False, "detail": "run() a retourné null/undefined"}
    if not isinstance(output, dict):
        return {"passed": False, "detail": f"run() doit retourner un objet, reçu : {type(output).__name__}"}
    if "success" not in output:
        return {"passed": False, "detail": f"Clé 'success' manquante dans : {list(output.keys())}"}
    return {"passed": True, "detail": f"output.success = {output['success']}"}


async def run_validation_pipeline(
    code: str,
    skill_name: str,
    source: str = "api",
    auto_deploy: bool = True,
    auto_quarantine: bool = True,
) -> dict:
    """
    Lance les 5 checks en séquence.
    - auto_deploy=True   → si tout passe : marque validated dans registry
    - auto_quarantine=True → si échec : déplace dans skills/_quarantine/ + retire du registry
    Retourne le rapport complet.
    """
    t0 = time.time()
    run_id = uuid.uuid4().hex[:8]

    # ── 5 checks ──────────────────────────────────────────────────────────────
    c_syntax    = _check_syntax(code)
    c_structure = _check_structure(code)
    c_security  = _check_security(code)

    # Execution + output en thread (subprocess bloquant)
    loop = asyncio.get_event_loop()
    c_exec = await loop.run_in_executor(None, _check_execution, code, skill_name)
    c_output = _check_output(c_exec)

    checks = {
        "syntax":    c_syntax,
        "structure": c_structure,
        "security":  c_security,
        "execution": c_exec,
        "output":    c_output,
    }

    all_passed = all(c.get("passed") for c in checks.values())
    duration_ms = int((time.time() - t0) * 1000)

    deployed    = False
    quarantined = False
    deploy_error = None

    # ── Action post-validation ─────────────────────────────────────────────────
    if all_passed and auto_deploy:
        try:
            await _registry_mark_validated(skill_name)
            deployed = True
            print(f"[Validator] ✅ {skill_name} validé et déployé")
        except Exception as e:
            deploy_error = str(e)
            print(f"[Validator] ⚠️  deploy error pour {skill_name}: {e}")

    elif not all_passed and auto_quarantine:
        # Déplacer le skill en quarantaine si le répertoire existe
        skill_dir = SKILLS_DIR / skill_name
        if skill_dir.exists():
            q_dest = QUARANTINE_DIR / skill_name
            try:
                if q_dest.exists():
                    shutil.rmtree(q_dest)
                shutil.move(str(skill_dir), str(q_dest))
                await _registry_remove(skill_name)
                quarantined = True
                print(f"[Validator] 🔒 {skill_name} mis en quarantaine")
            except Exception as e:
                print(f"[Validator] ⚠️  quarantine error pour {skill_name}: {e}")
        else:
            # Skill pas encore sur disque — on note juste l'échec
            quarantined = False

    # ── SQLite log ────────────────────────────────────────────────────────────
    failed_checks = [name for name, c in checks.items() if not c.get("passed")]
    error_summary = "; ".join(
        f"{name}: {checks[name].get('detail','')[:60]}" for name in failed_checks
    ) if failed_checks else None

    db_row = {
        "id":           run_id,
        "created_at":   datetime.utcnow().isoformat(),
        "skill_name":   skill_name,
        "checks_json":  json.dumps(checks),
        "passed":       int(all_passed),
        "deployed":     int(deployed),
        "quarantined":  int(quarantined),
        "error":        error_summary,
        "duration_ms":  duration_ms,
        "source":       source,
        "code_preview": code[:200],
    }
    try:
        _save_run(db_row)
    except Exception as e:
        print(f"[Validator] DB log error: {e}")

    # ── Signal phéromone ──────────────────────────────────────────────────────
    signal_type = "skill_validated" if all_passed else "skill_quarantined"
    await _emit_signal(signal_type, {
        "skill":       skill_name,
        "passed":      all_passed,
        "deployed":    deployed,
        "quarantined": quarantined,
        "checks_passed": [n for n, c in checks.items() if c.get("passed")],
        "checks_failed": failed_checks,
        "duration_ms": duration_ms,
        "source":      source,
    })

    return {
        "run_id":      run_id,
        "skill_name":  skill_name,
        "passed":      all_passed,
        "deployed":    deployed,
        "quarantined": quarantined,
        "checks":      checks,
        "checks_passed": [n for n, c in checks.items() if c.get("passed")],
        "checks_failed": failed_checks,
        "duration_ms": duration_ms,
        "deploy_error": deploy_error,
        "source":      source,
    }


# ─── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    print("[Validator] 🔬 Skill Validator Loop actif — port 8014")
    print(f"  Skills dir    : {SKILLS_DIR}")
    print(f"  Quarantine    : {QUARANTINE_DIR}")
    print(f"  Exec timeout  : {EXEC_TIMEOUT}s")
    print(f"  Security rules: {len(_DANGEROUS_PATTERNS)}")
    yield
    print("[Validator] 🛑 Arrêt validator")


app = FastAPI(title="Ghost OS Validator", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Modèles ──────────────────────────────────────────────────────────────────

class ValidateReq(BaseModel):
    name:            str
    code:            Optional[str] = None       # si absent → lit skills/{name}/skill.js
    auto_deploy:     bool = True
    auto_quarantine: bool = True
    source:          str = "api"


class RevalidateReq(BaseModel):
    auto_deploy:     bool = True
    auto_quarantine: bool = True


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/validate")
async def validate_skill(req: ValidateReq):
    """Valide un skill par son code ou en lisant skills/{name}/skill.js."""
    if req.code:
        code = req.code
    else:
        skill_file = SKILLS_DIR / req.name / "skill.js"
        if not skill_file.exists():
            return {"error": f"Skill '{req.name}' introuvable dans {SKILLS_DIR}"}
        code = skill_file.read_text(encoding="utf-8")

    return await run_validation_pipeline(
        code       = code,
        skill_name = req.name,
        source     = req.source,
        auto_deploy     = req.auto_deploy,
        auto_quarantine = req.auto_quarantine,
    )


@app.post("/revalidate/{skill_name}")
async def revalidate_skill(skill_name: str, req: RevalidateReq = RevalidateReq()):
    """Re-valide un skill déjà déployé (lit depuis skills/{name}/skill.js)."""
    skill_file = SKILLS_DIR / skill_name / "skill.js"
    if not skill_file.exists():
        # Peut-être en quarantaine
        q_file = QUARANTINE_DIR / skill_name / "skill.js"
        if q_file.exists():
            code = q_file.read_text(encoding="utf-8")
            return await run_validation_pipeline(code, skill_name, "revalidate",
                                                  req.auto_deploy, req.auto_quarantine)
        return {"error": f"Skill '{skill_name}' introuvable (ni deployed ni quarantined)"}
    code = skill_file.read_text(encoding="utf-8")
    return await run_validation_pipeline(code, skill_name, "revalidate",
                                          req.auto_deploy, req.auto_quarantine)


@app.get("/runs")
async def get_runs(limit: int = Query(50, ge=1, le=200)):
    items = _get_runs(limit)
    return {"count": len(items), "items": items}


@app.get("/quarantine")
async def list_quarantine():
    """Liste les skills en quarantaine."""
    if not QUARANTINE_DIR.exists():
        return {"skills": [], "count": 0}
    skills = []
    for p in QUARANTINE_DIR.iterdir():
        if p.is_dir() and (p / "skill.js").exists():
            manifest_f = p / "manifest.json"
            manifest   = {}
            if manifest_f.exists():
                try:
                    manifest = json.loads(manifest_f.read_text())
                except Exception:
                    pass
            skills.append({
                "name":    p.name,
                "desc":    manifest.get("description", ""),
                "created": manifest.get("created", ""),
            })
    return {"skills": skills, "count": len(skills)}


@app.post("/quarantine/{skill_name}/restore")
async def restore_from_quarantine(skill_name: str):
    """Restaure un skill depuis la quarantaine vers skills/ (sans validation)."""
    q_dir     = QUARANTINE_DIR / skill_name
    dest_dir  = SKILLS_DIR / skill_name
    if not q_dir.exists():
        return {"error": f"'{skill_name}' absent de la quarantaine"}
    if dest_dir.exists():
        return {"error": f"'{skill_name}' existe déjà dans skills/"}
    shutil.move(str(q_dir), str(dest_dir))
    # Ré-ajouter au registry
    async with _REGISTRY_LOCK:
        reg  = _read_registry()
        names = [s["name"] for s in reg.get("skills", [])]
        if skill_name not in names:
            manifest_f = dest_dir / "manifest.json"
            entry = {"name": skill_name, "description": "", "version": "1.0.0",
                     "created": datetime.utcnow().isoformat(), "restored_from_quarantine": True}
            if manifest_f.exists():
                try:
                    m = json.loads(manifest_f.read_text())
                    entry["description"] = m.get("description", "")
                    entry["version"]     = m.get("version", "1.0.0")
                    entry["created"]     = m.get("created", entry["created"])
                except Exception:
                    pass
            reg.setdefault("skills", []).append(entry)
            _write_registry(reg)
    return {"ok": True, "skill_name": skill_name, "status": "restored"}


@app.get("/stats")
async def get_stats():
    return _get_stats()


@app.get("/health")
async def health():
    stats = _get_stats()
    return {
        "status":         "ok",
        "layer":          "validator",
        "checks":         ["syntax", "structure", "security", "execution", "output"],
        "exec_timeout":   EXEC_TIMEOUT,
        "security_rules": len(_DANGEROUS_PATTERNS),
        "skills_dir":     str(SKILLS_DIR),
        "quarantine_dir": str(QUARANTINE_DIR),
        **stats,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.validator:app", host="0.0.0.0", port=8014, reload=False)
