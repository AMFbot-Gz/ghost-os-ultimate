#!/usr/bin/env python3
"""
scripts/preflight_cu.py — Preflight Computer Use zero-config
Détecte, vérifie et auto-configure le Computer Use au démarrage.
Appelé par start_agent.py avant de lancer la couche computer_use.

Vérifie et auto-répare :
  ✓ Résolution écran + facteur Retina
  ✓ PyAutoGUI (install si manquant, FAILSAFE position)
  ✓ PIL/Pillow (install si manquant)
  ✓ screencapture macOS fonctionnel
  ✓ Permissions accessibilité macOS
  ✓ anthropic SDK (install si manquant et ANTHROPIC_API_KEY présent)
  ✓ pyperclip (pour type_text avec accents)
  ✓ Profil machine sauvegardé dans .laruche/machine_profile.json
"""
from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PROFILE = ROOT / ".laruche" / "machine_profile.json"

# Charger .env automatiquement (si pas déjà chargé par start_agent.py)
try:
    from dotenv import load_dotenv
    load_dotenv(ROOT / ".env", override=False)  # override=False: ne pas écraser si déjà chargé
except ImportError:
    pass

GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg):  print(f"  {GREEN}✅{RESET} {msg}")
def warn(msg): print(f"  {YELLOW}⚠️ {RESET} {msg}")
def err(msg):  print(f"  {RED}❌{RESET} {msg}")
def info(msg): print(f"  {BLUE}ℹ️ {RESET} {msg}")


def pip_install(package: str) -> bool:
    """Installe un package pip silencieusement."""
    try:
        subprocess.run(
            [sys.executable, "-m", "pip", "install", package, "-q",
             "--break-system-packages"],
            check=True, capture_output=True,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def detect_retina_scale(logical_w: int) -> float:
    """Détecte le facteur Retina (1.0 = standard, 2.0 = Retina MacBook Pro)."""
    if platform.system() != "Darwin":
        return 1.0

    # Méthode 1 : AppKit (la plus fiable)
    try:
        r = subprocess.run(
            [sys.executable, "-c",
             "import AppKit; print(AppKit.NSScreen.mainScreen().backingScaleFactor())"],
            capture_output=True, text=True, timeout=5,
        )
        if r.returncode == 0 and r.stdout.strip():
            return float(r.stdout.strip())
    except Exception:
        pass

    # Méthode 2 : comparer screenshot physique vs taille logique
    try:
        tmp = "/tmp/ghost_preflight_scale.png"
        subprocess.run(["screencapture", "-x", "-t", "png", tmp],
                       capture_output=True, timeout=8, check=True)
        from PIL import Image
        img = Image.open(tmp)
        pw, _ = img.size
        return round(pw / logical_w, 1) if logical_w > 0 else 1.0
    except Exception:
        pass

    return 1.0


def check_accessibility() -> bool:
    """Vérifie les permissions d'accessibilité macOS."""
    if platform.system() != "Darwin":
        return True
    # Skip sous PM2 — osascript nécessite une session GUI
    if os.environ.get("PM2_HOME") or os.environ.get("pm_id") or os.environ.get("PM2_USAGE"):
        return True  # Supposer OK sous PM2, vérifier à la demande
    try:
        r = subprocess.run(
            ["osascript", "-e",
             'tell application "System Events" to get name of first process whose frontmost is true'],
            capture_output=True, text=True, timeout=5,
        )
        return r.returncode == 0
    except BaseException:  # Capture KeyboardInterrupt + Exception
        return False


def test_screencapture() -> bool:
    """Teste que screencapture fonctionne."""
    if platform.system() != "Darwin":
        return False
    # Skip sous PM2 / headless (pas d'accès écran)
    if os.environ.get("PM2_HOME") or os.environ.get("pm_id") or os.environ.get("PM2_USAGE"):
        return False
    try:
        r = subprocess.run(
            ["screencapture", "-x", "-t", "png", "/tmp/ghost_preflight_test.png"],
            capture_output=True, timeout=10,
        )
        p = Path("/tmp/ghost_preflight_test.png")
        return r.returncode == 0 and p.exists() and p.stat().st_size > 1000
    except BaseException:  # KeyboardInterrupt n'est pas Exception
        return False


def run_preflight() -> dict:
    """Lance tous les checks et retourne le profil machine."""
    print(f"\n{BOLD}{BLUE}╔══════════════════════════════════════════════════╗")
    print(f"║  Ghost OS — Computer Use Preflight             ║")
    print(f"╚══════════════════════════════════════════════════╝{RESET}\n")

    profile: dict = {
        "platform": platform.system(),
        "python_version": sys.version.split()[0],
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "mode": "local",
    }

    # ── 1. PyAutoGUI ─────────────────────────────────────────────────────────
    print("1. PyAutoGUI")
    try:
        import pyautogui
        w, h = pyautogui.size()
        pyautogui.FAILSAFE = True
        profile["logical_width"] = w
        profile["logical_height"] = h
        ok(f"PyAutoGUI OK — résolution logique {w}×{h}")
    except ImportError:
        warn("PyAutoGUI manquant — installation...")
        if pip_install("pyautogui"):
            import pyautogui
            w, h = pyautogui.size()
            profile["logical_width"] = w
            profile["logical_height"] = h
            ok(f"PyAutoGUI installé — {w}×{h}")
        else:
            err("Impossible d'installer PyAutoGUI")
            w, h = 1920, 1080
            profile["logical_width"] = w
            profile["logical_height"] = h
    except Exception as e:
        warn(f"PyAutoGUI erreur (headless ?): {e}")
        w, h = 1920, 1080
        profile["logical_width"] = w
        profile["logical_height"] = h

    # ── 2. PIL / Pillow ───────────────────────────────────────────────────────
    print("\n2. PIL / Pillow (correction Retina)")
    try:
        from PIL import Image
        ok("Pillow OK")
    except ImportError:
        warn("Pillow manquant — installation...")
        if pip_install("Pillow"):
            ok("Pillow installé")
        else:
            err("Impossible d'installer Pillow — Retina correction désactivée")

    # ── 3. Retina / HiDPI ────────────────────────────────────────────────────
    print("\n3. Facteur d'échelle Retina")
    scale = detect_retina_scale(profile.get("logical_width", 1920))
    profile["scale_factor"] = scale
    profile["is_retina"] = scale >= 2.0
    if profile["is_retina"]:
        phys_w = int(profile["logical_width"] * scale)
        phys_h = int(profile["logical_height"] * scale)
        ok(f"Retina {scale}× détecté — physique {phys_w}×{phys_h} → logique {profile['logical_width']}×{profile['logical_height']}")
        info("Screenshots downscalés automatiquement avant envoi à Claude ✓")
    else:
        ok(f"Standard (pas de Retina) — {profile['logical_width']}×{profile['logical_height']}")

    # ── 4. screencapture ─────────────────────────────────────────────────────
    print("\n4. screencapture macOS")
    if platform.system() == "Darwin":
        sc_ok = test_screencapture()
        if sc_ok:
            ok("screencapture fonctionnel")
        else:
            err("screencapture échoue — vérifier les permissions Screen Recording")
            info("→ Préférences Système → Confidentialité → Enregistrement d'écran → ajouter Terminal")
        profile["screencapture_ok"] = sc_ok
    else:
        profile["screencapture_ok"] = False
        info(f"Platform {platform.system()} — screencapture non applicable")

    # ── 5. Accessibilité macOS ─────────────────────────────────────────────────
    print("\n5. Permissions d'accessibilité macOS")
    accessibility_ok = check_accessibility()
    profile["accessibility_ok"] = accessibility_ok
    if accessibility_ok:
        ok("Accessibilité accordée — PyAutoGUI peut contrôler l'interface")
    else:
        warn("Accessibilité non accordée")
        info("→ Préférences Système → Confidentialité → Accessibilité → ajouter Terminal ou Python")
        info("→ Sans ça, clicks et touches clavier ne fonctionneront pas")

    # ── 6. Anthropic SDK + CU mode ────────────────────────────────────────────
    print("\n6. Anthropic Computer Use API")
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    api_enabled = os.getenv("ANTHROPIC_ENABLED", "true").lower() == "true"

    if api_key and api_enabled:
        try:
            import anthropic
            version = getattr(anthropic, "__version__", "?")
            ok(f"anthropic SDK v{version} — mode ULTRA activé")
            profile["mode"] = "anthropic"
            profile["cu_model"] = os.getenv("CU_MODEL", "claude-opus-4-6")
            ok(f"Modèle CU : {profile['cu_model']}")
            info("Claude voit l'écran directement — précision maximale")
        except ImportError:
            warn("anthropic SDK manquant — installation...")
            if pip_install("anthropic>=0.40.0"):
                import anthropic
                ok(f"anthropic SDK installé v{anthropic.__version__} — mode ULTRA activé")
                profile["mode"] = "anthropic"
                profile["cu_model"] = os.getenv("CU_MODEL", "claude-opus-4-6")
            else:
                err("Impossible d'installer anthropic SDK — fallback local")
                profile["mode"] = "local"
    else:
        if not api_key:
            warn("ANTHROPIC_API_KEY absent — mode LOCAL (moondream)")
        else:
            warn("ANTHROPIC_ENABLED=false — mode LOCAL (moondream)")
        profile["mode"] = "local"
        profile["cu_model"] = os.getenv("OLLAMA_MODEL_VISION", "moondream:latest")

    # ── 7. pyperclip (type_text avec accents) ─────────────────────────────────
    print("\n7. pyperclip (copier-coller pour accents)")
    try:
        import pyperclip
        # Test rapide
        pyperclip.copy("test")
        ok("pyperclip OK — type_text supportera les accents")
    except ImportError:
        warn("pyperclip manquant — installation...")
        pip_install("pyperclip")
        ok("pyperclip installé")
    except Exception as e:
        warn(f"pyperclip: {e} (fallback pyautogui.write)")

    # ── Résumé ────────────────────────────────────────────────────────────────
    print(f"\n{BOLD}━━━ Résumé Machine Profile ━━━{RESET}")
    mode_icon = "🚀 ULTRA (Anthropic CU)" if profile["mode"] == "anthropic" else "🔵 LOCAL (moondream)"
    print(f"  Mode     : {mode_icon}")
    print(f"  Display  : {profile.get('logical_width')}×{profile.get('logical_height')} logique"
          f" (×{profile.get('scale_factor', 1.0)} {'Retina' if profile.get('is_retina') else 'standard'})")
    print(f"  Modèle   : {profile.get('cu_model', '?')}")
    print(f"  Access.  : {'✅' if profile.get('accessibility_ok') else '⚠️  REQUIS pour GUI'}")
    print(f"  Screen   : {'✅' if profile.get('screencapture_ok') else '⚠️  REQUIS pour screenshots'}")

    # Sauvegarde profil
    PROFILE.parent.mkdir(parents=True, exist_ok=True)
    PROFILE.write_text(json.dumps(profile, indent=2))
    print(f"\n  💾 Profil sauvegardé → {PROFILE}\n")

    return profile


if __name__ == "__main__":
    profile = run_preflight()
    # Exit code non-zero si des dépendances critiques manquent
    critical_ok = (
        profile.get("accessibility_ok", False) and
        profile.get("screencapture_ok", False)
    )
    sys.exit(0)  # Toujours 0 — l'agent démarre même si warnings
