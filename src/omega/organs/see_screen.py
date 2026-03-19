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
VISION_MODEL = os.getenv("OLLAMA_MODEL_VISION", "llava:7b")


def _capture_screen(save_path: str) -> bool:
    """Tente de capturer l'écran avec plusieurs méthodes."""
    # Méthode 1: screencapture -x (nécessite Screen Recording permission)
    result = subprocess.run(
        ["screencapture", "-x", save_path],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode == 0 and os.path.exists(save_path) and os.path.getsize(save_path) > 1000:
        return True

    # Méthode 2: screencapture sans -x (avec son)
    result = subprocess.run(
        ["screencapture", save_path],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode == 0 and os.path.exists(save_path) and os.path.getsize(save_path) > 1000:
        return True

    # Méthode 3: PyObjC Quartz (si disponible)
    try:
        import Quartz
        image = Quartz.CGWindowListCreateImage(
            Quartz.CGRectInfinite,
            Quartz.kCGWindowListOptionOnScreenOnly,
            Quartz.kCGNullWindowID,
            Quartz.kCGWindowImageDefault
        )
        if image:
            import Cocoa
            bmp = Quartz.CGBitmapContextCreate(
                None,
                Quartz.CGImageGetWidth(image),
                Quartz.CGImageGetHeight(image),
                8, 0,
                Quartz.CGColorSpaceCreateDeviceRGB(),
                Quartz.kCGImageAlphaPremultipliedLast
            )
            Quartz.CGContextDrawImage(bmp, ((0, 0), (Quartz.CGImageGetWidth(image), Quartz.CGImageGetHeight(image))), image)
            dest = Quartz.CGImageDestinationCreateWithURL(
                Cocoa.NSURL.fileURLWithPath_(save_path),
                "public.png", 1, None
            )
            Quartz.CGImageDestinationAddImage(dest, Quartz.CGBitmapContextCreateImage(bmp), None)
            Quartz.CGImageDestinationFinalize(dest)
            if os.path.exists(save_path) and os.path.getsize(save_path) > 1000:
                return True
    except Exception:
        pass

    return False


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
        if not _capture_screen(save_path):
            return {
                "success": False,
                "result": (
                    "Impossible de capturer l'écran. "
                    "Autorisation Screen Recording requise : "
                    "Préférences Système → Confidentialité → Enregistrement d'écran → ajouter Terminal."
                ),
                "data": {"permission_required": "Screen Recording"}
            }

        # 2. Encoder en base64
        with open(save_path, "rb") as f:
            b64 = base64.b64encode(f.read()).decode()

        # 3. Appel llava via Ollama
        try:
            import urllib.request
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
