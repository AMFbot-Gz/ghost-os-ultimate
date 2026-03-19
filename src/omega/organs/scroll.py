"""
scroll — Organe défilement
Fait défiler la page dans n'importe quelle direction
"""

import subprocess


def run(params: dict) -> dict:
    """
    Fait défiler la page.
    params:
      - direction (str): "up" | "down" | "left" | "right" (défaut: "down")
      - amount (int): nombre de clics de molette (défaut: 3)
      - x (int, optionnel): position X pour le scroll (défaut: centre écran)
      - y (int, optionnel): position Y pour le scroll (défaut: centre écran)
    """
    direction = params.get("direction", "down")
    amount = params.get("amount", 3)
    x = params.get("x", None)
    y = params.get("y", None)

    try:
        # Déterminer les deltas
        dx, dy = 0, 0
        if direction == "down":
            dy = -amount
        elif direction == "up":
            dy = amount
        elif direction == "left":
            dx = amount
        elif direction == "right":
            dx = -amount
        else:
            return {"success": False, "result": f"Direction inconnue: {direction}", "data": None}

        # Script pyautogui
        pos_str = ""
        if x is not None and y is not None:
            pos_str = f"pyautogui.moveTo({int(x)}, {int(y)}, duration=0.2)\n"

        script = f"""
import pyautogui
pyautogui.FAILSAFE = False
{pos_str}
pyautogui.scroll({dy})
print("ok")
"""
        result = subprocess.run(
            ["python3", "-c", script],
            capture_output=True, text=True, timeout=10
        )

        if result.returncode == 0:
            return {
                "success": True,
                "result": f"Défilement {direction} de {amount} unités",
                "data": {"direction": direction, "amount": amount}
            }

        # Fallback AppleScript
        return _scroll_applescript(direction, amount)

    except Exception as e:
        return {"success": False, "result": f"Erreur scroll: {e}", "data": None}


def _scroll_applescript(direction: str, amount: int) -> dict:
    """Fallback scroll via touches fléchées."""
    key_map = {
        "down": "down arrow",
        "up": "up arrow",
        "left": "left arrow",
        "right": "right arrow",
    }
    key = key_map.get(direction, "down arrow")
    script = f"""
tell application "System Events"
    repeat {amount * 3} times
        key code {_key_code(key)}
    end repeat
end tell
"""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=10
    )
    if result.returncode == 0:
        return {
            "success": True,
            "result": f"Défilement {direction} via touches (fallback)",
            "data": {"direction": direction, "method": "applescript"}
        }
    return {
        "success": False,
        "result": f"Erreur scroll AppleScript: {result.stderr.strip()}",
        "data": None
    }


def _key_code(key: str) -> int:
    codes = {
        "down arrow": 125,
        "up arrow": 126,
        "left arrow": 123,
        "right arrow": 124,
        "page down": 121,
        "page up": 116,
    }
    return codes.get(key, 125)
