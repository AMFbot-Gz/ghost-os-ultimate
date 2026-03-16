"""
agent/computer_use.py — Couche 15 : Computer Use Master Session  (Phase 18)
FastAPI :8015

Session GUI complète avec boucle See → Plan → Act → Verify :
  1. Observe   — screencapture + analyse moondream (description textuelle)
  2. Plan      — Brain /raw décide l'action suivante (format structuré)
  3. Act       — exécute via Executor :8004 (click/type/key/scroll/shell)
  4. Verify    — screenshot post-action + détection changement (hash SHA-256)
  5. Loop      — répète jusqu'à done ou max_steps

Actions disponibles dans la boucle :
  screenshot              — capture + description moondream
  click X Y               — clic PyAutoGUI à (X, Y)
  click_element "desc"    — moondream localise l'élément, puis clic
  type "texte"            — frappe texte (pyperclip→paste pour les accents)
  key "combo"             — touche/raccourci (return, escape, cmd+c, tab…)
  scroll "up|down" N      — défilement (N × 100px)
  open_app "NomApp"       — ouvre une application macOS
  shell "cmd"             — commande shell sandboxée via Executor
  wait N                  — pause N millisecondes (max 5000)
  done "résultat"         — termine la session avec succès
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import os
import sqlite3
import subprocess
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ─── Config ────────────────────────────────────────────────────────────────────

ROOT           = Path(__file__).resolve().parent.parent
DB_FILE        = Path(__file__).parent / "computer_use.db"
SCREENSHOTS_DIR = Path("/tmp/ghost_cu")

PERCEPTION_URL = "http://localhost:8002"
EXECUTOR_URL   = "http://localhost:8004"
BRAIN_URL      = "http://localhost:8003"
OLLAMA_URL     = os.getenv("OLLAMA_HOST", "http://localhost:11434")
VISION_MODEL   = "moondream"

MAX_STEPS_DEFAULT = 20
MAX_STEPS_LIMIT   = 40
STEP_TIMEOUT      = 60    # secondes par étape
WAIT_MAX_MS       = 5000  # sécurité wait()

# Sessions en cours (in-memory)
_SESSIONS: dict[str, dict] = {}
_SESSIONS_LOCK = asyncio.Lock()

# ─── SQLite ─────────────────────────────────────────────────────────────────────

def _init_db():
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id           TEXT PRIMARY KEY,
                created_at   TEXT NOT NULL,
                goal         TEXT NOT NULL,
                status       TEXT NOT NULL DEFAULT 'pending',
                steps_count  INTEGER DEFAULT 0,
                duration_ms  INTEGER,
                final_result TEXT,
                error        TEXT,
                max_steps    INTEGER DEFAULT 20
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS steps (
                id            TEXT PRIMARY KEY,
                session_id    TEXT NOT NULL,
                step_num      INTEGER NOT NULL,
                action_type   TEXT NOT NULL,
                action_input  TEXT,
                thought       TEXT,
                observation   TEXT,
                screen_hash   TEXT,
                screen_changed INTEGER DEFAULT 0,
                success       INTEGER DEFAULT 1,
                duration_ms   INTEGER,
                created_at    TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        conn.commit()


def _upsert_session(s: dict):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            INSERT OR REPLACE INTO sessions
              (id, created_at, goal, status, steps_count, duration_ms, final_result, error, max_steps)
            VALUES (:id, :created_at, :goal, :status, :steps_count, :duration_ms,
                    :final_result, :error, :max_steps)
        """, s)
        conn.commit()


def _insert_step(step: dict):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            INSERT OR REPLACE INTO steps
              (id, session_id, step_num, action_type, action_input, thought,
               observation, screen_hash, screen_changed, success, duration_ms, created_at)
            VALUES (:id, :session_id, :step_num, :action_type, :action_input, :thought,
                    :observation, :screen_hash, :screen_changed, :success, :duration_ms, :created_at)
        """, step)
        conn.commit()


def _get_sessions(limit: int = 30) -> list[dict]:
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM sessions ORDER BY created_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def _get_steps(session_id: str) -> list[dict]:
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM steps WHERE session_id=? ORDER BY step_num ASC", (session_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def _get_stats() -> dict:
    with sqlite3.connect(DB_FILE) as conn:
        r = conn.execute("""
            SELECT COUNT(*) total,
                   SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) succeeded,
                   SUM(CASE WHEN status='failed'  THEN 1 ELSE 0 END) failed,
                   SUM(CASE WHEN status='stopped' THEN 1 ELSE 0 END) stopped,
                   AVG(steps_count) avg_steps,
                   AVG(duration_ms) avg_ms
            FROM sessions
        """).fetchone()
        total, succ, fail, stop, avg_steps, avg_ms = r
        total = total or 0
        succ  = succ  or 0
        return {
            "total":       total,
            "succeeded":   succ,
            "failed":      fail or 0,
            "stopped":     stop or 0,
            "success_rate": round(succ / (total + 1e-9), 3),
            "avg_steps":   round(avg_steps or 0, 1),
            "avg_ms":      round(avg_ms or 0),
            "active":      sum(1 for s in _SESSIONS.values() if s["status"] == "running"),
        }


# ─── Vision (moondream via Ollama) ─────────────────────────────────────────────

async def _screenshot_and_describe(label: str = "") -> dict:
    """Prend un screenshot et le décrit avec moondream. Retourne {path, hash, changed, description}."""
    try:
        # Screenshot via Perception
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{PERCEPTION_URL}/screenshot")
            r.raise_for_status()
            sc = r.json()
    except Exception as e:
        return {"path": None, "hash": None, "changed": False, "description": f"[screenshot error: {e}]", "error": str(e)}

    path   = sc.get("path")
    h      = sc.get("hash", "")
    changed = sc.get("changed", False)

    # Description moondream
    description = ""
    if path and Path(path).exists():
        try:
            img_b64 = base64.b64encode(Path(path).read_bytes()).decode()
            prompt  = (
                "Décris précisément ce que tu vois sur cet écran macOS. "
                "Indique : les fenêtres ouvertes, le titre des apps, les boutons visibles, "
                "les champs de texte, les menus, le contenu principal. "
                "Sois concis mais complet (max 200 mots)."
            )
            async with httpx.AsyncClient(timeout=30) as c:
                r = await c.post(
                    f"{OLLAMA_URL}/api/generate",
                    json={"model": VISION_MODEL, "prompt": prompt,
                          "images": [img_b64], "stream": False},
                )
                if r.status_code == 200:
                    description = r.json().get("response", "").strip()
                else:
                    description = f"[moondream HTTP {r.status_code}]"
        except Exception as e:
            description = f"[vision error: {e}]"

    return {"path": path, "hash": h, "changed": changed, "description": description or "[écran capturé]"}


# ─── Parsing de la réponse LLM ─────────────────────────────────────────────────

def _parse_action(raw: str) -> dict:
    """
    Extrait Thought + Action + Input d'une réponse LLM structurée.
    Format attendu :
      Thought: …
      Action: screenshot | click X Y | type "…" | key "…" | scroll up/down N
              | open_app "…" | shell "…" | wait N | done "…" | click_element "…"
      Input: … (optionnel si l'action est self-contained)
    """
    thought      = ""
    action_type  = "screenshot"
    action_input = ""

    lines = raw.strip().splitlines()
    for line in lines:
        l = line.strip()
        if l.lower().startswith("thought:"):
            thought = l[8:].strip()
        elif l.lower().startswith("action:"):
            raw_action = l[7:].strip()
            # Parse action_type + action_input depuis la ligne Action
            parts = raw_action.split(None, 1)
            action_type  = parts[0].lower() if parts else "screenshot"
            action_input = parts[1].strip().strip('"').strip("'") if len(parts) > 1 else ""
        elif l.lower().startswith("input:"):
            if not action_input:
                action_input = l[6:].strip().strip('"').strip("'")

    # Cas spéciaux avec coordonnées : click 450 300
    if action_type == "click" and action_input:
        # action_input peut être "450 300" ou "450, 300"
        pass  # on garde as-is, _execute_action parsera les coordonnées

    return {"thought": thought, "action_type": action_type, "action_input": action_input}


# ─── Exécution d'une action ────────────────────────────────────────────────────

async def _execute_action(action_type: str, action_input: str, session_id: str) -> dict:
    """
    Exécute une action GUI et retourne {ok, output, error}.
    Toutes les actions GUI passent par Executor :8004 (qui a le lock PyAutoGUI).
    """
    try:
        async with httpx.AsyncClient(timeout=STEP_TIMEOUT) as c:

            if action_type == "screenshot":
                result = await _screenshot_and_describe(label=action_input)
                return {"ok": True, "output": result.get("description", ""), "screen": result}

            elif action_type == "click":
                # Coordonnées : "450 300" ou "450, 300" ou "x=450 y=300"
                coords = action_input.replace(",", " ").replace("=", " ").split()
                nums   = [c for c in coords if c.lstrip("-").isdigit()]
                if len(nums) < 2:
                    return {"ok": False, "output": f"Coordonnées invalides : '{action_input}' — format : click X Y"}
                x, y = int(nums[0]), int(nums[1])
                r = await c.post(f"{EXECUTOR_URL}/click", json={"x": x, "y": y, "description": f"CU click ({x},{y})"})
                r.raise_for_status()
                return {"ok": True, "output": f"Clic à ({x}, {y}) effectué"}

            elif action_type == "click_element":
                # Demande à moondream de localiser l'élément sur le screenshot courant
                sc = await _screenshot_and_describe(label="localiser " + action_input)
                desc = sc.get("description", "")
                # Demande au LLM de donner les coordonnées
                r = await c.post(f"{BRAIN_URL}/raw", json={
                    "role": "worker",
                    "system": (
                        "Tu reçois une description d'écran macOS et un élément à localiser. "
                        "Réponds UNIQUEMENT avec deux entiers : X Y (coordonnées pixel). "
                        "Exemple : 450 300. Ne donne rien d'autre."
                    ),
                    "prompt": f"Description de l'écran:\n{desc}\n\nTrouve l'élément: {action_input}\nRéponds avec les coordonnées X Y :",
                })
                r.raise_for_status()
                coords_raw = r.json().get("content", "").strip().split()
                nums = [t for t in coords_raw if t.lstrip("-").isdigit()]
                if len(nums) < 2:
                    return {"ok": False, "output": f"Impossible de localiser '{action_input}' — LLM: {coords_raw}"}
                x, y = int(nums[0]), int(nums[1])
                cr = await c.post(f"{EXECUTOR_URL}/click", json={"x": x, "y": y, "description": action_input})
                cr.raise_for_status()
                return {"ok": True, "output": f"Élément '{action_input}' cliqué à ({x}, {y})"}

            elif action_type == "type":
                r = await c.post(f"{EXECUTOR_URL}/type", json={"text": action_input, "interval": 0.04})
                r.raise_for_status()
                return {"ok": True, "output": f"Texte saisi ({len(action_input)} chars)"}

            elif action_type == "key":
                # Utilise shell osascript pour les raccourcis complexes
                combo = action_input.lower().strip()
                # Mapping raccourcis → pyautogui hotkey
                _pipe_parts = combo.split("|")
                key_cmd = f'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.hotkey(*{json.dumps(_pipe_parts)})"'
                if "+" in combo:
                    parts  = combo.split("+")
                    key_cmd = f'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.hotkey(*{json.dumps(parts)})"'
                elif combo in ("return", "enter"):
                    key_cmd = 'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.press(\'return\')"'
                elif combo in ("escape", "esc"):
                    key_cmd = 'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.press(\'escape\')"'
                elif combo == "tab":
                    key_cmd = 'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.press(\'tab\')"'
                else:
                    key_cmd = f'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.press({json.dumps(combo)})"'
                r = await c.post(f"{EXECUTOR_URL}/shell", json={"command": key_cmd})
                r.raise_for_status()
                return {"ok": True, "output": f"Touche '{action_input}' pressée"}

            elif action_type == "scroll":
                parts     = action_input.split()
                direction = parts[0].lower() if parts else "down"
                amount    = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 3
                dy        = -amount * 100 if direction == "down" else amount * 100
                scroll_cmd = f'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.scroll({dy})"'
                r = await c.post(f"{EXECUTOR_URL}/shell", json={"command": scroll_cmd})
                r.raise_for_status()
                return {"ok": True, "output": f"Scroll {direction} × {amount}"}

            elif action_type == "open_app":
                app_name = action_input.strip('"').strip("'")
                r = await c.post(f"{EXECUTOR_URL}/shell",
                                  json={"command": f'open -a "{app_name}"'})
                r.raise_for_status()
                await asyncio.sleep(1.5)  # laisser l'app s'ouvrir
                return {"ok": True, "output": f"Application '{app_name}' ouverte"}

            elif action_type == "shell":
                r = await c.post(f"{EXECUTOR_URL}/shell", json={"command": action_input})
                r.raise_for_status()
                out = r.json()
                if out.get("blocked"):
                    return {"ok": False, "output": f"Commande bloquée (sécurité) : {action_input[:60]}"}
                stdout = (out.get("stdout") or "")[:500]
                stderr = (out.get("stderr") or "")[:200]
                return {"ok": True, "output": stdout or "(pas de sortie)", "stderr": stderr}

            elif action_type == "wait":
                ms = min(int(action_input) if str(action_input).isdigit() else 1000, WAIT_MAX_MS)
                await asyncio.sleep(ms / 1000)
                return {"ok": True, "output": f"Attente {ms}ms"}

            elif action_type == "done":
                return {"ok": True, "output": action_input or "Mission accomplie", "done": True}

            else:
                return {"ok": False, "output": f"Action inconnue '{action_type}' — utilise : screenshot|click X Y|click_element|type|key|scroll|open_app|shell|wait|done"}

    except httpx.TimeoutException:
        return {"ok": False, "output": f"[TIMEOUT {STEP_TIMEOUT}s] Service ne répond pas pour '{action_type}'"}
    except Exception as e:
        return {"ok": False, "output": f"[ERREUR] {type(e).__name__}: {str(e)[:200]}"}


# ─── Boucle principale Computer Use ────────────────────────────────────────────

_CU_SYSTEM_PROMPT = """Tu es un agent de Computer Use pour macOS. Tu contrôles l'interface graphique.

Actions disponibles :
  screenshot                  — capture + description de l'écran
  click X Y                   — clic à la position (X, Y) en pixels
  click_element "description" — trouve un élément par sa description et clique dessus
  type "texte"                — frappe du texte dans le champ actif
  key "combo"                 — presse une touche (return, escape, tab, cmd+c, cmd+v, cmd+a…)
  scroll "up|down" N          — défile N fois (ex: scroll down 3)
  open_app "NomApp"           — ouvre une application macOS
  shell "commande"            — exécute une commande shell
  wait N                      — attends N millisecondes (max 5000)
  done "résultat"             — termine avec un résumé du résultat

Format de réponse OBLIGATOIRE à chaque étape :
  Thought: [analyse l'état actuel, ce qui a changé, ce qu'il reste à faire]
  Action: [nom_action paramètre1 paramètre2]

Règles :
- Commence TOUJOURS par screenshot pour voir l'état initial
- Après chaque action importante, prends un screenshot pour vérifier
- Si un élément n'est pas visible, scroll avant de chercher
- Si une action échoue, essaie une approche différente
- Quand le but est atteint, utilise done avec un résumé clair
- Sois précis avec les coordonnées (pixels réels macOS)
"""


async def _run_session(session_id: str):
    """Boucle principale asynchrone d'une session Computer Use."""
    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
        if not session:
            return

    goal      = session["goal"]
    max_steps = session["max_steps"]
    steps_log = []
    t_start   = time.time()
    prev_hash = ""

    print(f"[CU] 🖥️  Session {session_id} démarrée — goal: {goal[:60]!r}")

    # Mise à jour statut
    session["status"] = "running"
    _upsert_session({
        "id": session_id, "created_at": session["created_at"],
        "goal": goal, "status": "running", "steps_count": 0,
        "duration_ms": 0, "final_result": None, "error": None,
        "max_steps": max_steps,
    })

    # Historique de conversation pour le LLM
    messages = [{"role": "user", "content": f"But de la session : {goal}\n\nCommence par prendre un screenshot pour voir l'état de l'écran."}]
    final_result = None
    error        = None
    status       = "failed"

    try:
        for step_num in range(1, max_steps + 1):
            # Vérification arrêt manuel
            async with _SESSIONS_LOCK:
                if _SESSIONS.get(session_id, {}).get("stop_requested"):
                    status = "stopped"
                    print(f"[CU] 🛑 Session {session_id} arrêtée manuellement (étape {step_num})")
                    break

            step_t = time.time()
            step_id = uuid.uuid4().hex[:8]
            print(f"[CU]   Étape {step_num}/{max_steps}")

            # ── LLM décide l'action ──────────────────────────────────────────────
            try:
                async with httpx.AsyncClient(timeout=45) as c:
                    r = await c.post(f"{BRAIN_URL}/raw", json={
                        "role": "worker",
                        "system": _CU_SYSTEM_PROMPT,
                        "messages": messages,
                    })
                    r.raise_for_status()
                    llm_raw = r.json().get("content", "").strip()
            except Exception as e:
                error  = f"LLM inaccessible à l'étape {step_num}: {e}"
                status = "failed"
                break

            parsed       = _parse_action(llm_raw)
            thought      = parsed["thought"]
            action_type  = parsed["action_type"]
            action_input = parsed["action_input"]

            print(f"[CU]   → {action_type}: {action_input[:60]!r}  ({thought[:60]})")

            # ── Exécution ────────────────────────────────────────────────────────
            exec_result = await _execute_action(action_type, action_input, session_id)
            observation = exec_result.get("output", "")
            step_ok     = exec_result.get("ok", False)

            # Screenshot post-action (sauf si l'action était déjà un screenshot)
            screen_hash    = ""
            screen_changed = False
            if action_type not in ("screenshot",) and step_ok:
                try:
                    async with httpx.AsyncClient(timeout=10) as c:
                        r = await c.post(f"{PERCEPTION_URL}/screenshot")
                        if r.status_code == 200:
                            sc = r.json()
                            screen_hash    = sc.get("hash", "")
                            screen_changed = sc.get("changed", False)
                            if screen_changed:
                                observation += f" | Écran modifié ✓ (hash: {screen_hash[:8]})"
                            else:
                                observation += " | Écran inchangé"
                except Exception:
                    pass

            if action_type == "screenshot" and "screen" in exec_result:
                sc_info = exec_result["screen"]
                screen_hash    = sc_info.get("hash", "")
                screen_changed = sc_info.get("changed", False)

            # ── Log step ─────────────────────────────────────────────────────────
            step_entry = {
                "id":            step_id,
                "session_id":    session_id,
                "step_num":      step_num,
                "action_type":   action_type,
                "action_input":  action_input,
                "thought":       thought,
                "observation":   observation,
                "screen_hash":   screen_hash,
                "screen_changed": int(screen_changed),
                "success":       int(step_ok),
                "duration_ms":   int((time.time() - step_t) * 1000),
                "created_at":    datetime.utcnow().isoformat(),
            }
            _insert_step(step_entry)
            steps_log.append(step_entry)

            # Mise à jour session live
            async with _SESSIONS_LOCK:
                session["steps"] = steps_log
                session["steps_count"] = step_num

            # Mise à jour LLM history
            messages.append({"role": "assistant", "content": llm_raw})
            obs_msg = f"Observation: {observation}"
            if not step_ok:
                obs_msg += f"\n⚠️ L'action a échoué. Essaie une approche différente."
            messages.append({"role": "user", "content": obs_msg})

            # ── Vérification done ────────────────────────────────────────────────
            if action_type == "done" or exec_result.get("done"):
                final_result = action_input or observation
                status       = "success"
                print(f"[CU] ✅ Session {session_id} terminée : {final_result[:80]}")
                break

        else:
            # max_steps atteint
            status = "failed"
            error  = f"Max steps ({max_steps}) atteint sans 'done'"
            print(f"[CU] ⚠️  Session {session_id} : max steps atteint")

    except Exception as e:
        status = "failed"
        error  = f"Exception: {type(e).__name__}: {str(e)[:300]}"
        print(f"[CU] ❌ Session {session_id} erreur: {e}")

    # ── Finalisation ──────────────────────────────────────────────────────────
    duration_ms = int((time.time() - t_start) * 1000)
    final_row = {
        "id":           session_id,
        "created_at":   session["created_at"],
        "goal":         goal,
        "status":       status,
        "steps_count":  len(steps_log),
        "duration_ms":  duration_ms,
        "final_result": final_result,
        "error":        error,
        "max_steps":    max_steps,
    }
    _upsert_session(final_row)

    async with _SESSIONS_LOCK:
        if session_id in _SESSIONS:
            _SESSIONS[session_id].update({
                "status":       status,
                "duration_ms":  duration_ms,
                "final_result": final_result,
                "error":        error,
            })


# ─── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    print("[ComputerUse] 🖥️  Computer Use Master actif — port 8015")
    print(f"  Vision model : {VISION_MODEL} via {OLLAMA_URL}")
    print(f"  Max steps    : {MAX_STEPS_DEFAULT} (limit: {MAX_STEPS_LIMIT})")
    print(f"  Screenshots  : {SCREENSHOTS_DIR}")
    yield
    print("[ComputerUse] 🛑 Arrêt computer use")


app = FastAPI(title="Ghost OS ComputerUse", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Modèles ──────────────────────────────────────────────────────────────────

class StartReq(BaseModel):
    goal:      str
    max_steps: int = MAX_STEPS_DEFAULT


class ScreenshotReq(BaseModel):
    label: str = ""


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/session/start")
async def start_session(req: StartReq):
    """Démarre une nouvelle session Computer Use en arrière-plan."""
    if not req.goal.strip():
        raise HTTPException(400, "goal ne peut pas être vide")
    max_steps = min(max(1, req.max_steps), MAX_STEPS_LIMIT)

    session_id = uuid.uuid4().hex[:10]
    now = datetime.utcnow().isoformat()

    session = {
        "id":           session_id,
        "created_at":   now,
        "goal":         req.goal,
        "status":       "pending",
        "steps":        [],
        "steps_count":  0,
        "max_steps":    max_steps,
        "final_result": None,
        "error":        None,
        "stop_requested": False,
    }

    async with _SESSIONS_LOCK:
        _SESSIONS[session_id] = session

    _upsert_session({
        "id": session_id, "created_at": now, "goal": req.goal,
        "status": "pending", "steps_count": 0, "duration_ms": 0,
        "final_result": None, "error": None, "max_steps": max_steps,
    })

    # Lance la boucle en tâche background
    asyncio.create_task(_run_session(session_id))

    return {"session_id": session_id, "goal": req.goal, "max_steps": max_steps, "status": "pending"}


@app.get("/session/{session_id}")
async def get_session(session_id: str):
    """État en temps réel d'une session (steps inclus)."""
    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)

    if session:
        return {**session, "steps": session.get("steps", [])}

    # Chercher dans SQLite (sessions terminées)
    with sqlite3.connect(DB_FILE) as conn:
        conn.row_factory = sqlite3.Row
        row = conn.execute("SELECT * FROM sessions WHERE id=?", (session_id,)).fetchone()
        if not row:
            raise HTTPException(404, f"Session '{session_id}' introuvable")
        result = dict(row)
        result["steps"] = _get_steps(session_id)
        return result


@app.post("/session/{session_id}/stop")
async def stop_session(session_id: str):
    """Arrête une session en cours proprement."""
    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
        if not session:
            raise HTTPException(404, "Session introuvable ou déjà terminée")
        if session["status"] != "running":
            return {"ok": False, "message": f"Session non active (status={session['status']})"}
        session["stop_requested"] = True

    return {"ok": True, "session_id": session_id, "message": "Arrêt demandé — s'applique à la prochaine étape"}


@app.post("/screenshot")
async def quick_screenshot(req: ScreenshotReq = ScreenshotReq()):
    """Screenshot rapide avec description moondream — hors session."""
    result = await _screenshot_and_describe(label=req.label)
    # Lire l'image pour l'encoder en base64 (affichage dashboard)
    b64 = ""
    if result.get("path") and Path(result["path"]).exists():
        try:
            b64 = base64.b64encode(Path(result["path"]).read_bytes()).decode()
        except Exception:
            pass
    return {**result, "base64": b64}


@app.get("/sessions")
async def list_sessions(limit: int = Query(20, ge=1, le=100)):
    """Historique des sessions (SQLite + actives en mémoire)."""
    db_sessions = _get_sessions(limit)
    # Fusionner avec sessions actives en mémoire
    active_ids = set()
    async with _SESSIONS_LOCK:
        active = [
            {k: v for k, v in s.items() if k != "steps"}
            for s in _SESSIONS.values()
        ]
        active_ids = {s["id"] for s in active}

    # Dédupliquer
    merged = list(active)
    for s in db_sessions:
        if s["id"] not in active_ids:
            merged.append(s)
    merged.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"sessions": merged[:limit], "total": len(merged)}


@app.get("/stats")
async def stats():
    return _get_stats()


@app.get("/health")
async def health():
    # Vérifier Perception + Executor
    perc_ok = exec_ok = brain_ok = False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            p, e, b = await asyncio.gather(
                c.get(f"{PERCEPTION_URL}/health"),
                c.get(f"{EXECUTOR_URL}/health"),
                c.get(f"{BRAIN_URL}/health"),
                return_exceptions=True,
            )
            perc_ok  = not isinstance(p, Exception) and p.status_code == 200
            exec_ok  = not isinstance(e, Exception) and e.status_code == 200
            brain_ok = not isinstance(b, Exception) and b.status_code == 200
    except Exception:
        pass

    active = sum(1 for s in _SESSIONS.values() if s.get("status") == "running")
    return {
        "status":       "ok",
        "layer":        "computer_use",
        "active_sessions": active,
        "perception_ok": perc_ok,
        "executor_ok":   exec_ok,
        "brain_ok":      brain_ok,
        "vision_model":  VISION_MODEL,
        "max_steps":     MAX_STEPS_DEFAULT,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("agent.computer_use:app", host="0.0.0.0", port=8015, reload=False)
