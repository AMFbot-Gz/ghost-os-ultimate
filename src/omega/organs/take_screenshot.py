"""
take_screenshot — Organe capture d'écran
Capture l'écran complet ou une fenêtre spécifique
"""

import subprocess
import os
import time
from pathlib import Path


SCREENSHOT_DIR = Path.home() / "Desktop" / "omega_screenshots"


def run(params: dict) -> dict:
    """
    Capture l'écran.
    params:
      - filename (str, optionnel): nom du fichier (défaut: auto timestamp)
      - region (dict, optionnel): {"x": int, "y": int, "w": int, "h": int}
      - window (str, optionnel): nom de la fenêtre/app à capturer
      - output_dir (str, optionnel): répertoire de sortie
    """
    filename = params.get("filename", "")
    region = params.get("region", None)
    window = params.get("window", "")
    output_dir = params.get("output_dir", str(SCREENSHOT_DIR))

    # Créer le répertoire si nécessaire
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    # Nom de fichier automatique
    if not filename:
        timestamp = time.strftime("%Y%m%d_%H%M%S")
        filename = f"screenshot_{timestamp}.png"

    filepath = str(out_path / filename)

    try:
        if window:
            return _capture_window(window, filepath)
        elif region:
            return _capture_region(region, filepath)
        else:
            return _capture_fullscreen(filepath)

    except Exception as e:
        return {"success": False, "result": f"Erreur screenshot: {e}", "data": None}


def _capture_fullscreen(filepath: str) -> dict:
    """Capture l'écran entier via screencapture."""
    result = subprocess.run(
        ["screencapture", "-x", filepath],
        capture_output=True, text=True, timeout=10
    )

    if result.returncode == 0 and os.path.exists(filepath):
        size = os.path.getsize(filepath)
        return {
            "success": True,
            "result": f"Screenshot sauvegardé: {filepath}",
            "data": {"path": filepath, "size": size, "type": "fullscreen"}
        }
    return {
        "success": False,
        "result": f"Erreur screencapture: {result.stderr.strip()}",
        "data": None
    }


def _capture_region(region: dict, filepath: str) -> dict:
    """Capture une région de l'écran."""
    x = region.get("x", 0)
    y = region.get("y", 0)
    w = region.get("w", 100)
    h = region.get("h", 100)

    result = subprocess.run(
        ["screencapture", "-x", "-R", f"{x},{y},{w},{h}", filepath],
        capture_output=True, text=True, timeout=10
    )

    if result.returncode == 0 and os.path.exists(filepath):
        return {
            "success": True,
            "result": f"Région capturée: {filepath}",
            "data": {"path": filepath, "region": region}
        }
    return {
        "success": False,
        "result": f"Erreur capture région: {result.stderr.strip()}",
        "data": None
    }


def _capture_window(window_name: str, filepath: str) -> dict:
    """Capture une fenêtre spécifique."""
    # Activer l'app puis capturer la fenêtre en focus
    script = f'tell application "{window_name}" to activate'
    subprocess.run(["osascript", "-e", script], capture_output=True, timeout=3)
    time.sleep(0.5)

    # -l pour capturer la fenêtre sélectionnée, -x sans son
    # On utilise -o pour capturer la fenêtre frontale
    result = subprocess.run(
        ["screencapture", "-x", "-o", filepath],
        capture_output=True, text=True, timeout=10
    )

    if result.returncode == 0 and os.path.exists(filepath):
        return {
            "success": True,
            "result": f"Fenêtre '{window_name}' capturée: {filepath}",
            "data": {"path": filepath, "window": window_name}
        }

    # Fallback fullscreen
    return _capture_fullscreen(filepath)
