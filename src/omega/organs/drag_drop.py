"""
drag_drop — Organe glisser-déposer
Effectue un drag & drop entre deux points à l'écran
"""

import subprocess
import time


def run(params: dict) -> dict:
    """
    Glisser-déposer d'un point à un autre.
    params:
      - from_x (int): position X de départ
      - from_y (int): position Y de départ
      - to_x (int): position X d'arrivée
      - to_y (int): position Y d'arrivée
      - duration (float, optionnel): durée du glissement en secondes (défaut: 0.5)
      - button (str, optionnel): "left" | "right" (défaut: "left")
    """
    from_x = params.get("from_x")
    from_y = params.get("from_y")
    to_x = params.get("to_x")
    to_y = params.get("to_y")
    duration = params.get("duration", 0.5)
    button = params.get("button", "left")

    if any(v is None for v in [from_x, from_y, to_x, to_y]):
        return {
            "success": False,
            "result": "Paramètres from_x, from_y, to_x, to_y requis",
            "data": None
        }

    try:
        script = f"""
import pyautogui, time
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05

# Se déplacer sur la source
pyautogui.moveTo({int(from_x)}, {int(from_y)}, duration=0.2)
time.sleep(0.1)

# Drag vers la destination
pyautogui.dragTo({int(to_x)}, {int(to_y)}, duration={float(duration)}, button="{button}")
time.sleep(0.1)

print("ok")
"""
        result = subprocess.run(
            ["python3", "-c", script],
            capture_output=True, text=True, timeout=15
        )

        if result.returncode == 0:
            return {
                "success": True,
                "result": f"Drag & drop de ({from_x},{from_y}) vers ({to_x},{to_y}) effectué",
                "data": {
                    "from": {"x": from_x, "y": from_y},
                    "to": {"x": to_x, "y": to_y},
                    "duration": duration
                }
            }
        return {
            "success": False,
            "result": f"Erreur drag&drop: {result.stderr.strip()[:200]}",
            "data": None
        }

    except Exception as e:
        return {"success": False, "result": f"Erreur: {e}", "data": None}
