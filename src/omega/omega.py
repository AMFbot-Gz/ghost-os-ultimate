#!/usr/bin/env python3
"""
omega.py — Agent Autonome Auto-Codeur
======================================
Reçoit une mission → planifie → auto-code les organes manquants → exécute → rapport.

Architecture :
  Mission (Telegram) → Omega → Ollama (cerveau) → Plan
                                   ↓
                        Organe manquant? → Self-Coder → test → deploy
                                   ↓
                        Exécution (souris/clavier/terminal/apps)
                                   ↓
                        Rapport Telegram : "✅ J'ai le contrôle de X"
"""

import os
import sys
import json
import time
import subprocess
import importlib.util
import tempfile
import traceback
from pathlib import Path
from datetime import datetime
import requests

# ─── Chemins ────────────────────────────────────────────────────────────────

ROOT          = Path(__file__).parent.parent.parent  # ghost-os-ultimate/
OMEGA_DIR     = Path(__file__).parent
ORGANS_DIR    = OMEGA_DIR / "organs"
SANDBOX_DIR   = OMEGA_DIR / "sandbox"
REGISTRY_FILE = OMEGA_DIR / "organ_registry.json"
ORGANS_DIR.mkdir(exist_ok=True)
SANDBOX_DIR.mkdir(exist_ok=True)

# ─── Config ─────────────────────────────────────────────────────────────────

from dotenv import load_dotenv
load_dotenv(ROOT / ".env")

OLLAMA_URL     = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL   = os.getenv("OLLAMA_MODEL", "ghost-os-architect:latest")
VISION_MODEL   = "llava:7b"  # pour voir l'écran
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
ADMIN_ID       = os.getenv("ADMIN_TELEGRAM_ID", "")
MEMORY_URL     = os.getenv("MEMORY_URL", "http://localhost:8006")  # agent/memory.py

# ─── Mémoire sémantique (agent/memory.py :8006) ─────────────────────────────

def memory_store(mission: str, rapport: str, success: bool, steps_done: int, steps_total: int):
    """Stocke une mission exécutée dans la mémoire épisodique sémantique."""
    try:
        import urllib.request, urllib.error, ssl
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = None

        episode = {
            "type": "omega_mission",
            "mission": mission[:500],
            "rapport": rapport[:1000],
            "success": success,
            "steps_done": steps_done,
            "steps_total": steps_total,
            "source": "omega",
            "timestamp": datetime.now().isoformat(),
        }
        # Format attendu par agent/memory.py POST /episode
        payload = json.dumps({
            "type": "omega_mission",
            "content": f"Mission: {mission[:200]} | Résultat: {'✅' if success else '❌'} {steps_done}/{steps_total} étapes | {rapport[:300]}",
            "metadata": episode,
            "learned": f"Omega a exécuté: {mission[:100]}" if success else None,
            "machine_id": "omega",
        }, ensure_ascii=False).encode()

        req = urllib.request.Request(
            f"{MEMORY_URL}/episode",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        kwargs = {"timeout": 5}
        if ctx:
            kwargs["context"] = ctx
        urllib.request.urlopen(req, **kwargs)
        print(f"[Omega] 🧠 Mission indexée en mémoire sémantique")
    except Exception as e:
        print(f"[Omega] Mémoire indisponible (non-bloquant): {e}")


def memory_search(query: str, limit: int = 5) -> list:
    """Recherche sémantique dans les missions passées via ChromaDB."""
    try:
        import urllib.request, urllib.parse, ssl
        try:
            import certifi
            ctx = ssl.create_default_context(cafile=certifi.where())
        except ImportError:
            ctx = None

        payload = json.dumps({"query": query, "limit": limit}, ensure_ascii=False).encode()
        req = urllib.request.Request(
            f"{MEMORY_URL}/semantic_search",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        kwargs = {"timeout": 5}
        if ctx:
            kwargs["context"] = ctx
        with urllib.request.urlopen(req, **kwargs) as resp:
            data = json.loads(resp.read())
            return data.get("results", [])
    except Exception:
        return []


# ─── Registre des organes ────────────────────────────────────────────────────

def load_registry() -> dict:
    if REGISTRY_FILE.exists():
        return json.loads(REGISTRY_FILE.read_text())
    return {}

def save_registry(reg: dict):
    REGISTRY_FILE.write_text(json.dumps(reg, indent=2, ensure_ascii=False))

def register_organ(name: str, description: str, path: str, functions: list):
    reg = load_registry()
    reg[name] = {
        "description": description,
        "path": path,
        "functions": functions,
        "created_at": datetime.now().isoformat(),
        "uses": 0,
    }
    save_registry(reg)
    print(f"[Omega] 🧠 Organe enregistré : {name}")

# ─── Ollama LLM ─────────────────────────────────────────────────────────────

def ask_ollama(prompt: str, model: str = None, system: str = None) -> str:
    """Appel Ollama local — zéro cloud."""
    model = model or OLLAMA_MODEL
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.2, "num_predict": 2000},
    }
    if system:
        payload["system"] = system
    try:
        resp = requests.post(f"{OLLAMA_URL}/api/generate", json=payload, timeout=120)
        resp.raise_for_status()
        return resp.json().get("response", "").strip()
    except Exception as e:
        return f"[Erreur Ollama] {e}"

def see_screen() -> str:
    """Screenshot + analyse visuelle via llava."""
    try:
        import pyautogui
        import io
        img = pyautogui.screenshot()
        # Sauvegarder temporairement
        tmp = SANDBOX_DIR / "screen_tmp.png"
        img.save(str(tmp))
        # Encoder en base64
        import base64
        b64 = base64.b64encode(tmp.read_bytes()).decode()
        # Appel llava
        resp = requests.post(f"{OLLAMA_URL}/api/generate", json={
            "model": VISION_MODEL,
            "prompt": "Décris en détail ce que tu vois sur cet écran. Identifie l'application active, les boutons visibles, et tout texte important.",
            "images": [b64],
            "stream": False,
        }, timeout=60)
        return resp.json().get("response", "Écran non analysable")
    except Exception as e:
        return f"[Vision] Erreur: {e}"

# ─── Self-Coder : génère des organes Python autonomement ─────────────────────

SELF_CODER_SYSTEM = """Tu es un générateur d'organes Python pour un agent IA autonome sur macOS.
Tu génères du code Python pur, fonctionnel, qui contrôle le Mac.

RÈGLES :
1. Génère UNIQUEMENT du code Python valide
2. Utilise pyautogui, subprocess, AppleScript (via osascript) pour contrôler le Mac
3. Chaque organe expose une fonction principale : def run(params: dict) -> dict
4. La fonction retourne toujours : {"success": bool, "result": str, "data": any}
5. Jamais d'import manquant — vérifie la disponibilité
6. Code complet, directement exécutable, commentaires en français
7. AUCUNE explication — CODE UNIQUEMENT"""

def self_code_organ(name: str, description: str, context: str = "") -> tuple[bool, str]:
    """
    Génère automatiquement un organe Python pour une capacité manquante.
    Retourne (succès, chemin_fichier)
    """
    print(f"[Omega] ⚙️  Auto-code de l'organe : {name}")

    prompt = f"""Crée un organe Python nommé '{name}' qui fait :
{description}

Contexte de la mission : {context}

L'organe doit :
- Fonctionner sur macOS Darwin x86_64
- Avoir une fonction principale : def run(params: dict) -> dict
- Utiliser pyautogui/subprocess/osascript selon besoin
- Retourner {{"success": True/False, "result": "message", "data": any}}

Code Python complet :"""

    code = ask_ollama(prompt, system=SELF_CODER_SYSTEM)

    # Nettoyer les blocs markdown si présents
    if "```python" in code:
        code = code.split("```python")[1].split("```")[0].strip()
    elif "```" in code:
        code = code.split("```")[1].split("```")[0].strip()

    # Sauvegarder l'organe
    organ_path = ORGANS_DIR / f"{name}.py"
    organ_path.write_text(f'"""\n{name} — Organe auto-généré par Omega\n{description}\nGénéré : {datetime.now()}\n"""\n\n{code}')

    # Tester dans sandbox
    ok, error = test_organ(organ_path)
    if ok:
        # Extraire les fonctions exposées
        functions = extract_functions(organ_path)
        register_organ(name, description, str(organ_path), functions)
        print(f"[Omega] ✅ Organe {name} opérationnel")
        return True, str(organ_path)
    else:
        print(f"[Omega] ❌ Organe {name} échec test : {error}")
        # Retry avec correction automatique
        return retry_code_organ(name, code, error, description)

def retry_code_organ(name: str, code: str, error: str, description: str) -> tuple[bool, str]:
    """Corrige automatiquement un organe en erreur."""
    fix_prompt = f"""L'organe Python suivant a une erreur. Corrige-le.

ERREUR :
{error}

CODE ORIGINAL :
{code}

Code corrigé (Python complet, fonctionnel) :"""

    fixed_code = ask_ollama(fix_prompt, system=SELF_CODER_SYSTEM)
    if "```" in fixed_code:
        fixed_code = fixed_code.split("```")[1].split("```")[0].strip()

    organ_path = ORGANS_DIR / f"{name}.py"
    organ_path.write_text(f'"""\n{name} — Organe auto-généré (v2)\n{description}\n"""\n\n{fixed_code}')

    ok, error2 = test_organ(organ_path)
    if ok:
        functions = extract_functions(organ_path)
        register_organ(name, description, str(organ_path), functions)
        return True, str(organ_path)
    return False, error2

def test_organ(organ_path: Path) -> tuple[bool, str]:
    """Teste un organe en sandbox isolé."""
    try:
        result = subprocess.run(
            [sys.executable, "-c",
             f"import ast; ast.parse(open('{organ_path}').read()); print('OK')"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return False, result.stderr
        return True, ""
    except Exception as e:
        return False, str(e)

def extract_functions(organ_path: Path) -> list:
    """Extrait les noms de fonctions définies dans un organe."""
    import ast
    try:
        tree = ast.parse(organ_path.read_text())
        return [n.name for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)]
    except:
        return ["run"]

# ─── Exécuteur d'organe ──────────────────────────────────────────────────────

def run_organ(name: str, params: dict = None) -> dict:
    """Charge et exécute un organe depuis le registre."""
    reg = load_registry()
    if name not in reg:
        return {"success": False, "result": f"Organe '{name}' non trouvé dans le registre"}

    organ_info = reg[name]
    organ_path = Path(organ_info["path"])
    if not organ_path.exists():
        return {"success": False, "result": f"Fichier organe manquant: {organ_path}"}

    try:
        spec = importlib.util.spec_from_file_location(name, str(organ_path))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        if hasattr(module, "run"):
            result = module.run(params or {})
        elif hasattr(module, "main"):
            result = module.main(params or {})
        else:
            return {"success": False, "result": "Organe sans fonction run() ou main()"}

        # Incrémenter compteur d'utilisation
        reg[name]["uses"] = reg[name].get("uses", 0) + 1
        save_registry(reg)
        return result
    except Exception as e:
        return {"success": False, "result": f"Erreur exécution organe: {traceback.format_exc()}"}

# ─── Mission Executor ────────────────────────────────────────────────────────

PLANNER_SYSTEM = """Tu es le planificateur de missions d'un agent IA autonome sur macOS.
Tu décomposes une mission en étapes concrètes.

ORGANES DISPONIBLES (computer control) :
- open_app : ouvre une application macOS
- take_screenshot : capture l'écran
- mouse_click : clique à une position (x, y) ou sur un élément
- type_text : tape du texte dans l'application active
- press_key : appuie sur une touche (return, escape, cmd+c, etc.)
- run_terminal : exécute une commande shell
- see_screen : analyse visuellement l'écran avec l'IA
- read_clipboard : lit le presse-papier
- scroll : fait défiler la page
- drag_drop : glisser-déposer

FORMAT DE RÉPONSE (JSON strict) :
{
  "steps": [
    {"organ": "nom_organe", "params": {...}, "description": "ce que fait cette étape"},
    ...
  ],
  "estimated_duration": "30s",
  "complexity": "simple|medium|complex"
}"""

def plan_mission(mission: str, screen_context: str = "") -> dict:
    """Planifie une mission avec Ollama."""
    prompt = f"""Mission à accomplir : {mission}

État actuel de l'écran : {screen_context or "Inconnu — prendre un screenshot d'abord"}

Génère un plan d'exécution en JSON :"""

    response = ask_ollama(prompt, system=PLANNER_SYSTEM)

    # Extraire le JSON
    try:
        if "```json" in response:
            response = response.split("```json")[1].split("```")[0]
        elif "{" in response:
            start = response.index("{")
            end = response.rindex("}") + 1
            response = response[start:end]
        return json.loads(response)
    except:
        # Plan minimal de fallback
        return {
            "steps": [
                {"organ": "see_screen", "params": {}, "description": "Analyser l'écran"},
                {"organ": "run_terminal", "params": {"cmd": f"echo 'Mission: {mission}'"}, "description": "Exécuter"}
            ],
            "estimated_duration": "unknown",
            "complexity": "unknown"
        }

def execute_mission(mission: str) -> str:
    """
    Exécute une mission complète de façon autonome.
    Retourne le rapport final.
    """
    print(f"\n[Omega] 🎯 MISSION REÇUE : {mission}")
    print(f"[Omega] ⏰ {datetime.now().strftime('%H:%M:%S')}")

    report = [f"🤖 **Mission** : {mission}"]
    successes = []
    failures = []

    # 0. Rechercher dans la mémoire sémantique les missions similaires passées
    past = memory_search(mission, limit=3)
    past_context = ""
    if past:
        past_context = "Missions similaires passées :\n" + "\n".join(
            f"- {ep.get('content', '')[:150]}" for ep in past
        )
        print(f"[Omega] 📚 {len(past)} missions similaires trouvées en mémoire")

    # 1. Voir l'écran
    print("[Omega] 👁️  Analyse de l'écran...")
    screen = see_screen()
    report.append(f"📺 **Écran** : {screen[:200]}...")

    # 2. Planifier (en intégrant le contexte des missions passées)
    print("[Omega] 🧠 Planification avec Ollama...")
    screen_with_context = f"{screen}\n\n{past_context}" if past_context else screen
    plan = plan_mission(mission, screen_with_context)
    steps = plan.get("steps", [])
    print(f"[Omega] 📋 Plan : {len(steps)} étapes ({plan.get('complexity', '?')})")

    # 3. Exécuter chaque étape
    for i, step in enumerate(steps, 1):
        organ_name = step.get("organ", "")
        params = step.get("params", {})
        desc = step.get("description", "")

        print(f"[Omega] ▶ Étape {i}/{len(steps)} : {organ_name} — {desc}")

        # Vérifier si l'organe existe
        reg = load_registry()
        if organ_name not in reg:
            # Auto-coder l'organe manquant
            print(f"[Omega] ⚙️  Organe '{organ_name}' absent — auto-génération...")
            success, path = self_code_organ(
                organ_name,
                desc,
                context=mission
            )
            if not success:
                failures.append(f"Étape {i}: impossible de créer organe '{organ_name}'")
                continue

        # Exécuter l'organe
        result = run_organ(organ_name, params)

        if result.get("success"):
            successes.append(f"✅ {desc}")
            print(f"[Omega] ✅ {desc} — {result.get('result', '')[:100]}")
        else:
            failures.append(f"❌ {desc}: {result.get('result', '')[:100]}")
            print(f"[Omega] ❌ {desc} — {result.get('result', '')[:80]}")

        time.sleep(0.5)  # Pause entre les étapes

    # 4. Rapport final
    total = len(steps)
    ok = len(successes)
    emoji = "✅" if ok == total else "⚠️" if ok > 0 else "❌"

    rapport = f"""{emoji} **MISSION {'ACCOMPLIE' if ok == total else 'PARTIELLE'}**

📋 {ok}/{total} étapes réussies

{chr(10).join(successes)}
{chr(10).join(failures) if failures else ''}

⏱ Terminé à {datetime.now().strftime('%H:%M:%S')}"""

    # 5. Stocker en mémoire sémantique (non-bloquant)
    memory_store(mission, rapport, ok == total, ok, total)

    return rapport

# ─── Telegram Notify ─────────────────────────────────────────────────────────

def telegram_send(message: str):
    """Envoie un message Telegram à l'admin."""
    if not TELEGRAM_TOKEN or not ADMIN_ID:
        print("[Omega] Telegram non configuré")
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendMessage",
            json={"chat_id": ADMIN_ID, "text": message, "parse_mode": "Markdown"},
            timeout=10
        )
    except Exception as e:
        print(f"[Omega] Telegram error: {e}")

# ─── Point d'entrée ──────────────────────────────────────────────────────────

def main():
    """Mode CLI direct pour tester."""
    if len(sys.argv) < 2:
        print("Usage: python3 omega.py 'ta mission ici'")
        print("       python3 omega.py --list-organs")
        print("       python3 omega.py --run-organ nom_organe")
        return

    if sys.argv[1] == "--list-organs":
        reg = load_registry()
        if not reg:
            print("Aucun organe enregistré.")
        for name, info in reg.items():
            print(f"  🧠 {name} — {info['description']} (utilisé {info['uses']}x)")
        return

    if sys.argv[1] == "--run-organ" and len(sys.argv) > 2:
        organ_name = sys.argv[2]
        params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else {}
        result = run_organ(organ_name, params)
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    mission = " ".join(sys.argv[1:])
    rapport = execute_mission(mission)
    print("\n" + "═" * 60)
    print(rapport)
    telegram_send(rapport)

if __name__ == "__main__":
    main()
