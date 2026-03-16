"""
agent/consciousness_bridge.py — Couche 16 : Consciousness Bridge  (Phase 19)
FastAPI :8016

Pont entre le NeuralEventBus (Node.js / core/consciousness/) et les 15 couches Python.

Rôles :
  1. Tail-follow agent/signals.jsonl  → diffuse les signaux phéromone en temps réel
  2. Health-check toutes les 30s des 15 couches Python (8001–8015)
  3. Maintient l'état de conscience (cycle, learning_mode, couches actives)
  4. WebSocket /ws — stream live d'événements vers le dashboard + UniversalConsciousness
  5. POST /emit — reçoit les heartbeats de UniversalConsciousness (Node.js → Python)

Endpoints :
  GET  /health          → état standard
  GET  /state           → état de conscience complet
  GET  /layers          → santé des 15 couches
  GET  /events?limit=N  → historique NeuralEventBus
  GET  /signals?limit=N → signaux phéromone récents
  GET  /stats           → métriques bus
  POST /emit            → injecter un événement depuis le Node.js
  WS   /ws              → stream temps réel
"""
from __future__ import annotations

import asyncio
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Config ────────────────────────────────────────────────────────────────────

ROOT         = Path(__file__).resolve().parent.parent
SIGNALS_FILE = Path(__file__).parent / "signals.jsonl"

HEALTH_INTERVAL_S  = 30       # polling santé des couches
SIGNAL_POLL_MS     = 500      # lecture signals.jsonl (500ms)
MAX_EVENTS         = 500      # historique bus en mémoire
MAX_SIGNALS        = 200      # signaux phéromone en mémoire

# 16 couches Python avec leurs ports
PYTHON_LAYERS: list[dict] = [
    {"name": "Queen",       "port": 8001, "emoji": "👑", "desc": "Orchestrateur + HITL + Telegram"},
    {"name": "Perception",  "port": 8002, "emoji": "👁️",  "desc": "Screenshots + scan système"},
    {"name": "Brain",       "port": 8003, "emoji": "🧠", "desc": "LLM routing Claude→Kimi→Ollama"},
    {"name": "Executor",    "port": 8004, "emoji": "⚙️",  "desc": "Shell sandboxé + PyAutoGUI"},
    {"name": "Evolution",   "port": 8005, "emoji": "🧬", "desc": "Auto-amélioration skills"},
    {"name": "Memory",      "port": 8006, "emoji": "💾", "desc": "Épisodes + world state"},
    {"name": "MCPBridge",   "port": 8007, "emoji": "🔌", "desc": "Proxy Python → MCP Node.js"},
    {"name": "Planner",     "port": 8008, "emoji": "🗺️",  "desc": "Planification HTN"},
    {"name": "Learner",     "port": 8009, "emoji": "🎓", "desc": "Skill learning épisodes"},
    {"name": "Goals",       "port": 8010, "emoji": "🏆", "desc": "Autonomous Goal Loop SQLite"},
    {"name": "Pipeline",    "port": 8011, "emoji": "🔗", "desc": "Skill Pipeline Composer"},
    {"name": "Miner",       "port": 8012, "emoji": "⛏",  "desc": "Behavior Mining Engine"},
    {"name": "SwarmRouter", "port": 8013, "emoji": "🐝", "desc": "Bee Specialization — 5 abeilles"},
    {"name": "Validator",   "port": 8014, "emoji": "🔬", "desc": "Skill Validator Loop"},
    {"name": "ComputerUse", "port": 8015, "emoji": "🖥️",  "desc": "Computer Use Master"},
    {"name": "Optimizer",   "port": 8017, "emoji": "⚡", "desc": "Self-Optimization Engine — Miner→Evolution→Validator"},
]

# ─── État de conscience partagé ────────────────────────────────────────────────

_STATE: dict = {
    "cycle":                0,
    "learning_mode":        "continuous",   # continuous | paused | offline
    "self_awareness":       False,
    "environmental_awareness": False,
    "goal_awareness":       False,
    "multimodal_integration": False,
    "consciousness_loop":   False,
    "started_at":           None,
    "last_heartbeat":       None,
    "active_goals":         [],
    "errors":               0,
}

# ─── Métriques NeuralEventBus ──────────────────────────────────────────────────

_METRICS: dict = {
    "impulses":          0,
    "total_latency_ms":  0.0,
    "errors":            0,
    "registered_events": 0,
}

# ─── Historiques en mémoire ────────────────────────────────────────────────────

_EVENTS:  list[dict] = []    # bus events (heartbeats + signaux elevés)
_SIGNALS: list[dict] = []    # signaux phéromone bruts depuis signals.jsonl
_LAYERS:  dict[str, dict] = {layer["name"]: {**layer, "ok": False, "latency_ms": 0, "checked_at": None}
                              for layer in PYTHON_LAYERS}

# ─── WebSocket clients ─────────────────────────────────────────────────────────

_WS_CLIENTS: list[WebSocket] = []

# ─── Tâches de fond ────────────────────────────────────────────────────────────

async def _broadcast(event: dict):
    """Diffuse un événement à tous les clients WebSocket connectés."""
    _METRICS["impulses"] += 1
    dead = []
    for ws in _WS_CLIENTS:
        try:
            await ws.send_text(json.dumps(event, ensure_ascii=False))
        except Exception:
            dead.append(ws)
    for ws in dead:
        _WS_CLIENTS.remove(ws)


def _push_event(event: dict):
    """Ajoute un événement à l'historique."""
    _EVENTS.append(event)
    if len(_EVENTS) > MAX_EVENTS:
        del _EVENTS[0]


def _push_signal(signal: dict):
    """Ajoute un signal phéromone à l'historique."""
    _SIGNALS.append(signal)
    if len(_SIGNALS) > MAX_SIGNALS:
        del _SIGNALS[0]


async def _tail_signals():
    """
    Tail-follow agent/signals.jsonl.
    Lit les nouvelles lignes toutes les 500ms et les diffuse via WebSocket.
    """
    file_pos = 0

    # Si le fichier existe déjà, sauter les lignes passées (on veut seulement le nouveau flux)
    if SIGNALS_FILE.exists():
        file_pos = SIGNALS_FILE.stat().st_size

    while True:
        await asyncio.sleep(SIGNAL_POLL_MS / 1000)
        try:
            if not SIGNALS_FILE.exists():
                continue
            current_size = SIGNALS_FILE.stat().st_size
            if current_size <= file_pos:
                continue

            with open(SIGNALS_FILE, "r", encoding="utf-8") as f:
                f.seek(file_pos)
                new_lines = f.read()
                file_pos  = f.tell()

            for line in new_lines.splitlines():
                line = line.strip()
                if not line:
                    continue
                try:
                    signal = json.loads(line)
                    _push_signal(signal)
                    event = {
                        "type":      "pheromone_signal",
                        "source":    "signals_bus",
                        "timestamp": datetime.utcnow().isoformat(),
                        "data":      signal,
                    }
                    _push_event(event)
                    await _broadcast(event)
                except json.JSONDecodeError:
                    pass
        except Exception as e:
            print(f"[ConsciousnessBridge] Signal tail error: {e}")


async def _poll_layers():
    """
    Sonde la santé des 15 couches Python toutes les 30s.
    Met à jour _LAYERS et diffuse un événement 'layers_health'.
    """
    async def _check(layer: dict):
        url = f"http://localhost:{layer['port']}/health"
        t0  = time.monotonic()
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                r = await client.get(url)
                latency = int((time.monotonic() - t0) * 1000)
                ok = r.status_code == 200
                try:
                    body = r.json()
                except Exception:
                    body = {}
                return layer["name"], ok, latency, body
        except Exception:
            latency = int((time.monotonic() - t0) * 1000)
            return layer["name"], False, latency, {}

    while True:
        tasks = [_check(layer) for layer in PYTHON_LAYERS]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        online_count = 0
        for res in results:
            if isinstance(res, Exception):
                continue
            name, ok, latency_ms, body = res
            _LAYERS[name]["ok"]         = ok
            _LAYERS[name]["latency_ms"] = latency_ms
            _LAYERS[name]["checked_at"] = datetime.utcnow().isoformat()
            _LAYERS[name]["body"]       = body
            if ok:
                online_count += 1

        # Met à jour l'état de conscience
        _STATE["environmental_awareness"] = online_count > 0
        _STATE["consciousness_loop"]      = True

        event = {
            "type":       "layers_health",
            "source":     "consciousness_bridge",
            "timestamp":  datetime.utcnow().isoformat(),
            "data": {
                "online_count":  online_count,
                "total_count":   len(PYTHON_LAYERS),
                "layers":        {n: {"ok": v["ok"], "latency_ms": v["latency_ms"]}
                                  for n, v in _LAYERS.items()},
            },
        }
        _push_event(event)
        await _broadcast(event)
        print(f"[ConsciousnessBridge] 🔭 Layers poll: {online_count}/{len(PYTHON_LAYERS)} online")

        await asyncio.sleep(HEALTH_INTERVAL_S)


async def _heartbeat_loop():
    """
    Émet un heartbeat conscience toutes les 30s (aligné sur UniversalConsciousness).
    """
    await asyncio.sleep(5)  # attend que les couches soient prêtes
    _STATE["started_at"]         = datetime.utcnow().isoformat()
    _STATE["self_awareness"]     = True
    _STATE["consciousness_loop"] = True

    while True:
        _STATE["cycle"] += 1
        _STATE["last_heartbeat"] = datetime.utcnow().isoformat()

        online = sum(1 for v in _LAYERS.values() if v["ok"])
        event  = {
            "type":      "consciousness.heartbeat",
            "source":    "consciousness_bridge",
            "timestamp": datetime.utcnow().isoformat(),
            "data": {
                "cycle":          _STATE["cycle"],
                "state":          {k: v for k, v in _STATE.items()},
                "online_layers":  online,
                "total_layers":   len(PYTHON_LAYERS),
                "metrics":        dict(_METRICS),
            },
        }
        _push_event(event)
        await _broadcast(event)

        await asyncio.sleep(HEALTH_INTERVAL_S)


# ─── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    print("[ConsciousnessBridge] 🧠 Consciousness Bridge actif — port 8016")
    print(f"  Signals file : {SIGNALS_FILE}")
    print(f"  Layers       : {len(PYTHON_LAYERS)} couches Python (8001–8017)")
    print(f"  Health poll  : toutes les {HEALTH_INTERVAL_S}s")
    print(f"  Signal poll  : toutes les {SIGNAL_POLL_MS}ms")

    # Lance les tâches de fond
    asyncio.create_task(_tail_signals())
    asyncio.create_task(_poll_layers())
    asyncio.create_task(_heartbeat_loop())

    yield
    print("[ConsciousnessBridge] 🛑 Arrêt")


# ─── FastAPI ───────────────────────────────────────────────────────────────────

app = FastAPI(title="Ghost OS Consciousness Bridge", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001", "*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Modèles ──────────────────────────────────────────────────────────────────

class EmitReq(BaseModel):
    type:      str
    source:    str = "external"
    data:      dict = {}
    timestamp: Optional[str] = None


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    online = sum(1 for v in _LAYERS.values() if v["ok"])
    return {
        "status":        "ok",
        "layer":         "consciousness_bridge",
        "cycle":         _STATE["cycle"],
        "learning_mode": _STATE["learning_mode"],
        "online_layers": online,
        "total_layers":  len(PYTHON_LAYERS),
        "impulses":      _METRICS["impulses"],
        "ws_clients":    len(_WS_CLIENTS),
    }


@app.get("/state")
async def get_state():
    online = sum(1 for v in _LAYERS.values() if v["ok"])
    return {
        **_STATE,
        "online_layers":  online,
        "total_layers":   len(PYTHON_LAYERS),
        "ws_clients":     len(_WS_CLIENTS),
        "metrics":        dict(_METRICS),
    }


@app.get("/layers")
async def get_layers():
    return {
        "layers": [
            {
                "name":       v["name"],
                "port":       v["port"],
                "emoji":      v["emoji"],
                "desc":       v["desc"],
                "ok":         v["ok"],
                "latency_ms": v["latency_ms"],
                "checked_at": v["checked_at"],
            }
            for v in _LAYERS.values()
        ],
        "online_count": sum(1 for v in _LAYERS.values() if v["ok"]),
        "total_count":  len(PYTHON_LAYERS),
    }


@app.get("/events")
async def get_events(limit: int = Query(50, ge=1, le=500)):
    return {"events": _EVENTS[-limit:][::-1], "total": len(_EVENTS)}


@app.get("/signals")
async def get_signals(limit: int = Query(50, ge=1, le=200)):
    return {"signals": _SIGNALS[-limit:][::-1], "total": len(_SIGNALS)}


@app.get("/stats")
async def get_stats():
    avg_latency = (_METRICS["total_latency_ms"] / max(_METRICS["impulses"], 1))
    online = sum(1 for v in _LAYERS.values() if v["ok"])
    return {
        **_METRICS,
        "avg_latency_ms":   round(avg_latency, 2),
        "registered_events": len(set(e["type"] for e in _EVENTS)),
        "online_layers":    online,
        "total_layers":     len(PYTHON_LAYERS),
        "signals_buffered": len(_SIGNALS),
        "events_buffered":  len(_EVENTS),
        "ws_clients":       len(_WS_CLIENTS),
        "state":            _STATE,
    }


@app.post("/emit")
async def emit_event(req: EmitReq):
    """
    Injecte un événement externe dans le bus (depuis UniversalConsciousness Node.js).
    """
    t0 = time.monotonic()
    event = {
        "id":        uuid.uuid4().hex[:8],
        "type":      req.type,
        "source":    req.source,
        "timestamp": req.timestamp or datetime.utcnow().isoformat(),
        "data":      req.data,
    }

    # Met à jour l'état de conscience si c'est un heartbeat
    if req.type == "consciousness.heartbeat":
        d = req.data
        _STATE["cycle"]                    = d.get("cycle", _STATE["cycle"])
        _STATE["learning_mode"]            = d.get("state", {}).get("learning_mode", _STATE["learning_mode"])
        _STATE["self_awareness"]           = d.get("state", {}).get("self_awareness", _STATE["self_awareness"])
        _STATE["environmental_awareness"]  = d.get("state", {}).get("environmental_awareness", True)
        _STATE["goal_awareness"]           = d.get("state", {}).get("goal_awareness", _STATE["goal_awareness"])
        _STATE["last_heartbeat"]           = event["timestamp"]
        _STATE["active_goals"]             = d.get("goals_status", _STATE["active_goals"])

    elif req.type == "self.aware":
        _STATE["self_awareness"] = True

    elif req.type == "modalities.integrated":
        _STATE["multimodal_integration"] = True

    elif req.type == "goals.established":
        _STATE["goal_awareness"] = True
        _STATE["active_goals"]   = req.data if isinstance(req.data, list) else []

    _push_event(event)
    await _broadcast(event)

    latency_ms = (time.monotonic() - t0) * 1000
    _METRICS["total_latency_ms"] += latency_ms
    _METRICS["impulses"]         += 1

    return {"ok": True, "id": event["id"], "latency_ms": round(latency_ms, 2)}


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    """
    WebSocket temps réel — stream de tous les événements bus.
    Envoie d'abord un snapshot de l'état, puis tous les nouveaux événements.
    """
    await ws.accept()
    _WS_CLIENTS.append(ws)
    print(f"[ConsciousnessBridge] 🔌 WS client connecté ({len(_WS_CLIENTS)} total)")

    try:
        # Snapshot initial
        snapshot = {
            "type":      "snapshot",
            "source":    "consciousness_bridge",
            "timestamp": datetime.utcnow().isoformat(),
            "data": {
                "state":   _STATE,
                "layers":  {n: {"ok": v["ok"], "latency_ms": v["latency_ms"]}
                            for n, v in _LAYERS.items()},
                "metrics": dict(_METRICS),
                "recent_events":  _EVENTS[-20:],
                "recent_signals": _SIGNALS[-20:],
            },
        }
        await ws.send_text(json.dumps(snapshot, ensure_ascii=False))

        # Maintien de la connexion
        while True:
            try:
                # ping/pong toutes les 10s pour détecter les déconnexions
                await asyncio.wait_for(ws.receive_text(), timeout=10.0)
            except asyncio.TimeoutError:
                pass   # normal — pas de message client
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[ConsciousnessBridge] WS error: {e}")
    finally:
        if ws in _WS_CLIENTS:
            _WS_CLIENTS.remove(ws)
        print(f"[ConsciousnessBridge] 🔌 WS client déconnecté ({len(_WS_CLIENTS)} restant)")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.consciousness_bridge:app", host="0.0.0.0", port=8016, reload=False)
