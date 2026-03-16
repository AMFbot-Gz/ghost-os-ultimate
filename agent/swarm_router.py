"""
Couche swarm router — port 8013
Bee Specialization : 5 abeilles spécialisées + routage par domaine via Brain mission_type
Spécialistes : UIAgent · FileAgent · CodeAgent · WebAgent · SystemAgent
"""
import asyncio
import json
import sqlite3
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

# ─── Configuration ────────────────────────────────────────────────────────────

ROOT      = Path(__file__).resolve().parent.parent
DB_PATH   = ROOT / "agent" / "swarm.db"
BRAIN_URL = "http://localhost:8003"

# Mots-clés par domaine — scoring pour le routage automatique
DOMAIN_KW: dict[str, list[str]] = {
    "ui": [
        "screenshot", "écran", "click", "clique", "bouton", "interface", "fenêtre",
        "window", "affiche", "display", "ui", "ux", "design", "visuel", "pixel",
        "couleur", "color", "css", "html", "react", "composant", "component",
        "formulaire", "form", "input", "menu", "navbar", "icon", "image",
        "pyautogui", "playwright", "selenium", "puppeteer", "scrape visual",
    ],
    "file": [
        "fichier", "dossier", "répertoire", "directory", "file", "folder",
        "lire", "écrire", "copier", "déplacer", "supprimer", "read", "write",
        "copy", "move", "delete", "rename", "renommer", "csv", "json", "yaml",
        "xml", "txt", "pdf", "archive", "zip", "tar", "compress", "extract",
        "chemin", "path", "grep", "find", "search fichier", "contenu",
    ],
    "code": [
        "code", "script", "fonction", "function", "classe", "class", "module",
        "bug", "erreur", "error", "test", "debug", "refactor", "optimise",
        "python", "javascript", "typescript", "bash", "node", "npm", "pip",
        "import", "export", "compile", "run", "exécute", "programme", "program",
        "développe", "develop", "implement", "créer une fonction", "écrire un script",
        "lint", "format", "docstring", "commentaire", "annotation",
    ],
    "web": [
        "http", "https", "api", "url", "endpoint", "requête", "request",
        "curl", "fetch", "post", "get", "scrape", "download", "télécharge",
        "webhook", "rest", "graphql", "json api", "auth", "token", "cookie",
        "réseau", "network", "web", "site", "page", "navigateur", "browser",
        "header", "response", "status code", "redirect", "ssl", "certificate",
    ],
    "system": [
        "cpu", "ram", "mémoire", "memory", "disque", "disk", "processus",
        "process", "pid", "kill", "service", "daemon", "port", "réseau",
        "network", "log", "syslog", "monitor", "surveillance", "performance",
        "benchmark", "charge", "load", "uptime", "systemd", "pm2", "brew",
        "apt", "package", "installer", "update", "upgrade", "redémarre", "restart",
        "cron", "planifier", "schedule", "système", "system", "admin",
    ],
}

# Seuil de confiance minimum pour router vers un spécialiste (0-1)
CONFIDENCE_THRESHOLD = 0.15

# Infos des abeilles spécialisées
BEES: dict[str, dict] = {
    "ui":     {"name": "UIAgent",     "emoji": "🎨", "desc": "Interface, screenshots, GUI automation"},
    "file":   {"name": "FileAgent",   "emoji": "📁", "desc": "Fichiers, répertoires, transformation données"},
    "code":   {"name": "CodeAgent",   "emoji": "💻", "desc": "Code, debugging, tests, refactoring"},
    "web":    {"name": "WebAgent",    "emoji": "🌐", "desc": "HTTP, APIs REST, scraping, réseau"},
    "system": {"name": "SystemAgent", "emoji": "🖥️", "desc": "Processus, ressources, services système"},
}


# ─── SQLite ───────────────────────────────────────────────────────────────────

def _init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS routing_log (
                id          TEXT PRIMARY KEY,
                created_at  TEXT NOT NULL,
                mission     TEXT NOT NULL,
                domain      TEXT NOT NULL,
                confidence  REAL NOT NULL,
                bee_name    TEXT NOT NULL,
                duration_ms INTEGER,
                success     INTEGER DEFAULT 0,
                error       TEXT,
                result_preview TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS agent_stats (
                domain      TEXT PRIMARY KEY,
                routed_count    INTEGER DEFAULT 0,
                success_count   INTEGER DEFAULT 0,
                total_ms        INTEGER DEFAULT 0,
                last_used_at    TEXT
            )
        """)
        # Initialiser les stats pour chaque abeille
        for domain in BEES:
            conn.execute("""
                INSERT OR IGNORE INTO agent_stats (domain) VALUES (?)
            """, (domain,))
        conn.commit()


def _log_routing(entry: dict):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            INSERT OR REPLACE INTO routing_log
              (id, created_at, mission, domain, confidence, bee_name,
               duration_ms, success, error, result_preview)
            VALUES (:id, :created_at, :mission, :domain, :confidence, :bee_name,
                    :duration_ms, :success, :error, :result_preview)
        """, entry)
        conn.execute("""
            UPDATE agent_stats SET
                routed_count  = routed_count + 1,
                success_count = success_count + :success,
                total_ms      = total_ms + :duration_ms,
                last_used_at  = :created_at
            WHERE domain = :domain
        """, entry)
        conn.commit()


def _get_stats() -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute("""
            SELECT s.*, b.name bee_label
            FROM agent_stats s
        """).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            domain = d["domain"]
            total  = d["routed_count"] or 0
            succ   = d["success_count"] or 0
            ms     = d["total_ms"] or 0
            d["success_rate"] = round(succ / total, 3) if total > 0 else 0
            d["avg_ms"]       = round(ms / total) if total > 0 else 0
            d["bee_info"]     = BEES.get(domain, {})
            result.append(d)
        return result


def _get_routing_log(limit: int = 50) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM routing_log ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


# ─── Routage par scoring ──────────────────────────────────────────────────────

def _classify_domain(mission: str) -> tuple[str, float, dict[str, float]]:
    """
    Retourne (best_domain, confidence, all_scores).
    confidence = score_best / (score_total + ε) pour normalisation.
    """
    text  = mission.lower()
    words = set(text.split())
    scores: dict[str, float] = {}

    for domain, keywords in DOMAIN_KW.items():
        score = 0.0
        for kw in keywords:
            if " " in kw:
                # Phrase exacte
                if kw in text:
                    score += 2.0
            else:
                # Mot exact dans le set de mots
                if kw in words:
                    score += 1.0
                # Substring (partiel)
                elif any(kw in w for w in words):
                    score += 0.4
        scores[domain] = round(score, 3)

    total = sum(scores.values())
    if total == 0:
        return "code", 0.0, scores  # fallback général → CodeAgent

    best_domain = max(scores, key=lambda d: scores[d])
    confidence  = round(scores[best_domain] / (total + 1e-9), 3)
    return best_domain, confidence, scores


# ─── Dispatch vers Brain ──────────────────────────────────────────────────────

async def _dispatch(mission: str, domain: str, max_steps: int = 12) -> dict:
    """Envoie la mission à Brain /react avec mission_type = domain (charge le contexte spécialiste)."""
    async with httpx.AsyncClient(timeout=180) as c:
        r = await c.post(
            f"{BRAIN_URL}/react",
            json={
                "mission":      mission,
                "mission_type": domain,
                "max_steps":    max_steps,
            },
        )
        r.raise_for_status()
        return r.json()


# ─── FastAPI app ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    print("[SwarmRouter] 🐝 Ruche initialisée — 5 abeilles spécialisées")
    for domain, bee in BEES.items():
        print(f"  {bee['emoji']} {bee['name']} ({domain})")
    yield
    print("[SwarmRouter] 🛑 Arrêt swarm router")


app = FastAPI(title="Ghost OS SwarmRouter", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Modèles Pydantic ─────────────────────────────────────────────────────────

class DispatchReq(BaseModel):
    mission:    str
    domain:     Optional[str] = None   # forcer un domaine spécifique
    max_steps:  int = 12
    dry_run:    bool = False           # classifier sans exécuter


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/dispatch")
async def dispatch_mission(req: DispatchReq):
    """
    Route la mission vers l'abeille spécialisée la plus appropriée.
    Si domain est fourni, force ce spécialiste.
    Si dry_run=true, retourne seulement la classification sans exécuter.
    """
    t0 = time.time()
    routing_id = uuid.uuid4().hex[:8]

    # Classification
    if req.domain and req.domain in BEES:
        domain     = req.domain
        confidence = 1.0
        all_scores = {d: (1.0 if d == domain else 0.0) for d in BEES}
        forced     = True
    else:
        domain, confidence, all_scores = _classify_domain(req.mission)
        forced = False

    bee = BEES[domain]

    # Dry run — classification seule
    if req.dry_run:
        return {
            "routing_id":  routing_id,
            "domain":      domain,
            "bee":         bee,
            "confidence":  confidence,
            "all_scores":  all_scores,
            "forced":      forced,
            "dry_run":     True,
        }

    # Dispatch réel
    success = False
    error   = None
    result  = {}

    try:
        print(f"[SwarmRouter] 🐝 {bee['emoji']} {bee['name']} ← mission={req.mission[:60]!r} (conf={confidence:.2f})")
        result  = await _dispatch(req.mission, domain, req.max_steps)
        success = result.get("status") == "success"
    except Exception as e:
        error = str(e)[:300]
        print(f"[SwarmRouter] ❌ {bee['name']} erreur: {error}")

    duration_ms = int((time.time() - t0) * 1000)

    # Log SQLite
    log_entry = {
        "id":             routing_id,
        "created_at":     datetime.utcnow().isoformat(),
        "mission":        req.mission[:500],
        "domain":         domain,
        "confidence":     confidence,
        "bee_name":       bee["name"],
        "duration_ms":    duration_ms,
        "success":        int(success),
        "error":          error,
        "result_preview": (result.get("final_answer") or "")[:200],
    }
    try:
        _log_routing(log_entry)
    except Exception as e:
        print(f"[SwarmRouter] Log erreur: {e}")

    return {
        "routing_id":   routing_id,
        "domain":       domain,
        "bee":          bee,
        "confidence":   confidence,
        "all_scores":   all_scores,
        "forced":       forced,
        "duration_ms":  duration_ms,
        "success":      success,
        "error":        error,
        "result":       result,
    }


@app.get("/classify")
async def classify_mission(mission: str = Query(..., description="Texte de la mission à classifier")):
    """Classify sans exécuter — retourne le domaine + scores."""
    domain, confidence, all_scores = _classify_domain(mission)
    return {
        "domain":     domain,
        "bee":        BEES[domain],
        "confidence": confidence,
        "all_scores": all_scores,
        "routable":   confidence >= CONFIDENCE_THRESHOLD,
    }


@app.get("/bees")
async def list_bees():
    """Liste les abeilles spécialisées avec leurs stats en temps réel."""
    stats_rows = _get_stats()
    stats_map  = {r["domain"]: r for r in stats_rows}
    result = []
    for domain, bee in BEES.items():
        s = stats_map.get(domain, {})
        result.append({
            "domain":       domain,
            "name":         bee["name"],
            "emoji":        bee["emoji"],
            "desc":         bee["desc"],
            "context_file": f"support/domain-contexts/{domain}.md",
            "routed_count": s.get("routed_count", 0),
            "success_rate": s.get("success_rate", 0),
            "avg_ms":       s.get("avg_ms", 0),
            "last_used_at": s.get("last_used_at"),
        })
    return {"bees": result, "total": len(result)}


@app.get("/log")
async def routing_log(limit: int = Query(50, ge=1, le=200)):
    """Historique des routages avec décisions et résultats."""
    items = _get_routing_log(limit)
    return {"count": len(items), "items": items}


@app.get("/stats")
async def swarm_stats():
    """Statistiques globales du swarm : distribution par domaine, taux de succès, etc."""
    stats = _get_stats()
    total_routed  = sum(s["routed_count"] for s in stats)
    total_success = sum(s["success_count"] for s in stats)
    return {
        "total_routed":  total_routed,
        "total_success": total_success,
        "global_success_rate": round(total_success / (total_routed + 1e-9), 3),
        "by_domain":     stats,
        "bees_count":    len(BEES),
        "confidence_threshold": CONFIDENCE_THRESHOLD,
    }


@app.get("/health")
async def health():
    # Vérifier que Brain est accessible
    brain_ok = False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{BRAIN_URL}/health")
            brain_ok = r.status_code == 200
    except Exception:
        pass

    return {
        "status":     "ok",
        "layer":      "swarm_router",
        "bees":       list(BEES.keys()),
        "brain_ok":   brain_ok,
        "brain_url":  BRAIN_URL,
        "db_path":    str(DB_PATH),
        "confidence_threshold": CONFIDENCE_THRESHOLD,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.swarm_router:app", host="0.0.0.0", port=8013, reload=False)
