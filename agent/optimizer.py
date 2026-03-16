"""
agent/optimizer.py — Couche 17 : Self-Optimization Engine  (Phase 21)
FastAPI :8017

Moteur d'auto-optimisation autonome de la ruche :
  1. Récupère les behaviour gaps depuis le Miner (8012)
  2. Pour chaque gap non couvert : génère un skill via Evolution (8005)
  3. Valide les skills générés via le Validator (8014)
  4. Déploie les skills gold/silver, met en quarantaine les autres
  5. Journalise chaque cycle dans SQLite (optimizer.db)
  6. Publie les résultats sur le bus phéromone (signals.jsonl)
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
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

OPTIMIZER_PORT    = int(os.getenv("OPTIMIZER_PORT",        "8017"))
MINER_URL         = os.getenv("MINER_URL",        "http://localhost:8012")
EVOLUTION_URL     = os.getenv("EVOLUTION_URL",    "http://localhost:8005")
VALIDATOR_URL     = os.getenv("VALIDATOR_URL",    "http://localhost:8014")

ROOT              = Path(__file__).parent.parent
DB_FILE           = Path(__file__).parent / "optimizer.db"
SIGNALS_FILE      = Path(__file__).parent / "signals.jsonl"

# Paramètres du cycle
LOOP_INTERVAL_S    = int(os.getenv("OPTIMIZER_INTERVAL_S",   "1800"))  # 30 min
TOP_GAPS_PER_CYCLE = int(os.getenv("OPTIMIZER_TOP_GAPS",     "5"))
GAP_MIN_SCORE      = float(os.getenv("OPTIMIZER_GAP_MIN_SCORE", "1.5"))
STARTUP_DELAY_S    = 60  # Attendre que les autres couches soient prêtes

DEPLOY_TIERS   = {"gold", "silver"}   # tiers auto-déployés immédiatement
QUARANTINE_TIER = "quarantine"

# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _init_db() -> None:
    """Crée les tables SQLite si elles n'existent pas."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS cycles (
                id           TEXT PRIMARY KEY,
                started_at   TEXT NOT NULL,
                ended_at     TEXT,
                status       TEXT NOT NULL DEFAULT 'running',
                gaps_found   INTEGER DEFAULT 0,
                skills_gen   INTEGER DEFAULT 0,
                skills_pass  INTEGER DEFAULT 0,
                skills_fail  INTEGER DEFAULT 0,
                error        TEXT
            );
            CREATE TABLE IF NOT EXISTS actions (
                id           TEXT PRIMARY KEY,
                cycle_id     TEXT NOT NULL,
                created_at   TEXT NOT NULL,
                gap_pattern  TEXT NOT NULL,
                gap_score    REAL NOT NULL,
                domain       TEXT NOT NULL DEFAULT 'general',
                skill_name   TEXT,
                tier         TEXT,
                confidence   REAL,
                status       TEXT NOT NULL,
                detail       TEXT,
                FOREIGN KEY (cycle_id) REFERENCES cycles(id)
            );
            CREATE INDEX IF NOT EXISTS idx_actions_cycle_id ON actions(cycle_id);
            CREATE INDEX IF NOT EXISTS idx_actions_status   ON actions(status);
            CREATE INDEX IF NOT EXISTS idx_cycles_started   ON cycles(started_at DESC);
        """)

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

class TriggerResponse(BaseModel):
    cycle_id: str
    message:  str

class CycleRow(BaseModel):
    id:          str
    started_at:  str
    ended_at:    str | None
    status:      str
    gaps_found:  int
    skills_gen:  int
    skills_pass: int
    skills_fail: int
    error:       str | None

# ---------------------------------------------------------------------------
# État global
# ---------------------------------------------------------------------------

_current_cycle_id: str | None = None
_last_cycle_id:    str | None = None


def _get_quick_stats() -> dict:
    try:
        with sqlite3.connect(DB_FILE) as conn:
            conn.row_factory = sqlite3.Row
            total_cycles  = conn.execute("SELECT COUNT(*) FROM cycles").fetchone()[0]
            total_actions = conn.execute("SELECT COUNT(*) FROM actions").fetchone()[0]
            total_deployed = conn.execute(
                "SELECT COUNT(*) FROM actions WHERE status='deployed'"
            ).fetchone()[0]
            last = conn.execute(
                "SELECT * FROM cycles ORDER BY started_at DESC LIMIT 1"
            ).fetchone()
            return {
                "total_cycles":   total_cycles,
                "total_actions":  total_actions,
                "total_deployed": total_deployed,
                "last_cycle":     dict(last) if last else None,
            }
    except Exception:
        return {}

# ---------------------------------------------------------------------------
# Helpers async
# ---------------------------------------------------------------------------

async def _emit_signal(sig_type: str, payload: dict) -> None:
    entry = {"ts": datetime.now(timezone.utc).isoformat(), "type": sig_type, **payload}
    try:
        with open(SIGNALS_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception:
        pass


async def _fetch_top_gaps(limit: int = TOP_GAPS_PER_CYCLE) -> list[dict]:
    """Récupère les top gaps depuis le Miner (/gaps)."""
    try:
        async with httpx.AsyncClient(timeout=10) as c:
            r = await c.get(f"{MINER_URL}/gaps", params={"limit": limit})
            r.raise_for_status()
            data = r.json()
            return data.get("gaps", [])
    except Exception as e:
        print(f"[Optimizer] Miner inaccessible: {e}")
        return []


async def _list_existing_skills() -> set[str]:
    """Retourne l'ensemble des skill names connus depuis Evolution."""
    try:
        async with httpx.AsyncClient(timeout=8) as c:
            r = await c.get(f"{EVOLUTION_URL}/skills")
            r.raise_for_status()
            skills = r.json().get("skills", [])
            return {s.get("name", "").lower() for s in skills}
    except Exception:
        return set()


async def _generate_skill(gap: dict) -> str | None:
    """Demande à Evolution de générer un skill couvrant le gap."""
    pattern = gap.get("pattern", "unknown")
    domain  = gap.get("domain", "general")
    desc = (
        f"Skill pour automatiser le pattern comportemental '{pattern}' "
        f"dans le domaine {domain}. gap_score={gap.get('gap_score', 0):.2f}. "
        "L'agent détecte ce pattern fréquemment sans skill dédié."
    )
    try:
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post(f"{EVOLUTION_URL}/improve", json={"description": desc, "domain": domain})
            r.raise_for_status()
            data = r.json()
            return data.get("skill_name") or data.get("name")
    except Exception as e:
        print(f"[Optimizer] Génération échouée pour '{pattern}': {e}")
        return None


async def _validate_skill(skill_name: str) -> dict:
    """Valide un skill via le Validator et retourne tier + confidence."""
    try:
        async with httpx.AsyncClient(timeout=30) as c:
            r = await c.post(f"{VALIDATOR_URL}/validate/{skill_name}")
            r.raise_for_status()
            return r.json()
    except Exception as e:
        return {"tier": "error", "confidence": 0.0, "error": str(e)}

# ---------------------------------------------------------------------------
# Cycle d'optimisation
# ---------------------------------------------------------------------------

async def _run_optimization_cycle() -> str:
    """
    Exécute un cycle complet d'auto-optimisation :
      1. Récupère les top N gaps depuis Miner
      2. Filtre ceux dont gap_score >= GAP_MIN_SCORE
      3. Skips les gaps déjà couverts par un skill
      4. Génère + valide un skill pour chaque gap non couvert
      5. Journalise le cycle et les actions dans SQLite
    Retourne l'id du cycle créé.
    """
    global _current_cycle_id, _last_cycle_id

    cycle_id   = str(uuid.uuid4())[:8]
    started_at = datetime.now(timezone.utc).isoformat()
    _current_cycle_id = cycle_id

    print(f"[Optimizer] ⚡ Cycle {cycle_id} démarré")

    with sqlite3.connect(DB_FILE) as conn:
        conn.execute(
            "INSERT INTO cycles (id, started_at, status) VALUES (?, ?, 'running')",
            (cycle_id, started_at),
        )
        conn.commit()

    try:
        # 1. Récupérer gaps
        all_gaps = await _fetch_top_gaps()
        gaps = [g for g in all_gaps if g.get("gap_score", 0) >= GAP_MIN_SCORE]

        # 2. Lister skills existants pour dédoublonner
        existing_skills = await _list_existing_skills()

        skills_gen = 0
        skills_pass = 0
        skills_fail = 0

        for gap in gaps:
            pattern    = gap.get("pattern", "")
            domain     = gap.get("domain", "general")
            gap_score  = float(gap.get("gap_score", 0.0))
            action_id  = str(uuid.uuid4())[:8]
            created_at = datetime.now(timezone.utc).isoformat()

            # Normalise le nom candidat
            candidate = re.sub(r"[^a-z0-9_]", "_", pattern.lower())[:30].strip("_")

            # Skip si un skill similaire existe déjà
            if candidate in existing_skills or any(candidate in s for s in existing_skills):
                _record_action(
                    conn=None, action_id=action_id, cycle_id=cycle_id,
                    created_at=created_at, pattern=pattern, gap_score=gap_score,
                    domain=domain, skill_name=candidate, tier=None,
                    confidence=None, status="skipped", detail="skill already exists",
                )
                continue

            # Générer le skill
            skill_name = await _generate_skill(gap)
            skills_gen += 1

            if not skill_name:
                _record_action(
                    conn=None, action_id=action_id, cycle_id=cycle_id,
                    created_at=created_at, pattern=pattern, gap_score=gap_score,
                    domain=domain, skill_name=None, tier=None,
                    confidence=None, status="gen_failed", detail="evolution returned no skill",
                )
                skills_fail += 1
                continue

            # Valider le skill
            val        = await _validate_skill(skill_name)
            tier       = val.get("tier", "error")
            confidence = float(val.get("confidence", 0.0))

            if tier in DEPLOY_TIERS:
                action_status = "deployed"
                skills_pass += 1
                existing_skills.add(skill_name.lower())
            else:
                action_status = "quarantined" if tier == QUARANTINE_TIER else "failed"
                skills_fail += 1

            _record_action(
                conn=None, action_id=action_id, cycle_id=cycle_id,
                created_at=created_at, pattern=pattern, gap_score=gap_score,
                domain=domain, skill_name=skill_name, tier=tier,
                confidence=confidence, status=action_status,
                detail=f"confidence={confidence:.3f}",
            )

            await _emit_signal("optimizer.action", {
                "cycle_id":   cycle_id,
                "gap":        pattern,
                "skill":      skill_name,
                "tier":       tier,
                "confidence": confidence,
                "status":     action_status,
            })

        ended_at = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                """UPDATE cycles SET ended_at=?, status='done',
                   gaps_found=?, skills_gen=?, skills_pass=?, skills_fail=?
                   WHERE id=?""",
                (ended_at, len(gaps), skills_gen, skills_pass, skills_fail, cycle_id),
            )
            conn.commit()

        await _emit_signal("optimizer.cycle_done", {
            "cycle_id":   cycle_id,
            "gaps_found": len(gaps),
            "deployed":   skills_pass,
            "failed":     skills_fail,
        })

        print(
            f"[Optimizer] ✅ Cycle {cycle_id} terminé — "
            f"gaps={len(gaps)} gen={skills_gen} deployed={skills_pass}"
        )

    except Exception as e:
        print(f"[Optimizer] ❌ Cycle {cycle_id} erreur: {e}")
        with sqlite3.connect(DB_FILE) as conn:
            conn.execute(
                "UPDATE cycles SET status='error', error=?, ended_at=? WHERE id=?",
                (str(e), datetime.now(timezone.utc).isoformat(), cycle_id),
            )
            conn.commit()

    finally:
        _last_cycle_id    = cycle_id
        _current_cycle_id = None

    return cycle_id


def _record_action(
    conn, action_id, cycle_id, created_at, pattern, gap_score,
    domain, skill_name, tier, confidence, status, detail,
) -> None:
    """Insère une action dans la table actions (ouvre sa propre connexion si conn=None)."""
    row = (action_id, cycle_id, created_at, pattern, gap_score,
           domain, skill_name, tier, confidence, status, detail)
    if conn is None:
        with sqlite3.connect(DB_FILE) as c:
            c.execute("INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?,?,?)", row)
            c.commit()
    else:
        conn.execute("INSERT INTO actions VALUES (?,?,?,?,?,?,?,?,?,?,?)", row)


async def _optimization_loop() -> None:
    """Boucle périodique — un cycle toutes les LOOP_INTERVAL_S secondes."""
    await asyncio.sleep(STARTUP_DELAY_S)
    while True:
        try:
            await _run_optimization_cycle()
        except Exception as e:
            print(f"[Optimizer] Boucle erreur: {e}")
        await asyncio.sleep(LOOP_INTERVAL_S)

# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    asyncio.create_task(_optimization_loop())
    print(f"⚡ Ghost OS Ultimate — Self-Optimization Engine actif — port {OPTIMIZER_PORT}")
    print(f"  Cycle        : {LOOP_INTERVAL_S // 60}min (startup +{STARTUP_DELAY_S}s)")
    print(f"  Top gaps     : {TOP_GAPS_PER_CYCLE} par cycle (min_score={GAP_MIN_SCORE})")
    print(f"  Miner        : {MINER_URL}")
    print(f"  Evolution    : {EVOLUTION_URL}")
    print(f"  Validator    : {VALIDATOR_URL}")
    print(f"  Deploy tiers : {sorted(DEPLOY_TIERS)}")
    yield


app = FastAPI(
    title="Ghost OS — Self-Optimization Engine",
    description="Phase 21 : Auto-optimisation — Miner → Evolution → Validator → Deploy",
    version="1.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)


# ── Routes ──────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {"layer": "optimizer", "port": OPTIMIZER_PORT, "phase": 21}


@app.get("/health")
async def health():
    stats = _get_quick_stats()
    return {
        "status":           "ok",
        "layer":            "optimizer",
        "loop_interval_s":  LOOP_INTERVAL_S,
        "top_gaps":         TOP_GAPS_PER_CYCLE,
        "gap_min_score":    GAP_MIN_SCORE,
        "deploy_tiers":     sorted(DEPLOY_TIERS),
        "current_cycle":    _current_cycle_id,
        **stats,
    }


@app.get("/status")
async def get_status():
    stats = _get_quick_stats()
    return {
        "running":       _current_cycle_id is not None,
        "current_cycle": _current_cycle_id,
        "last_cycle":    _last_cycle_id,
        **stats,
    }


@app.post("/optimize")
async def trigger_optimize() -> TriggerResponse:
    """Déclenche manuellement un cycle d'optimisation."""
    if _current_cycle_id is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Cycle {_current_cycle_id} already running — please wait",
        )
    asyncio.create_task(_run_optimization_cycle())
    return TriggerResponse(
        cycle_id="pending",
        message="Optimization cycle triggered",
    )


@app.get("/cycles")
async def list_cycles(limit: int = Query(20, ge=1, le=100)):
    """Retourne les derniers cycles d'optimisation."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM cycles ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return {"cycles": [dict(r) for r in rows], "total": len(rows)}


@app.get("/cycles/{cycle_id}")
async def get_cycle(cycle_id: str):
    """Retourne un cycle et ses actions détaillées."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        cycle = conn.execute(
            "SELECT * FROM cycles WHERE id=?", (cycle_id,)
        ).fetchone()
        if not cycle:
            raise HTTPException(status_code=404, detail="Cycle not found")
        actions = conn.execute(
            "SELECT * FROM actions WHERE cycle_id=? ORDER BY created_at", (cycle_id,)
        ).fetchall()
    return {"cycle": dict(cycle), "actions": [dict(a) for a in actions]}


@app.get("/actions")
async def list_actions(
    limit:  int       = Query(50, ge=1, le=200),
    status: str | None = None,
):
    """Retourne les dernières actions d'optimisation."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        if status:
            rows = conn.execute(
                "SELECT * FROM actions WHERE status=? ORDER BY created_at DESC LIMIT ?",
                (status, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM actions ORDER BY created_at DESC LIMIT ?", (limit,)
            ).fetchall()
    return {"actions": [dict(r) for r in rows], "total": len(rows)}


@app.get("/stats")
async def get_stats():
    """Statistiques globales du moteur d'optimisation."""
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        c = conn.execute
        total_cycles   = c("SELECT COUNT(*) FROM cycles").fetchone()[0]
        done_cycles    = c("SELECT COUNT(*) FROM cycles WHERE status='done'").fetchone()[0]
        total_actions  = c("SELECT COUNT(*) FROM actions").fetchone()[0]
        deployed       = c("SELECT COUNT(*) FROM actions WHERE status='deployed'").fetchone()[0]
        quarantined    = c("SELECT COUNT(*) FROM actions WHERE status='quarantined'").fetchone()[0]
        gen_failed     = c("SELECT COUNT(*) FROM actions WHERE status='gen_failed'").fetchone()[0]
        skipped        = c("SELECT COUNT(*) FROM actions WHERE status='skipped'").fetchone()[0]
        avg_conf_row   = c(
            "SELECT AVG(confidence) FROM actions WHERE confidence IS NOT NULL"
        ).fetchone()[0]
        avg_conf = round(avg_conf_row or 0.0, 3)
    return {
        "cycles":          {"total": total_cycles, "done": done_cycles},
        "actions":         {
            "total": total_actions, "deployed": deployed,
            "quarantined": quarantined, "gen_failed": gen_failed, "skipped": skipped,
        },
        "avg_confidence":  avg_conf,
        "loop_interval_s": LOOP_INTERVAL_S,
        "gap_min_score":   GAP_MIN_SCORE,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.optimizer:app", host="0.0.0.0", port=OPTIMIZER_PORT, reload=False)
