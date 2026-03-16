"""
agent/goals.py — Couche 10 : Autonomous Goal Loop
FastAPI :8010

Gestion des objectifs à long terme :
- SQLite goals.db — persistance cross-restart
- Décomposition HTN via Planner (Phase 10)
- Auto-exécution de missions pour les objectifs actifs (toutes les 30 min)
- Tracking progrès, historique missions, planning temporel
"""
from __future__ import annotations

import asyncio
import os
import sqlite3
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

GOALS_PORT   = int(os.getenv("GOALS_PORT", "8010"))
QUEEN_URL    = os.getenv("QUEEN_URL",   "http://localhost:8001")
PLANNER_URL  = os.getenv("PLANNER_URL", "http://localhost:8008")
DB_FILE      = Path(__file__).parent / "goals.db"

# Intervalle de la boucle autonome (secondes)
AUTO_LOOP_INTERVAL = int(os.getenv("GOALS_LOOP_INTERVAL", "1800"))  # 30 min

# ---------------------------------------------------------------------------
# SQLite helpers
# ---------------------------------------------------------------------------

def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_FILE))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def _init_db():
    with _get_conn() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS goals (
            id            TEXT PRIMARY KEY,
            title         TEXT NOT NULL,
            description   TEXT NOT NULL DEFAULT '',
            priority      INTEGER NOT NULL DEFAULT 5,
            status        TEXT NOT NULL DEFAULT 'pending',
            auto_execute  INTEGER NOT NULL DEFAULT 1,
            progress_pct  REAL NOT NULL DEFAULT 0.0,
            missions_count INTEGER NOT NULL DEFAULT 0,
            last_mission_id TEXT,
            next_mission_at TEXT,
            deadline      TEXT,
            plan_json     TEXT,
            created_at    TEXT NOT NULL,
            updated_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS goal_missions (
            id          TEXT PRIMARY KEY,
            goal_id     TEXT NOT NULL,
            mission_id  TEXT,
            command     TEXT NOT NULL,
            status      TEXT NOT NULL DEFAULT 'pending',
            result      TEXT,
            started_at  TEXT NOT NULL,
            completed_at TEXT,
            FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE
        );
        """)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_dict(row) -> dict:
    return dict(row) if row else {}


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class GoalCreate(BaseModel):
    description: str
    priority: int = 5
    deadline: Optional[str] = None
    auto_execute: bool = True


class StatusUpdate(BaseModel):
    status: str  # pending | active | completed | failed | paused


# ---------------------------------------------------------------------------
# Async HTTP client
# ---------------------------------------------------------------------------

_http: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http
    if _http is None or _http.is_closed:
        _http = httpx.AsyncClient(timeout=30.0)
    return _http


# ---------------------------------------------------------------------------
# Goal helpers
# ---------------------------------------------------------------------------

async def _spawn_mission(goal: dict) -> str | None:
    """Lance une mission via Queen pour l'objectif donné. Retourne le mission_id."""
    command = f"[GOAL:{goal['id'][:8]}] {goal['description']}"
    try:
        r = await _client().post(f"{QUEEN_URL}/mission", json={
            "command": command,
            "priority": goal["priority"],
        })
        if r.status_code == 200:
            data = r.json()
            return data.get("mission_id") or data.get("id")
    except Exception as e:
        print(f"[Goals] ⚠️  spawn_mission failed for {goal['id'][:8]}: {e}")
    return None


async def _decompose_goal(goal: dict) -> dict | None:
    """Appelle le Planner pour décomposer l'objectif en plan HTN."""
    try:
        r = await _client().post(f"{PLANNER_URL}/plan", json={
            "mission": goal["description"],
            "context": {"goal_id": goal["id"], "priority": goal["priority"]},
        })
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"[Goals] ⚠️  decompose_goal failed for {goal['id'][:8]}: {e}")
    return None


def _update_goal_db(goal_id: str, **kwargs):
    """Met à jour des champs d'un objectif. updated_at toujours mis à jour."""
    kwargs["updated_at"] = _now()
    cols = ", ".join(f"{k}=?" for k in kwargs)
    vals = list(kwargs.values()) + [goal_id]
    with _get_conn() as conn:
        conn.execute(f"UPDATE goals SET {cols} WHERE id=?", vals)


def _compute_progress(goal_id: str) -> float:
    """Calcule le progrès en % sur la base des missions liées."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT status FROM goal_missions WHERE goal_id=?", (goal_id,)
        ).fetchall()
    if not rows:
        return 0.0
    total = len(rows)
    done = sum(1 for r in rows if r["status"] in ("completed", "success"))
    return round(done / total * 100, 1)


# ---------------------------------------------------------------------------
# Auto-execute loop
# ---------------------------------------------------------------------------

async def _auto_goal_loop():
    """Toutes les AUTO_LOOP_INTERVAL secondes, lance des missions pour les objectifs actifs."""
    await asyncio.sleep(10)  # Warm-up
    while True:
        try:
            with _get_conn() as conn:
                active_goals = conn.execute(
                    "SELECT * FROM goals WHERE status='active' AND auto_execute=1 ORDER BY priority DESC"
                ).fetchall()

            now_str = _now()
            for row in active_goals:
                goal = _row_to_dict(row)
                # Vérifie si le prochain déclenchement est passé
                next_at = goal.get("next_mission_at")
                if next_at and next_at > now_str:
                    continue  # Pas encore l'heure

                print(f"[Goals] 🔄 Auto-execute: {goal['id'][:8]} — {goal['description'][:60]}")
                mission_id = await _spawn_mission(goal)

                gm_id = str(uuid.uuid4())
                started = _now()
                with _get_conn() as conn:
                    conn.execute(
                        "INSERT INTO goal_missions VALUES (?,?,?,?,?,?,?,?)",
                        (gm_id, goal["id"], mission_id, goal["description"],
                         "started", None, started, None),
                    )

                next_ts = (datetime.now(timezone.utc) + timedelta(seconds=AUTO_LOOP_INTERVAL)).isoformat()
                new_count = (goal.get("missions_count") or 0) + 1
                _update_goal_db(
                    goal["id"],
                    missions_count=new_count,
                    last_mission_id=mission_id or "",
                    next_mission_at=next_ts,
                )

        except Exception as e:
            print(f"[Goals] ❌ auto_goal_loop error: {e}")

        await asyncio.sleep(AUTO_LOOP_INTERVAL)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    asyncio.create_task(_auto_goal_loop())
    print(f"[Goals] ✅ Démarré sur :{GOALS_PORT} — SQLite: {DB_FILE}")
    yield
    if _http and not _http.is_closed:
        await _http.aclose()


app = FastAPI(title="Goals Layer", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/goals")
async def create_goal(req: GoalCreate):
    """Crée un nouvel objectif."""
    if not req.description.strip():
        raise HTTPException(400, "description vide")
    gid = str(uuid.uuid4())
    now = _now()
    # Titre = 60 premiers caractères de la description
    title = req.description.strip()[:60]
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO goals VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (gid, title, req.description.strip(), req.priority,
             "pending", int(req.auto_execute), 0.0, 0, None, None,
             req.deadline, None, now, now),
        )
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM goals WHERE id=?", (gid,)).fetchone()
    return {"ok": True, "goal": _row_to_dict(row)}


@app.get("/goals")
async def list_goals(status: str = Query("all"), limit: int = Query(100)):
    """Liste les objectifs avec compteurs."""
    with _get_conn() as conn:
        if status == "all":
            rows = conn.execute(
                "SELECT * FROM goals ORDER BY priority DESC, created_at DESC LIMIT ?",
                (limit,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM goals WHERE status=? ORDER BY priority DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        counts = conn.execute(
            "SELECT status, COUNT(*) as c FROM goals GROUP BY status"
        ).fetchall()

    goals = [_row_to_dict(r) for r in rows]
    stats = {r["status"]: r["c"] for r in counts}
    stats["total"] = sum(stats.values())
    return {"goals": goals, "stats": stats}


@app.get("/goals/schedule")
async def goals_schedule():
    """Retourne le planning des prochaines auto-exécutions."""
    with _get_conn() as conn:
        rows = conn.execute(
            "SELECT id, title, next_mission_at, priority, status FROM goals "
            "WHERE status='active' AND auto_execute=1 AND next_mission_at IS NOT NULL "
            "ORDER BY next_mission_at ASC LIMIT 10"
        ).fetchall()
    schedule = [_row_to_dict(r) for r in rows]
    nxt = schedule[0] if schedule else None
    return {"schedule": schedule, "next": nxt}


@app.get("/goals/stats")
async def goals_stats():
    """Statistiques globales."""
    with _get_conn() as conn:
        counts = conn.execute(
            "SELECT status, COUNT(*) as c FROM goals GROUP BY status"
        ).fetchall()
        missions_total = conn.execute("SELECT COUNT(*) as c FROM goal_missions").fetchone()["c"]
        missions_done  = conn.execute(
            "SELECT COUNT(*) as c FROM goal_missions WHERE status IN ('completed','success')"
        ).fetchone()["c"]
        avg_prio = conn.execute("SELECT AVG(priority) as a FROM goals WHERE status='active'").fetchone()["a"]
    status_counts = {r["status"]: r["c"] for r in counts}
    return {
        "goals_total":     sum(status_counts.values()),
        "goals_active":    status_counts.get("active", 0),
        "goals_completed": status_counts.get("completed", 0),
        "goals_failed":    status_counts.get("failed", 0),
        "missions_total":  missions_total,
        "missions_done":   missions_done,
        "avg_active_priority": round(avg_prio or 0, 1),
        "loop_interval_s": AUTO_LOOP_INTERVAL,
    }


@app.get("/goals/{goal_id}")
async def get_goal(goal_id: str):
    """Détail d'un objectif + ses missions."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not row:
            raise HTTPException(404, "goal not found")
        missions = conn.execute(
            "SELECT * FROM goal_missions WHERE goal_id=? ORDER BY started_at DESC LIMIT 20",
            (goal_id,),
        ).fetchall()
    return {
        "goal": _row_to_dict(row),
        "missions": [_row_to_dict(m) for m in missions],
    }


@app.delete("/goals/{goal_id}")
async def delete_goal(goal_id: str):
    """Supprime un objectif et ses missions liées."""
    with _get_conn() as conn:
        row = conn.execute("SELECT id FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not row:
            raise HTTPException(404, "goal not found")
        conn.execute("DELETE FROM goals WHERE id=?", (goal_id,))
    return {"ok": True}


@app.patch("/goals/{goal_id}/status")
async def update_status(goal_id: str, req: StatusUpdate):
    """Met à jour le statut d'un objectif."""
    valid = {"pending", "active", "completed", "failed", "paused"}
    if req.status not in valid:
        raise HTTPException(400, f"status invalide: {req.status}")
    with _get_conn() as conn:
        row = conn.execute("SELECT id FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not row:
            raise HTTPException(404, "goal not found")
    _update_goal_db(goal_id, status=req.status)
    # Si activé → programmer la prochaine exécution
    if req.status == "active":
        next_ts = (datetime.now(timezone.utc) + timedelta(seconds=60)).isoformat()
        _update_goal_db(goal_id, next_mission_at=next_ts)
    return {"ok": True, "goal_id": goal_id, "status": req.status}


@app.post("/goals/{goal_id}/execute")
async def execute_goal_now(goal_id: str):
    """Lance immédiatement une mission pour cet objectif."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not row:
            raise HTTPException(404, "goal not found")
    goal = _row_to_dict(row)
    mission_id = await _spawn_mission(goal)

    gm_id = str(uuid.uuid4())
    started = _now()
    with _get_conn() as conn:
        conn.execute(
            "INSERT INTO goal_missions VALUES (?,?,?,?,?,?,?,?)",
            (gm_id, goal_id, mission_id, goal["description"],
             "started", None, started, None),
        )
    next_ts = (datetime.now(timezone.utc) + timedelta(seconds=AUTO_LOOP_INTERVAL)).isoformat()
    new_count = (goal.get("missions_count") or 0) + 1
    _update_goal_db(
        goal_id,
        missions_count=new_count,
        last_mission_id=mission_id or "",
        next_mission_at=next_ts,
        status="active",
    )
    return {"ok": True, "goal_id": goal_id, "mission_id": mission_id, "gm_id": gm_id}


@app.post("/goals/{goal_id}/plan")
async def plan_goal(goal_id: str):
    """Décompose l'objectif via le Planner HTN (Phase 10)."""
    with _get_conn() as conn:
        row = conn.execute("SELECT * FROM goals WHERE id=?", (goal_id,)).fetchone()
        if not row:
            raise HTTPException(404, "goal not found")
    goal = _row_to_dict(row)
    plan = await _decompose_goal(goal)
    if plan:
        import json
        _update_goal_db(goal_id, plan_json=json.dumps(plan))
    return {"ok": bool(plan), "plan": plan}


@app.get("/health")
async def health():
    # Compte les objectifs actifs
    try:
        with _get_conn() as conn:
            active = conn.execute("SELECT COUNT(*) as c FROM goals WHERE status='active'").fetchone()["c"]
            total  = conn.execute("SELECT COUNT(*) as c FROM goals").fetchone()["c"]
    except Exception:
        active, total = 0, 0
    return {
        "status": "ok",
        "port": GOALS_PORT,
        "goals_active": active,
        "goals_total": total,
        "loop_interval_s": AUTO_LOOP_INTERVAL,
        "db": str(DB_FILE),
    }
