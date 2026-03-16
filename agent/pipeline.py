"""
agent/pipeline.py — Couche 11 : Skill Pipeline Composer
FastAPI :8011

Pipelines réutilisables : chaîne de steps (shell / mission / skill)
avec substitution de variables, passage d'output entre steps,
exécution asynchrone, historique des runs.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

PIPELINE_PORT = int(os.getenv("PIPELINE_PORT", "8011"))
BRAIN_URL     = os.getenv("BRAIN_URL",    "http://localhost:8003")
EXECUTOR_URL  = os.getenv("EXECUTOR_URL", "http://localhost:8004")
DB_FILE       = Path(__file__).parent / "pipelines.db"

DEFAULT_STEP_TIMEOUT = 90   # secondes
MAX_STEP_TIMEOUT     = 300

# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(DB_FILE))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA foreign_keys=ON")
    return c


def _init_db():
    with _conn() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS pipelines (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            steps_json  TEXT NOT NULL DEFAULT '[]',
            variables_json TEXT NOT NULL DEFAULT '{}',
            tags        TEXT NOT NULL DEFAULT '',
            run_count   INTEGER NOT NULL DEFAULT 0,
            last_run_at TEXT,
            created_at  TEXT NOT NULL,
            updated_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pipeline_runs (
            id           TEXT PRIMARY KEY,
            pipeline_id  TEXT NOT NULL,
            status       TEXT NOT NULL DEFAULT 'pending',
            variables_json  TEXT NOT NULL DEFAULT '{}',
            step_results_json TEXT NOT NULL DEFAULT '[]',
            current_step INTEGER NOT NULL DEFAULT 0,
            total_steps  INTEGER NOT NULL DEFAULT 0,
            output       TEXT,
            error        TEXT,
            started_at   TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (pipeline_id) REFERENCES pipelines(id) ON DELETE CASCADE
        );
        """)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Built-in templates
# ---------------------------------------------------------------------------

TEMPLATES = [
    {
        "id": "tpl_web_summarize",
        "name": "Web Fetch & Résumé",
        "description": "Télécharge une URL et résume le contenu",
        "tags": "web,résumé",
        "variables": {"url": "https://example.com"},
        "steps": [
            {
                "id": "fetch",
                "name": "Fetch URL",
                "type": "shell",
                "command": "curl -s --max-time 15 -L '{{url}}' | head -c 4000",
                "timeout": 20,
            },
            {
                "id": "summarize",
                "name": "Résumer le contenu",
                "type": "mission",
                "command": "Résume en 5 points clés ce contenu web (réponds en français):\n{{steps.fetch.output}}",
                "timeout": 60,
            },
        ],
    },
    {
        "id": "tpl_health_report",
        "name": "Rapport Santé Système",
        "description": "Collecte les métriques système et génère un rapport",
        "tags": "système,monitoring",
        "variables": {},
        "steps": [
            {
                "id": "disk",
                "name": "Espace disque",
                "type": "shell",
                "command": "df -h | head -10",
                "timeout": 10,
            },
            {
                "id": "memory",
                "name": "Mémoire RAM",
                "type": "shell",
                "command": "free -h 2>/dev/null || vm_stat | head -15",
                "timeout": 10,
            },
            {
                "id": "processes",
                "name": "Top processus CPU",
                "type": "shell",
                "command": "ps aux --sort=-%cpu 2>/dev/null | head -8 || ps aux | sort -rk3 | head -8",
                "timeout": 10,
            },
            {
                "id": "report",
                "name": "Générer le rapport",
                "type": "mission",
                "command": "Génère un rapport de santé système concis (format markdown) avec ces données:\n\nDISQUE:\n{{steps.disk.output}}\n\nMEMOIRE:\n{{steps.memory.output}}\n\nPROCESSUS:\n{{steps.processes.output}}",
                "timeout": 60,
            },
        ],
    },
    {
        "id": "tpl_file_analysis",
        "name": "Analyse de Fichier",
        "description": "Lit un fichier et l'analyse avec Brain",
        "tags": "fichier,analyse",
        "variables": {"filepath": "/tmp/example.txt"},
        "steps": [
            {
                "id": "read",
                "name": "Lire le fichier",
                "type": "shell",
                "command": "cat '{{filepath}}' | head -c 6000",
                "timeout": 10,
            },
            {
                "id": "analyze",
                "name": "Analyser le contenu",
                "type": "mission",
                "command": "Analyse ce fichier et réponds: (1) type de contenu, (2) informations clés, (3) anomalies éventuelles.\n\nContenu:\n{{steps.read.output}}",
                "timeout": 60,
            },
        ],
    },
    {
        "id": "tpl_git_report",
        "name": "Rapport Git",
        "description": "Analyse l'état du dépôt git courant",
        "tags": "git,dev",
        "variables": {"path": "."},
        "steps": [
            {
                "id": "status",
                "name": "Git status",
                "type": "shell",
                "command": "cd '{{path}}' && git status --short 2>&1 | head -30",
                "timeout": 10,
            },
            {
                "id": "log",
                "name": "Git log récent",
                "type": "shell",
                "command": "cd '{{path}}' && git log --oneline -10 2>&1",
                "timeout": 10,
            },
            {
                "id": "report",
                "name": "Résumé des changements",
                "type": "mission",
                "command": "Résume l'état du dépôt git en français:\n\nSTATUS:\n{{steps.status.output}}\n\nHISTORIQUE:\n{{steps.log.output}}",
                "timeout": 60,
            },
        ],
    },
]

# ---------------------------------------------------------------------------
# Variable substitution
# ---------------------------------------------------------------------------

_VAR_RE = re.compile(r"\{\{(\w[\w.]*)\}\}")


def _substitute(template: str, variables: dict, step_results: dict) -> str:
    """Remplace {{key}} et {{steps.id.output}} dans un template."""
    def _replace(m: re.Match) -> str:
        key = m.group(1)
        if key.startswith("steps."):
            parts = key.split(".", 2)        # steps, step_id, field
            if len(parts) == 3:
                sid, field = parts[1], parts[2]
                return str(step_results.get(sid, {}).get(field, ""))
        return str(variables.get(key, m.group(0)))   # garde le placeholder si inconnu
    return _VAR_RE.sub(_replace, template)


# ---------------------------------------------------------------------------
# Step execution
# ---------------------------------------------------------------------------

async def _exec_step(step: dict, variables: dict, step_results: dict) -> dict:
    """Exécute un step et retourne {status, output, error, duration_ms}."""
    t0 = datetime.now(timezone.utc)
    command = _substitute(step.get("command", ""), variables, step_results)
    timeout = min(int(step.get("timeout", DEFAULT_STEP_TIMEOUT)), MAX_STEP_TIMEOUT)
    stype   = step.get("type", "shell")

    try:
        async with httpx.AsyncClient(timeout=timeout + 5) as c:
            if stype == "shell":
                r = await asyncio.wait_for(
                    c.post(f"{EXECUTOR_URL}/shell", json={"command": command}),
                    timeout=timeout,
                )
                r.raise_for_status()
                data = r.json()
                output = data.get("output", data.get("stdout", ""))
                if data.get("returncode", 0) != 0 and data.get("stderr"):
                    output += f"\n[stderr] {data['stderr'][:500]}"
                status = "completed"

            elif stype == "mission":
                # Appel Brain /raw pour une réponse LLM directe
                r = await asyncio.wait_for(
                    c.post(f"{BRAIN_URL}/raw", json={"prompt": command}),
                    timeout=timeout,
                )
                r.raise_for_status()
                output = r.json().get("content", r.json().get("result", ""))
                status = "completed"

            elif stype == "react":
                # Boucle ReAct complète pour les étapes complexes
                r = await asyncio.wait_for(
                    c.post(f"{BRAIN_URL}/react", json={"mission": command, "max_steps": 8}),
                    timeout=timeout,
                )
                r.raise_for_status()
                result = r.json()
                output = result.get("result", result.get("summary", str(result)[:500]))
                status = "completed"

            else:
                output = f"[Pipeline] type inconnu: {stype}"
                status = "completed"

    except asyncio.TimeoutError:
        output = ""
        status = "timeout"
    except Exception as e:
        output = ""
        status = "error"
        duration_ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
        return {"status": status, "output": output, "error": str(e)[:300], "duration_ms": duration_ms}

    duration_ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)
    return {"status": status, "output": str(output)[:8000], "error": None, "duration_ms": duration_ms}


# ---------------------------------------------------------------------------
# Pipeline runner (background task)
# ---------------------------------------------------------------------------

async def _run_pipeline(run_id: str, pipeline: dict, variables: dict):
    """Exécute le pipeline pas-à-pas et met à jour la DB."""
    steps = pipeline.get("steps", [])
    step_results: dict[str, dict] = {}   # step_id → result dict
    results_list = [{"step_id": s["id"], "name": s.get("name",""), "type": s.get("type","shell"),
                     "status": "pending", "output": None, "error": None, "duration_ms": None}
                    for s in steps]

    def _save(status: str, error: str | None = None, output: str | None = None):
        with _conn() as db:
            completed = _now() if status in ("completed", "failed", "error") else None
            db.execute(
                "UPDATE pipeline_runs SET status=?, step_results_json=?, current_step=?, "
                "output=?, error=?, completed_at=? WHERE id=?",
                (status, json.dumps(results_list),
                 sum(1 for r in results_list if r["status"] not in ("pending",)),
                 output, error, completed, run_id),
            )

    _save("running")

    final_output = ""
    for i, step in enumerate(steps):
        sid = step["id"]
        results_list[i]["status"] = "running"
        _save("running")

        res = await _exec_step(step, variables, step_results)

        step_results[sid] = res
        results_list[i].update({
            "status":      res["status"],
            "output":      res["output"],
            "error":       res.get("error"),
            "duration_ms": res["duration_ms"],
        })
        _save("running")

        if res["status"] in ("error", "timeout"):
            _save("failed", error=f"Step '{step.get('name', sid)}' failed: {res.get('error', res['status'])}")
            return

        final_output = res["output"] or ""

    # Succès — met à jour run_count + last_run_at sur le pipeline
    _save("completed", output=final_output[:4000])
    with _conn() as db:
        db.execute(
            "UPDATE pipelines SET run_count=run_count+1, last_run_at=? WHERE id=?",
            (_now(), pipeline["id"]),
        )


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class StepModel(BaseModel):
    id: str
    name: str
    type: str = "shell"        # shell | mission | react
    command: str
    timeout: int = DEFAULT_STEP_TIMEOUT


class PipelineCreate(BaseModel):
    name: str
    description: str = ""
    steps: list[StepModel]
    variables: dict = {}
    tags: str = ""


class RunRequest(BaseModel):
    variables: dict = {}


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    print(f"[Pipeline] ✅ Démarré sur :{PIPELINE_PORT} — SQLite: {DB_FILE}")
    yield


app = FastAPI(title="Pipeline Composer", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------------------
# Endpoints — Pipelines CRUD
# ---------------------------------------------------------------------------

@app.post("/pipelines")
async def create_pipeline(req: PipelineCreate):
    pid  = str(uuid.uuid4())
    now  = _now()
    with _conn() as db:
        db.execute(
            "INSERT INTO pipelines VALUES (?,?,?,?,?,?,?,?,?,?)",
            (pid, req.name, req.description,
             json.dumps([s.model_dump() for s in req.steps]),
             json.dumps(req.variables), req.tags,
             0, None, now, now),
        )
    with _conn() as db:
        row = db.execute("SELECT * FROM pipelines WHERE id=?", (pid,)).fetchone()
    return {"ok": True, "pipeline": dict(row)}


@app.get("/pipelines")
async def list_pipelines(limit: int = Query(50)):
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM pipelines ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return {"pipelines": [dict(r) for r in rows], "total": len(rows)}


@app.get("/pipelines/templates")
async def get_templates():
    return {"templates": TEMPLATES}


@app.get("/pipelines/{pipeline_id}")
async def get_pipeline(pipeline_id: str):
    with _conn() as db:
        row = db.execute("SELECT * FROM pipelines WHERE id=?", (pipeline_id,)).fetchone()
        if not row:
            raise HTTPException(404, "pipeline not found")
        runs = db.execute(
            "SELECT id, status, started_at, completed_at, current_step, total_steps "
            "FROM pipeline_runs WHERE pipeline_id=? ORDER BY started_at DESC LIMIT 10",
            (pipeline_id,),
        ).fetchall()
    return {"pipeline": dict(row), "recent_runs": [dict(r) for r in runs]}


@app.delete("/pipelines/{pipeline_id}")
async def delete_pipeline(pipeline_id: str):
    with _conn() as db:
        row = db.execute("SELECT id FROM pipelines WHERE id=?", (pipeline_id,)).fetchone()
        if not row:
            raise HTTPException(404, "pipeline not found")
        db.execute("DELETE FROM pipelines WHERE id=?", (pipeline_id,))
    return {"ok": True}


# ---------------------------------------------------------------------------
# Endpoints — Runs
# ---------------------------------------------------------------------------

@app.post("/pipelines/{pipeline_id}/run")
async def start_run(pipeline_id: str, req: RunRequest):
    """Démarre l'exécution asynchrone du pipeline."""
    with _conn() as db:
        row = db.execute("SELECT * FROM pipelines WHERE id=?", (pipeline_id,)).fetchone()
        if not row:
            raise HTTPException(404, "pipeline not found")
    pipeline = dict(row)
    pipeline["steps"] = json.loads(pipeline.get("steps_json", "[]"))

    # Merge variables : defaults pipeline + run overrides
    default_vars = json.loads(pipeline.get("variables_json", "{}"))
    variables    = {**default_vars, **req.variables}

    run_id     = str(uuid.uuid4())
    total_steps = len(pipeline["steps"])
    with _conn() as db:
        db.execute(
            "INSERT INTO pipeline_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (run_id, pipeline_id, "pending", json.dumps(variables),
             "[]", 0, total_steps, None, None, _now(), None),
        )

    # Lance en tâche de fond
    asyncio.create_task(_run_pipeline(run_id, pipeline, variables))
    return {"ok": True, "run_id": run_id, "pipeline_id": pipeline_id, "total_steps": total_steps}


@app.get("/runs")
async def list_runs(limit: int = Query(30), pipeline_id: str = Query(None)):
    with _conn() as db:
        if pipeline_id:
            rows = db.execute(
                "SELECT r.*, p.name as pipeline_name FROM pipeline_runs r "
                "JOIN pipelines p ON p.id = r.pipeline_id "
                "WHERE r.pipeline_id=? ORDER BY r.started_at DESC LIMIT ?",
                (pipeline_id, limit),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT r.*, p.name as pipeline_name FROM pipeline_runs r "
                "JOIN pipelines p ON p.id = r.pipeline_id "
                "ORDER BY r.started_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
    return {"runs": [dict(r) for r in rows], "total": len(rows)}


@app.get("/runs/{run_id}")
async def get_run(run_id: str):
    with _conn() as db:
        row = db.execute(
            "SELECT r.*, p.name as pipeline_name, p.steps_json "
            "FROM pipeline_runs r JOIN pipelines p ON p.id=r.pipeline_id WHERE r.id=?",
            (run_id,),
        ).fetchone()
        if not row:
            raise HTTPException(404, "run not found")
    d = dict(row)
    d["step_results"] = json.loads(d.get("step_results_json", "[]"))
    return d


@app.get("/stats")
async def stats():
    with _conn() as db:
        total_pipelines = db.execute("SELECT COUNT(*) as c FROM pipelines").fetchone()["c"]
        total_runs      = db.execute("SELECT COUNT(*) as c FROM pipeline_runs").fetchone()["c"]
        runs_completed  = db.execute("SELECT COUNT(*) as c FROM pipeline_runs WHERE status='completed'").fetchone()["c"]
        runs_failed     = db.execute("SELECT COUNT(*) as c FROM pipeline_runs WHERE status='failed'").fetchone()["c"]
        runs_running    = db.execute("SELECT COUNT(*) as c FROM pipeline_runs WHERE status='running'").fetchone()["c"]
    return {
        "pipelines": total_pipelines,
        "runs_total": total_runs,
        "runs_completed": runs_completed,
        "runs_failed": runs_failed,
        "runs_running": runs_running,
        "success_rate": round(runs_completed / total_runs * 100, 1) if total_runs else 0.0,
    }


@app.get("/health")
async def health():
    with _conn() as db:
        n_pipelines = db.execute("SELECT COUNT(*) as c FROM pipelines").fetchone()["c"]
        n_running   = db.execute("SELECT COUNT(*) as c FROM pipeline_runs WHERE status='running'").fetchone()["c"]
    return {
        "status":      "ok",
        "port":        PIPELINE_PORT,
        "pipelines":   n_pipelines,
        "runs_active": n_running,
        "db":          str(DB_FILE),
    }
