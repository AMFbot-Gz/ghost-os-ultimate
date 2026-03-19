"""
see_screen — Organe vision écran
Capture l'écran et analyse visuellement via llava:7b ou describe basique
"""

import subprocess
import base64
import os
import time
import json
from pathlib import Path

SANDBOX_DIR = Path(__file__).parent.parent / "sandbox"
SANDBOX_DIR.mkdir(exist_ok=True)

OLLAMA_URL = os.getenv("OLLAMA_HOST", "http://localhost:11434")
VISION_MODEL = "llava:7b"


def run(params: dict) -> dict:
    """
    Prend un screenshot et l'analyse visuellement.
    params:
      - question (str, optionnel): question à poser sur l'écran (défaut: description générale)
      - model (str, optionnel): modèle vision (défaut: llava:7b)
      - save_path (str, optionnel): chemin pour sauvegarder le screenshot
    """
    question = params.get("question", "Décris ce que tu vois à l'écran. Identifie l'application active, les éléments visibles et tout texte important.")
    model = params.get("model", VISION_MODEL)
    save_path = params.get("save_path", str(SANDBOX_DIR / "screen_tmp.png"))

    try:
        # 1. Capturer l'écran
        result = subprocess.run(
            ["screencapture", "-x", save_path],
            capture_output=True, text=True, timeout=10
        )

        if result.returncode != 0 or not os.path.exists(save_path):
            return {
                "success": False,
                "result": "Impossible de capturer l'écran",
                "data": None
            }

        # 2. Encoder en base64
        with open(save_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        # 3. Appel llava via Ollama
        try:
            import urllib.request, urllib.error
            payload = json.dumps({
                "model": model,
                "prompt": question,
                "images": [b64],
                "stream": False,
                "options": {"temperature": 0.1, "num_predict": 500}
            }).encode()

            req = urllib.request.Request(
                f"{OLLAMA_URL}/api/generate",
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
                description = data.get("response", "").strip()

        except Exception as e:
            # Fallback: décrire sans IA (taille image, timestamp)
            size = os.path.getsize(save_path)
            description = f"[Vision IA indisponible: {e}] Screenshot capturé ({size} bytes) à {time.strftime('%H:%M:%S')}"

        return {
            "success": True,
            "result": description[:500],
            "data": {
                "screenshot_path": save_path,
                "description": description,
                "model": model
            }
        }

    except Exception as e:
        return {"success": False, "result": f"Erreur vision: {e}", "data": None}
