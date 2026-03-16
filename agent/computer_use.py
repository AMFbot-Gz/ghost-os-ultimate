"""
agent/computer_use.py — Couche 15 : Computer Use Master (Phase 18 — Ultra)
FastAPI :8015

Auto-sélection au démarrage :
  MODE ULTRA  (si ANTHROPIC_API_KEY présent) :
    → Claude native Computer Use API (computer_20250124)
    → Zéro moondream — Claude voit l'écran directement
    → Boucle Claude → action → screenshot → Claude, ~2–5s/étape

  MODE LOCAL  (fallback sans clé Anthropic) :
    → Moondream + Brain Ollama (existant, conservé)
    → Moins précis mais 100% local

Auto-calibration au démarrage :
    → Détecte résolution + facteur Retina (2x sur MacBook Pro)
    → Screenshots downscalés à résolution logique avant envoi Claude
    → Profil machine sauvé dans .laruche/machine_profile.json
    → Coordonnées PyAutoGUI = coordonnées logiques (1536×960) ✅
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

# Chargement .env automatique (priorité : variables déjà définies dans l'env)
try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env", override=False)
except ImportError:
    pass

# ─── Config ────────────────────────────────────────────────────────────────────

ROOT            = Path(__file__).resolve().parent.parent
DB_FILE         = Path(__file__).parent / "computer_use.db"
SCREENSHOTS_DIR = Path("/tmp/ghost_cu")
PROFILE_FILE    = ROOT / ".laruche" / "machine_profile.json"

PERCEPTION_URL = "http://localhost:8002"
EXECUTOR_URL   = "http://localhost:8004"
BRAIN_URL      = "http://localhost:8003"
OLLAMA_URL     = os.getenv("OLLAMA_HOST", "http://localhost:11434")

ANTHROPIC_API_KEY  = os.getenv("ANTHROPIC_API_KEY", "")
ANTHROPIC_ENABLED  = os.getenv("ANTHROPIC_ENABLED", "true").lower() == "true"
# Modèle CU : sonnet est recommandé pour la précision, opus pour les missions complexes
CU_MODEL           = os.getenv("CU_MODEL", "claude-opus-4-6")
VISION_MODEL       = os.getenv("OLLAMA_MODEL_VISION", "moondream:latest")

MAX_STEPS_DEFAULT  = 20
MAX_STEPS_LIMIT    = 40
STEP_TIMEOUT       = 90   # secondes par étape (Retina screenshot + LLM)
WAIT_MAX_MS        = 5000

# ─── Profil display (auto-détecté au démarrage) ────────────────────────────────

_DISPLAY: dict = {
    "logical_width": 1536,
    "logical_height": 960,
    "scale_factor": 1.0,
    "is_retina": False,
    "mode": "local",  # "anthropic" | "local"
}

# Sessions en cours (in-memory)
_SESSIONS: dict[str, dict] = {}
_SESSIONS_LOCK = asyncio.Lock()


# ─── Auto-calibration display ─────────────────────────────────────────────────

def _detect_display() -> dict:
    """
    Détecte résolution logique, facteur Retina, et choisit le mode CU.
    Compatible macOS (AppKit), Linux (xrandr), Windows (ctypes).
    """
    import platform

    # Résolution logique via pyautogui (cross-platform)
    try:
        import pyautogui
        w, h = pyautogui.size()
    except Exception:
        w, h = 1920, 1080

    # Facteur d'échelle Retina (macOS uniquement)
    scale = 1.0
    if platform.system() == "Darwin":
        try:
            r = subprocess.run(
                ["python3", "-c",
                 "import AppKit; print(AppKit.NSScreen.mainScreen().backingScaleFactor())"],
                capture_output=True, text=True, timeout=5,
            )
            scale = float(r.stdout.strip()) if r.stdout.strip() else 1.0
        except Exception:
            # Fallback : comparer screenshot physique vs pyautogui
            try:
                tmp = "/tmp/ghost_scale_test.png"
                subprocess.run(["screencapture", "-x", tmp], capture_output=True, timeout=5)
                from PIL import Image
                img = Image.open(tmp)
                pw, ph = img.size
                scale = round(pw / w, 1) if w > 0 else 1.0
            except Exception:
                scale = 1.0

    # Vérification accessibilité macOS
    accessibility_ok = False
    if platform.system() == "Darwin":
        try:
            r = subprocess.run(
                ["osascript", "-e",
                 'tell application "System Events" to get name of first process whose frontmost is true'],
                capture_output=True, text=True, timeout=5,
            )
            accessibility_ok = r.returncode == 0
        except Exception:
            pass

    # Mode auto : Anthropic CU si clé disponible
    mode = "anthropic" if (ANTHROPIC_API_KEY and ANTHROPIC_ENABLED) else "local"

    return {
        "logical_width": w,
        "logical_height": h,
        "scale_factor": scale,
        "is_retina": scale >= 2.0,
        "platform": platform.system(),
        "accessibility_ok": accessibility_ok,
        "mode": mode,
        "cu_model": CU_MODEL if mode == "anthropic" else VISION_MODEL,
    }


# ─── Screenshot Retina-corrigé ─────────────────────────────────────────────────

async def _screenshot_cu() -> tuple[bytes, str]:
    """
    Screenshot en résolution LOGIQUE (corrige Retina 2×→1×).
    PyAutoGUI et Anthropic CU utilisent les mêmes coordonnées logiques.
    Retourne (png_bytes, sha256_hash).
    """
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    path = SCREENSHOTS_DIR / f"cu_{uuid.uuid4().hex[:8]}.png"

    # screencapture : retourne physique (3072×1920 sur MacBook Retina)
    proc = await asyncio.create_subprocess_exec(
        "screencapture", "-x", "-t", "png", str(path),
        stderr=asyncio.subprocess.PIPE,
    )
    await asyncio.wait_for(proc.wait(), timeout=8)

    # Downscale si Retina pour aligner avec coordonnées logiques
    if _DISPLAY.get("is_retina"):
        try:
            from PIL import Image
            img = Image.open(path)
            lw = _DISPLAY["logical_width"]
            lh = _DISPLAY["logical_height"]
            if img.size != (lw, lh):
                img = img.resize((lw, lh), Image.LANCZOS)
                img.save(str(path), "PNG", optimize=False)
        except Exception as e:
            print(f"[CU] ⚠️  Retina downscale failed: {e}")

    data = path.read_bytes()
    h = hashlib.sha256(data).hexdigest()[:16]
    return data, h


# ─── Conversion touches Anthropic → PyAutoGUI ──────────────────────────────────

_KEY_MAP = {
    "Return": "return", "Enter": "return",
    "Escape": "escape", "Tab": "tab",
    "BackSpace": "backspace", "Delete": "delete",
    "ArrowUp": "up", "ArrowDown": "down", "ArrowLeft": "left", "ArrowRight": "right",
    "Home": "home", "End": "end", "PageUp": "pageup", "PageDown": "pagedown",
    "F1": "f1", "F2": "f2", "F3": "f3", "F4": "f4", "F5": "f5",
    "F6": "f6", "F7": "f7", "F8": "f8", "F9": "f9", "F10": "f10",
    "F11": "f11", "F12": "f12",
    "space": "space", " ": "space",
    "ctrl": "ctrl", "control": "ctrl",
    "alt": "alt", "option": "alt",
    "shift": "shift",
    "cmd": "command", "super": "command", "meta": "command",  # macOS
    "win": "command",
}

def _parse_key(key_str: str) -> list[str]:
    """
    Convertit "ctrl+c", "cmd+shift+Return", "ArrowUp" → liste pyautogui.
    Anthropic envoie des combinaisons séparées par "+" ou "-".
    """
    # Séparer par + ou - (sauf si c'est le tiret tout seul)
    sep = "+" if "+" in key_str else ("-" if key_str.count("-") > 0 and len(key_str) > 1 else None)
    if sep:
        parts = [p.strip() for p in key_str.split(sep) if p.strip()]
    else:
        parts = [key_str.strip()]

    return [_KEY_MAP.get(p, p.lower()) for p in parts]


# ─── Exécution d'actions Anthropic CU ─────────────────────────────────────────

async def _execute_cu_action_native(action: dict) -> list[dict]:
    """
    Exécute une action retournée par Claude Computer Use.
    Retourne le contenu tool_result (image pour screenshot, texte sinon).
    """
    import pyautogui
    pyautogui.FAILSAFE = True

    action_type = action.get("action", "")

    try:
        if action_type == "screenshot":
            data, _ = await _screenshot_cu()
            b64 = base64.standard_b64encode(data).decode("utf-8")
            return [{"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": b64}}]

        elif action_type in ("left_click", "right_click", "middle_click", "double_click"):
            coord = action.get("coordinate", [0, 0])
            x, y = int(coord[0]), int(coord[1])
            if action_type == "double_click":
                pyautogui.doubleClick(x, y)
            elif action_type == "right_click":
                pyautogui.rightClick(x, y)
            elif action_type == "middle_click":
                pyautogui.middleClick(x, y)
            else:
                pyautogui.click(x, y)
            await asyncio.sleep(0.05)
            return [{"type": "text", "text": f"✓ {action_type} à ({x}, {y})"}]

        elif action_type == "mouse_move":
            coord = action.get("coordinate", [0, 0])
            x, y = int(coord[0]), int(coord[1])
            pyautogui.moveTo(x, y, duration=0.15)
            return [{"type": "text", "text": f"✓ Curseur → ({x}, {y})"}]

        elif action_type == "left_click_drag":
            src = action.get("start_coordinate", [0, 0])
            dst = action.get("coordinate", [0, 0])
            pyautogui.mouseDown(int(src[0]), int(src[1]), button="left")
            await asyncio.sleep(0.1)
            pyautogui.mouseUp(int(dst[0]), int(dst[1]), button="left")
            return [{"type": "text", "text": f"✓ Drag {src} → {dst}"}]

        elif action_type == "type":
            text = action.get("text", "")
            # pyperclip + paste pour accents et caractères spéciaux
            try:
                import pyperclip
                pyperclip.copy(text)
                pyautogui.hotkey("command", "v")
            except Exception:
                pyautogui.write(text, interval=0.02)
            await asyncio.sleep(0.05)
            return [{"type": "text", "text": f"✓ Texte saisi: {text[:60]!r}"}]

        elif action_type == "key":
            key_str = action.get("text", "")
            keys = _parse_key(key_str)
            if len(keys) == 1:
                pyautogui.press(keys[0])
            else:
                pyautogui.hotkey(*keys)
            await asyncio.sleep(0.05)
            return [{"type": "text", "text": f"✓ Touche: {key_str}"}]

        elif action_type == "scroll":
            coord = action.get("coordinate", [0, 0])
            direction = action.get("direction", "down")
            amount = int(action.get("amount", 3))
            x, y = int(coord[0]), int(coord[1])
            dy = amount if direction == "up" else -amount
            pyautogui.scroll(dy, x=x, y=y)
            await asyncio.sleep(0.05)
            return [{"type": "text", "text": f"✓ Scroll {direction} ×{amount} à ({x},{y})"}]

        elif action_type == "cursor_position":
            x, y = pyautogui.position()
            return [{"type": "text", "text": f"Curseur à ({x}, {y})"}]

        else:
            return [{"type": "text", "text": f"⚠️ Action inconnue: {action_type}"}]

    except Exception as e:
        return [{"type": "text", "text": f"❌ Erreur {action_type}: {type(e).__name__}: {e}"}]


# ─── Boucle Claude Vision (MODE ULTRA) ────────────────────────────────────────
# Claude voit le screenshot directement et retourne une action JSON.
# Compatible avec tous les modèles Anthropic (pas besoin du beta CU API).

_CU_VISION_SYSTEM = """\
Tu es un agent de Computer Use expert pour macOS.
Tu reçois un screenshot de l'écran ({W}x{H} pixels logiques, coin haut-gauche = 0,0).
Tu dois retourner UNE seule action JSON pour progresser vers le but.

FORMAT DE RÉPONSE — STRICTEMENT JSON (pas de texte avant ou après) :
{{
  "thought": "ce que je vois, ce que je dois faire",
  "action": "screenshot|click|double_click|right_click|type|key|scroll|open_app|shell|wait|done",
  "x": 450,
  "y": 300,
  "text": "texte à taper ou combinaison de touche",
  "direction": "up|down|left|right",
  "amount": 3,
  "command": "commande shell",
  "app": "nom app macOS",
  "ms": 500,
  "result": "résumé final si action=done"
}}

Champs selon l'action :
- click/double_click/right_click : x, y obligatoires
- type : text obligatoire
- key : text obligatoire (ex: "return", "escape", "tab", "cmd+c", "cmd+v", "cmd+a", "cmd+z")
- scroll : x, y, direction, amount
- open_app : app
- shell : command
- wait : ms (max 3000)
- screenshot : aucun champ requis (prends un screenshot)
- done : result

Règles :
- Commence par screenshot pour voir l'état initial
- Clique PRÉCISÉMENT sur les bons éléments (utilise les coordonnées exactes du screenshot)
- Sur macOS : cmd+c=copier, cmd+v=coller, cmd+q=quitter, cmd+w=fermer, cmd+tab=switch app
- Retourne UNIQUEMENT du JSON valide, rien d'autre
- Dès que le but est atteint (commande exécutée, fichier créé, action effectuée), retourne immédiatement action=done
- N'effectue PAS de vérifications supplémentaires après avoir exécuté l'action demandée — fais confiance à tes actions
"""

def _parse_vision_action(raw: str) -> dict:
    """Parse la réponse JSON de Claude Vision. Robuste aux balises markdown."""
    raw = raw.strip()
    # Extraire le JSON depuis ```json ... ``` si présent
    if "```" in raw:
        for line in raw.split("```"):
            line = line.strip().lstrip("json").strip()
            if line.startswith("{"):
                raw = line
                break
    # Trouver le premier objet JSON
    start = raw.find("{")
    end   = raw.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(raw[start:end])
        except json.JSONDecodeError:
            pass
    # Fallback : screenshot
    return {"action": "screenshot", "thought": f"Parse error: {raw[:100]}"}


async def _run_anthropic_cu_session(session_id: str):
    """
    Boucle Computer Use via Claude Vision.
    À chaque étape : screenshot → Claude voit l'écran → action → exécute → répète.
    Fonctionne avec tous les modèles Anthropic (opus-4-6, sonnet-4-6, etc.)
    """
    try:
        import anthropic as _anthropic
    except ImportError:
        print("[CU] ❌ anthropic SDK non installé — fallback local")
        await _run_local_session(session_id)
        return

    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
        if not session:
            return

    goal      = session["goal"]
    max_steps = session["max_steps"]
    steps_log = []
    t_start   = time.time()

    session["status"] = "running"
    _upsert_session({
        "id": session_id, "created_at": session["created_at"],
        "goal": goal, "status": "running", "steps_count": 0,
        "duration_ms": 0, "final_result": None, "error": None,
        "max_steps": max_steps,
    })

    client = _anthropic.AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    W = _DISPLAY["logical_width"]
    H = _DISPLAY["logical_height"]
    system_prompt = _CU_VISION_SYSTEM.replace("{W}", str(W)).replace("{H}", str(H))

    # Historique conversation : (screenshot + goal) → action → observation → screenshot …
    history: list[dict] = []
    final_result = None
    error        = None
    status       = "failed"
    last_screenshot_b64 = None

    print(f"[CU] 🚀 Session ULTRA {session_id} — Claude Vision {CU_MODEL} | {W}×{H} | goal: {goal[:60]!r}")

    try:
        for step_num in range(1, max_steps + 1):
            async with _SESSIONS_LOCK:
                if _SESSIONS.get(session_id, {}).get("stop_requested"):
                    status = "stopped"
                    break

            step_t  = time.time()
            step_id = uuid.uuid4().hex[:8]
            print(f"[CU]   Étape {step_num}/{max_steps}")

            # ── Screenshot courant ─────────────────────────────────────────────
            try:
                sc_data, sc_hash = await _screenshot_cu()
                last_screenshot_b64 = base64.standard_b64encode(sc_data).decode("utf-8")
            except Exception as e:
                error  = f"Screenshot échoué: {e}"
                status = "failed"
                break

            # ── Construire le message pour Claude ─────────────────────────────
            user_content: list[dict] = [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/png",
                               "data": last_screenshot_b64},
                },
                {
                    "type": "text",
                    "text": (
                        f"But : {goal}\n"
                        f"Étape {step_num}/{max_steps}. "
                        f"Écran actuel ci-dessus ({W}×{H} px). "
                        + (
                            "⚠️ DERNIÈRES ÉTAPES — si le but est déjà atteint, retourne action=done MAINTENANT. "
                            if step_num >= max_steps - 2 else ""
                        )
                        + "Quelle action effectuer ? Réponds en JSON uniquement."
                    ),
                },
            ]
            messages_call = history + [{"role": "user", "content": user_content}]

            # ── Appel Claude Vision ────────────────────────────────────────────
            try:
                response = await client.messages.create(
                    model=CU_MODEL,
                    max_tokens=1024,
                    system=system_prompt,
                    messages=messages_call,
                )
                llm_raw = response.content[0].text if response.content else "{}"
            except Exception as e:
                error  = f"Claude Vision API: {e}"
                status = "failed"
                print(f"[CU] ❌ {error}")
                break

            # ── Parse action ───────────────────────────────────────────────────
            parsed      = _parse_vision_action(llm_raw)
            action_type = parsed.get("action", "screenshot")
            thought     = parsed.get("thought", "")
            print(f"[CU]   → {action_type}: {thought[:80]}")

            # ── Exécuter l'action ──────────────────────────────────────────────
            if action_type == "done":
                final_result = parsed.get("result", "Mission accomplie")
                status = "success"
                print(f"[CU] ✅ {session_id} — {final_result[:80]}")
                step_entry = {
                    "id": step_id, "session_id": session_id, "step_num": step_num,
                    "action_type": "done", "action_input": final_result,
                    "thought": thought, "observation": final_result,
                    "screen_hash": sc_hash, "screen_changed": 0, "success": 1,
                    "duration_ms": int((time.time() - step_t) * 1000),
                    "created_at": datetime.utcnow().isoformat(),
                }
                _insert_step(step_entry)
                steps_log.append(step_entry)
                break

            elif action_type == "screenshot":
                observation = f"Screenshot pris ({W}×{H})"
                step_ok = True

            else:
                # Toutes les autres actions via _execute_local_action
                action_input = ""
                if action_type in ("click", "double_click", "right_click"):
                    x = parsed.get("x", 0); y = parsed.get("y", 0)
                    action_input = f"{x} {y}"
                    if action_type == "double_click":
                        action_input = f"{x} {y}"
                        # Exécuter double_click via pyautogui directement
                        try:
                            import pyautogui; pyautogui.doubleClick(x, y); await asyncio.sleep(0.1)
                            observation = f"Double-clic à ({x},{y})"; step_ok = True
                        except Exception as e:
                            observation = f"Erreur: {e}"; step_ok = False
                        action_type = "double_click"
                    elif action_type == "right_click":
                        try:
                            import pyautogui; pyautogui.rightClick(x, y); await asyncio.sleep(0.1)
                            observation = f"Clic droit à ({x},{y})"; step_ok = True
                        except Exception as e:
                            observation = f"Erreur: {e}"; step_ok = False
                    else:
                        action_type = "click"
                elif action_type == "type":
                    action_input = parsed.get("text", "")
                elif action_type == "key":
                    action_input = parsed.get("text", "")
                elif action_type == "scroll":
                    x = parsed.get("x", W // 2); y = parsed.get("y", H // 2)
                    direction = parsed.get("direction", "down")
                    amount = parsed.get("amount", 3)
                    action_input = f"{direction} {amount}"
                    action_type = "scroll"
                elif action_type == "open_app":
                    action_input = parsed.get("app", "")
                elif action_type == "shell":
                    action_input = parsed.get("command", "")
                elif action_type == "wait":
                    action_input = str(min(parsed.get("ms", 500), 3000))

                if action_type not in ("double_click", "right_click"):
                    exec_result = await _execute_local_action(action_type, action_input)
                    observation = exec_result.get("output", "")
                    step_ok     = exec_result.get("ok", False)
                    if exec_result.get("done"):
                        final_result = action_input or observation
                        status = "success"

            # ── Log step ─────────────────────────────────────────────────────
            step_entry = {
                "id": step_id, "session_id": session_id, "step_num": step_num,
                "action_type": action_type,
                "action_input": str(parsed.get("x", parsed.get("text", parsed.get("command", "")))),
                "thought": thought, "observation": observation,
                "screen_hash": sc_hash, "screen_changed": 0,
                "success": int(step_ok) if "step_ok" in dir() else 1,
                "duration_ms": int((time.time() - step_t) * 1000),
                "created_at": datetime.utcnow().isoformat(),
            }
            _insert_step(step_entry)
            steps_log.append(step_entry)

            # Mise à jour session live
            async with _SESSIONS_LOCK:
                session["steps"] = steps_log
                session["steps_count"] = step_num

            # Ajouter au historique (sans les images pour économiser tokens)
            history.append({"role": "user", "content": [
                {"type": "text",
                 "text": f"Étape {step_num}: Goal={goal} | Screen={W}×{H}"},
            ]})
            history.append({"role": "assistant", "content": [
                {"type": "text", "text": llm_raw},
            ]})
            history.append({"role": "user", "content": [
                {"type": "text",
                 "text": f"Observation: {observation}"},
            ]})

            if status == "success":
                break

            # Limiter l'historique à 6 derniers échanges (évite les tokens)
            if len(history) > 18:
                history = history[-18:]

        else:
            status = "failed"
            error  = f"Max steps ({max_steps}) atteint"
            print(f"[CU] ⚠️  {session_id}: max steps")

    except asyncio.CancelledError:
        status = "stopped"
    except Exception as e:
        status = "failed"
        error  = f"{type(e).__name__}: {str(e)[:300]}"
        print(f"[CU] ❌ {session_id}: {e}")

    duration_ms = int((time.time() - t_start) * 1000)
    _upsert_session({
        "id": session_id, "created_at": session["created_at"],
        "goal": goal, "status": status, "steps_count": len(steps_log),
        "duration_ms": duration_ms, "final_result": final_result,
        "error": error, "max_steps": max_steps,
    })
    async with _SESSIONS_LOCK:
        if session_id in _SESSIONS:
            _SESSIONS[session_id].update({"status": status, "duration_ms": duration_ms,
                                          "final_result": final_result, "error": error})


# ─── Boucle locale (MODE FALLBACK) ────────────────────────────────────────────

_CU_SYSTEM_PROMPT_LOCAL = """Tu es un agent de Computer Use pour macOS. Tu contrôles l'interface graphique.

Actions disponibles :
  screenshot                  — capture + description de l'écran
  click X Y                   — clic à la position (X, Y) en pixels logiques
  click_element "description" — trouve un élément par sa description et clique dessus
  type "texte"                — frappe du texte dans le champ actif
  key "combo"                 — presse une touche (return, escape, tab, cmd+c, cmd+v…)
  scroll "up|down" N          — défile N fois
  open_app "NomApp"           — ouvre une application macOS
  shell "commande"            — exécute une commande shell
  wait N                      — attends N millisecondes (max 5000)
  done "résultat"             — termine avec un résumé du résultat

Format de réponse OBLIGATOIRE :
  Thought: [analyse l'état actuel]
  Action: [nom_action paramètre]

Règles :
- Commence TOUJOURS par screenshot
- Après chaque action importante, prends un screenshot de vérification
- Les coordonnées click sont en pixels logiques (1536×960 sur MacBook Retina)
- Quand le but est atteint, utilise done
"""


async def _screenshot_and_describe(label: str = "") -> dict:
    """Screenshot + description moondream (mode local)."""
    try:
        async with httpx.AsyncClient(timeout=15) as c:
            r = await c.post(f"{PERCEPTION_URL}/screenshot")
            r.raise_for_status()
            sc = r.json()
    except Exception as e:
        return {"path": None, "hash": None, "changed": False,
                "description": f"[screenshot error: {e}]", "error": str(e)}

    path    = sc.get("path")
    h       = sc.get("hash", "")
    changed = sc.get("changed", False)
    description = ""

    if path and Path(path).exists():
        # Si Retina : downscaler avant moondream pour coords cohérentes
        try:
            if _DISPLAY.get("is_retina"):
                from PIL import Image
                img = Image.open(path)
                lw, lh = _DISPLAY["logical_width"], _DISPLAY["logical_height"]
                if img.size != (lw, lh):
                    img = img.resize((lw, lh), Image.LANCZOS)
                    img.save(path)
        except Exception:
            pass

        try:
            img_b64 = base64.b64encode(Path(path).read_bytes()).decode()
            prompt  = (
                "Décris précisément ce que tu vois sur cet écran macOS. "
                "Indique : les fenêtres ouvertes, le titre des apps, les boutons visibles, "
                "les champs de texte, les menus, le contenu principal. "
                f"Résolution d'affichage : {_DISPLAY['logical_width']}×{_DISPLAY['logical_height']} pixels. "
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

    return {"path": path, "hash": h, "changed": changed,
            "description": description or "[écran capturé]"}


def _parse_action(raw: str) -> dict:
    thought = ""; action_type = "screenshot"; action_input = ""
    for line in raw.strip().splitlines():
        l = line.strip()
        if l.lower().startswith("thought:"):
            thought = l[8:].strip()
        elif l.lower().startswith("action:"):
            raw_action = l[7:].strip()
            parts = raw_action.split(None, 1)
            action_type  = parts[0].lower() if parts else "screenshot"
            action_input = parts[1].strip().strip('"').strip("'") if len(parts) > 1 else ""
        elif l.lower().startswith("input:") and not action_input:
            action_input = l[6:].strip().strip('"').strip("'")
    return {"thought": thought, "action_type": action_type, "action_input": action_input}


async def _execute_local_action(action_type: str, action_input: str) -> dict:
    """Exécute une action GUI via Executor :8004 (mode local)."""
    try:
        async with httpx.AsyncClient(timeout=STEP_TIMEOUT) as c:

            if action_type == "screenshot":
                result = await _screenshot_and_describe(label=action_input)
                return {"ok": True, "output": result.get("description", ""), "screen": result}

            elif action_type == "click":
                coords = action_input.replace(",", " ").replace("=", " ").split()
                nums = [x for x in coords if x.lstrip("-").isdigit()]
                if len(nums) < 2:
                    return {"ok": False, "output": f"Coordonnées invalides: '{action_input}'"}
                x, y = int(nums[0]), int(nums[1])
                r = await c.post(f"{EXECUTOR_URL}/click", json={"x": x, "y": y, "description": f"CU click"})
                r.raise_for_status()
                return {"ok": True, "output": f"Clic à ({x}, {y})"}

            elif action_type == "click_element":
                sc = await _screenshot_and_describe(label="localiser " + action_input)
                desc = sc.get("description", "")
                r = await c.post(f"{BRAIN_URL}/raw", json={
                    "role": "worker",
                    "system": (f"Résolution écran: {_DISPLAY['logical_width']}×{_DISPLAY['logical_height']}. "
                               "Tu reçois une description d'écran macOS et un élément à localiser. "
                               "Réponds UNIQUEMENT avec deux entiers : X Y (coordonnées pixel logiques). "
                               "Exemple : 450 300"),
                    "prompt": f"Description:\n{desc}\n\nTrouve: {action_input}\nCoordonnées X Y :",
                })
                r.raise_for_status()
                coords_raw = r.json().get("content", "").strip().split()
                nums = [t for t in coords_raw if t.lstrip("-").isdigit()]
                if len(nums) < 2:
                    return {"ok": False, "output": f"Impossible de localiser '{action_input}'"}
                x, y = int(nums[0]), int(nums[1])
                cr = await c.post(f"{EXECUTOR_URL}/click", json={"x": x, "y": y, "description": action_input})
                cr.raise_for_status()
                return {"ok": True, "output": f"'{action_input}' cliqué à ({x}, {y})"}

            elif action_type == "type":
                r = await c.post(f"{EXECUTOR_URL}/type", json={"text": action_input, "interval": 0.04})
                r.raise_for_status()
                return {"ok": True, "output": f"Texte saisi ({len(action_input)} chars)"}

            elif action_type == "key":
                keys = _parse_key(action_input)
                key_cmd = f'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.hotkey(*{json.dumps(keys)})"'
                r = await c.post(f"{EXECUTOR_URL}/shell", json={"command": key_cmd})
                r.raise_for_status()
                return {"ok": True, "output": f"Touche '{action_input}' pressée"}

            elif action_type == "scroll":
                parts = action_input.split()
                direction = parts[0].lower() if parts else "down"
                amount = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 3
                dy = -amount * 100 if direction == "down" else amount * 100
                scroll_cmd = f'python3 -c "import pyautogui; pyautogui.FAILSAFE=True; pyautogui.scroll({dy})"'
                r = await c.post(f"{EXECUTOR_URL}/shell", json={"command": scroll_cmd})
                r.raise_for_status()
                return {"ok": True, "output": f"Scroll {direction} × {amount}"}

            elif action_type == "open_app":
                r = await c.post(f"{EXECUTOR_URL}/shell", json={"command": f'open -a "{action_input}"'})
                r.raise_for_status()
                await asyncio.sleep(1.5)
                return {"ok": True, "output": f"App '{action_input}' ouverte"}

            elif action_type == "shell":
                r = await c.post(f"{EXECUTOR_URL}/shell", json={"command": action_input})
                r.raise_for_status()
                out = r.json()
                if out.get("blocked"):
                    return {"ok": False, "output": f"Commande bloquée: {action_input[:60]}"}
                return {"ok": True, "output": (out.get("stdout") or "")[:500]}

            elif action_type == "wait":
                ms = min(int(action_input) if str(action_input).isdigit() else 1000, WAIT_MAX_MS)
                await asyncio.sleep(ms / 1000)
                return {"ok": True, "output": f"Attente {ms}ms"}

            elif action_type == "done":
                return {"ok": True, "output": action_input or "Mission accomplie", "done": True}

            else:
                return {"ok": False, "output": f"Action inconnue '{action_type}'"}

    except httpx.TimeoutException:
        return {"ok": False, "output": f"[TIMEOUT {STEP_TIMEOUT}s] '{action_type}'"}
    except Exception as e:
        return {"ok": False, "output": f"[ERREUR] {type(e).__name__}: {str(e)[:200]}"}


async def _run_local_session(session_id: str):
    """Boucle locale moondream + Brain (fallback)."""
    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
        if not session:
            return

    goal = session["goal"]; max_steps = session["max_steps"]
    steps_log = []; t_start = time.time()
    session["status"] = "running"
    _upsert_session({
        "id": session_id, "created_at": session["created_at"],
        "goal": goal, "status": "running", "steps_count": 0,
        "duration_ms": 0, "final_result": None, "error": None, "max_steps": max_steps,
    })

    messages = [{"role": "user", "content": f"But: {goal}\n\nCommence par prendre un screenshot."}]
    final_result = None; error = None; status = "failed"

    print(f"[CU] 🔵 Session LOCAL {session_id} | {_DISPLAY['logical_width']}×{_DISPLAY['logical_height']} | goal: {goal[:60]!r}")

    try:
        for step_num in range(1, max_steps + 1):
            async with _SESSIONS_LOCK:
                if _SESSIONS.get(session_id, {}).get("stop_requested"):
                    status = "stopped"; break

            step_t = time.time(); step_id = uuid.uuid4().hex[:8]
            print(f"[CU]   Étape {step_num}/{max_steps} (LOCAL)")

            try:
                async with httpx.AsyncClient(timeout=45) as c:
                    r = await c.post(f"{BRAIN_URL}/raw", json={
                        "role": "worker", "system": _CU_SYSTEM_PROMPT_LOCAL, "messages": messages,
                    })
                    r.raise_for_status()
                    llm_raw = r.json().get("content", "").strip()
            except Exception as e:
                error = f"LLM inaccessible: {e}"; status = "failed"; break

            parsed = _parse_action(llm_raw)
            thought = parsed["thought"]; action_type = parsed["action_type"]; action_input = parsed["action_input"]
            print(f"[CU]   → {action_type}: {action_input[:60]!r}")

            exec_result = await _execute_local_action(action_type, action_input)
            observation = exec_result.get("output", "")
            step_ok     = exec_result.get("ok", False)

            # Screenshot hash post-action
            screen_hash = ""; screen_changed = False
            if action_type not in ("screenshot",) and step_ok:
                try:
                    async with httpx.AsyncClient(timeout=8) as c:
                        r = await c.post(f"{PERCEPTION_URL}/screenshot")
                        if r.status_code == 200:
                            sc = r.json()
                            screen_hash = sc.get("hash", "")
                            screen_changed = sc.get("changed", False)
                            observation += " | " + ("Écran modifié ✓" if screen_changed else "Écran inchangé")
                except Exception:
                    pass

            step_entry = {
                "id": step_id, "session_id": session_id, "step_num": step_num,
                "action_type": action_type, "action_input": action_input, "thought": thought,
                "observation": observation, "screen_hash": screen_hash,
                "screen_changed": int(screen_changed), "success": int(step_ok),
                "duration_ms": int((time.time() - step_t) * 1000),
                "created_at": datetime.utcnow().isoformat(),
            }
            _insert_step(step_entry)
            steps_log.append(step_entry)

            async with _SESSIONS_LOCK:
                session["steps"] = steps_log; session["steps_count"] = step_num

            messages.append({"role": "assistant", "content": llm_raw})
            obs_msg = f"Observation: {observation}"
            if not step_ok:
                obs_msg += "\n⚠️ L'action a échoué."
            messages.append({"role": "user", "content": obs_msg})

            if action_type == "done" or exec_result.get("done"):
                final_result = action_input or observation; status = "success"
                print(f"[CU] ✅ Session {session_id} terminée: {final_result[:80]}"); break
        else:
            status = "failed"; error = f"Max steps ({max_steps}) sans 'done'"

    except Exception as e:
        status = "failed"; error = f"{type(e).__name__}: {str(e)[:300]}"
        print(f"[CU] ❌ {e}")

    duration_ms = int((time.time() - t_start) * 1000)
    _upsert_session({
        "id": session_id, "created_at": session["created_at"],
        "goal": goal, "status": status, "steps_count": len(steps_log),
        "duration_ms": duration_ms, "final_result": final_result,
        "error": error, "max_steps": max_steps,
    })
    async with _SESSIONS_LOCK:
        if session_id in _SESSIONS:
            _SESSIONS[session_id].update({"status": status, "duration_ms": duration_ms,
                                          "final_result": final_result, "error": error})


# ─── Router de session ─────────────────────────────────────────────────────────

async def _run_session(session_id: str):
    """Route vers ULTRA (Anthropic) ou LOCAL selon config."""
    if _DISPLAY.get("mode") == "anthropic":
        await _run_anthropic_cu_session(session_id)
    else:
        await _run_local_session(session_id)


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
            )""")
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
            )""")
        conn.commit()


def _upsert_session(s: dict):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            INSERT OR REPLACE INTO sessions
              (id,created_at,goal,status,steps_count,duration_ms,final_result,error,max_steps)
            VALUES (:id,:created_at,:goal,:status,:steps_count,:duration_ms,
                    :final_result,:error,:max_steps)
        """, s)
        conn.commit()


def _insert_step(step: dict):
    with sqlite3.connect(DB_FILE) as conn:
        conn.execute("""
            INSERT OR REPLACE INTO steps
              (id,session_id,step_num,action_type,action_input,thought,
               observation,screen_hash,screen_changed,success,duration_ms,created_at)
            VALUES (:id,:session_id,:step_num,:action_type,:action_input,:thought,
                    :observation,:screen_hash,:screen_changed,:success,:duration_ms,:created_at)
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
        total = total or 0; succ = succ or 0
        return {
            "total": total, "succeeded": succ, "failed": fail or 0,
            "stopped": stop or 0,
            "success_rate": round(succ / (total + 1e-9), 3),
            "avg_steps": round(avg_steps or 0, 1),
            "avg_ms": round(avg_ms or 0),
            "active": sum(1 for s in _SESSIONS.values() if s["status"] == "running"),
        }


# ─── FastAPI ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    global _DISPLAY
    _init_db()

    # Auto-calibration display
    _DISPLAY = _detect_display()

    # Sauvegarde profil machine
    try:
        PROFILE_FILE.parent.mkdir(parents=True, exist_ok=True)
        PROFILE_FILE.write_text(json.dumps(_DISPLAY, indent=2))
    except Exception:
        pass

    mode_icon = "🚀 ULTRA (Anthropic CU)" if _DISPLAY["mode"] == "anthropic" else "🔵 LOCAL (moondream)"
    print(f"[ComputerUse] 🖥️  Computer Use Master — {mode_icon}")
    print(f"  Display  : {_DISPLAY['logical_width']}×{_DISPLAY['logical_height']} logique"
          f" (×{_DISPLAY['scale_factor']} {'Retina' if _DISPLAY['is_retina'] else 'standard'})")
    print(f"  Modèle   : {_DISPLAY['cu_model']}")
    print(f"  Access.  : {'✅' if _DISPLAY['accessibility_ok'] else '⚠️  MANQUANT — activer dans Préférences Système → Confidentialité → Accessibilité'}")

    yield
    print("[ComputerUse] 🛑 Arrêt")


app = FastAPI(title="Ghost OS ComputerUse", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"],
    allow_methods=["*"], allow_headers=["*"],
)


# ─── Modèles ──────────────────────────────────────────────────────────────────

class StartReq(BaseModel):
    goal:      str
    max_steps: int = MAX_STEPS_DEFAULT
    mode:      Optional[str] = None  # "anthropic" | "local" | None (auto)


class ScreenshotReq(BaseModel):
    label: str = ""


# ─── Endpoints ────────────────────────────────────────────────────────────────

@app.post("/session/start")
async def start_session(req: StartReq):
    if not req.goal.strip():
        raise HTTPException(400, "goal vide")
    max_steps = min(max(1, req.max_steps), MAX_STEPS_LIMIT)

    session_id = uuid.uuid4().hex[:10]
    now = datetime.utcnow().isoformat()

    # Mode override possible via req.mode
    effective_mode = req.mode if req.mode in ("anthropic", "local") else _DISPLAY["mode"]

    session = {
        "id": session_id, "created_at": now, "goal": req.goal,
        "status": "pending", "steps": [], "steps_count": 0,
        "max_steps": max_steps, "final_result": None, "error": None,
        "stop_requested": False, "mode": effective_mode,
    }
    async with _SESSIONS_LOCK:
        _SESSIONS[session_id] = session

    _upsert_session({
        "id": session_id, "created_at": now, "goal": req.goal,
        "status": "pending", "steps_count": 0, "duration_ms": 0,
        "final_result": None, "error": None, "max_steps": max_steps,
    })

    # Lancer la boucle avec le bon mode
    if effective_mode == "anthropic":
        asyncio.create_task(_run_anthropic_cu_session(session_id))
    else:
        asyncio.create_task(_run_local_session(session_id))

    return {"session_id": session_id, "goal": req.goal, "max_steps": max_steps,
            "status": "pending", "mode": effective_mode,
            "display": f"{_DISPLAY['logical_width']}×{_DISPLAY['logical_height']}"}


@app.get("/session/{session_id}")
async def get_session(session_id: str):
    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
    if session:
        return {**session, "steps": session.get("steps", [])}
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
    async with _SESSIONS_LOCK:
        session = _SESSIONS.get(session_id)
        if not session:
            raise HTTPException(404, "Session introuvable")
        if session["status"] != "running":
            return {"ok": False, "message": f"Non active (status={session['status']})"}
        session["stop_requested"] = True
    return {"ok": True, "session_id": session_id}


@app.post("/screenshot")
async def quick_screenshot(req: ScreenshotReq = ScreenshotReq()):
    """Screenshot rapide Retina-corrigé — hors session."""
    try:
        data, h = await _screenshot_cu()
        b64 = base64.b64encode(data).decode()
        return {"hash": h, "base64": b64,
                "resolution": f"{_DISPLAY['logical_width']}×{_DISPLAY['logical_height']}",
                "retina": _DISPLAY.get("is_retina", False)}
    except Exception as e:
        return {"error": str(e)}


@app.get("/sessions")
async def list_sessions(limit: int = Query(20, ge=1, le=100)):
    db_sessions = _get_sessions(limit)
    async with _SESSIONS_LOCK:
        active = [{k: v for k, v in s.items() if k != "steps"} for s in _SESSIONS.values()]
        active_ids = {s["id"] for s in active}
    merged = list(active) + [s for s in db_sessions if s["id"] not in active_ids]
    merged.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {"sessions": merged[:limit], "total": len(merged)}


@app.get("/stats")
async def stats():
    return {**_get_stats(), "display": _DISPLAY}


@app.get("/health")
async def health():
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
        "status": "ok", "layer": "computer_use",
        "mode": _DISPLAY.get("mode", "local"),
        "display": f"{_DISPLAY.get('logical_width')}×{_DISPLAY.get('logical_height')}",
        "retina": _DISPLAY.get("is_retina", False),
        "scale_factor": _DISPLAY.get("scale_factor", 1.0),
        "accessibility_ok": _DISPLAY.get("accessibility_ok", False),
        "active_sessions": active,
        "perception_ok": perc_ok, "executor_ok": exec_ok, "brain_ok": brain_ok,
        "cu_model": _DISPLAY.get("cu_model", "unknown"),
    }


@app.get("/display")
async def display_info():
    """Profil display auto-détecté au démarrage."""
    return _DISPLAY


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("computer_use:app", host="0.0.0.0", port=8015, reload=False)
