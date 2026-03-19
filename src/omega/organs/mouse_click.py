"""
mouse_click — Organe contrôle souris total
Utilise pyautogui + Quartz pour clics, déplacement, double-clic, clic droit
"""

import subprocess
import time


def run(params: dict) -> dict:
    """
    Contrôle la souris.
    params:
      - x (int): position horizontale en pixels
      - y (int): position verticale en pixels
      - action (str): "click" | "double_click" | "right_click" | "move" | "drag" (défaut: "click")
      - target_x (int): destination pour drag
      - target_y (int): destination pour drag
      - button (str): "left" | "right" | "middle" (défaut: "left")
      - description (str, optionnel): description sémantique de l'élément à cliquer
    """
    x = params.get("x")
    y = params.get("y")
    action = params.get("action", "click")
    target_x = params.get("target_x", x)
    target_y = params.get("target_y", y)
    button = params.get("button", "left")
    description = params.get("description", "")

    # Si description sémantique fournie sans coordonnées → trouver via AX
    if description and (x is None or y is None):
        ax_result = _find_element_ax(description)
        if ax_result:
            x, y = ax_result
        else:
            return {
                "success": False,
                "result": f"Élément '{description}' introuvable à l'écran",
                "data": None
            }

    if x is None or y is None:
        return {"success": False, "result": "Coordonnées x/y requises", "data": None}

    try:
        # Script Python inline pour pyautogui
        script = f"""
import pyautogui
import time
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05

x, y = {int(x)}, {int(y)}
action = "{action}"
button = "{button}"

if action == "move":
    pyautogui.moveTo(x, y, duration=0.3)
    print("moved")
elif action == "double_click":
    pyautogui.doubleClick(x, y, button=button)
    print("double_clicked")
elif action == "right_click":
    pyautogui.rightClick(x, y)
    print("right_clicked")
elif action == "drag":
    pyautogui.dragTo({int(target_x)}, {int(target_y)}, duration=0.5, button=button)
    print("dragged")
else:
    pyautogui.click(x, y, button=button)
    print("clicked")
"""
        result = subprocess.run(
            ["python3", "-c", script],
            capture_output=True, text=True, timeout=10
        )

        if result.returncode == 0:
            return {
                "success": True,
                "result": f"Action '{action}' effectuée en ({x}, {y})",
                "data": {"x": x, "y": y, "action": action}
            }
        else:
            return {
                "success": False,
                "result": f"Erreur pyautogui: {result.stderr.strip()[:200]}",
                "data": None
            }

    except Exception as e:
        return {"success": False, "result": f"Erreur souris: {e}", "data": None}


def _find_element_ax(description: str):
    """Cherche un élément UI par description via l'arbre d'accessibilité macOS."""
    script = f"""
import subprocess, json

applescript = '''
tell application "System Events"
    set frontApp to name of first application process whose frontmost is true
    tell application process frontApp
        set allButtons to every button
        repeat with btn in allButtons
            if description of btn contains "{description}" or name of btn contains "{description}" then
                set pos to position of btn
                return (item 1 of pos as text) & "," & (item 2 of pos as text)
            end if
        end repeat
    end tell
end tell
'''
result = subprocess.run(["osascript", "-e", applescript], capture_output=True, text=True)
if result.returncode == 0 and "," in result.stdout:
    parts = result.stdout.strip().split(",")
    print(int(float(parts[0])), int(float(parts[1])))
"""
    try:
        res = subprocess.run(["python3", "-c", script], capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            coords = res.stdout.strip().split()
            return int(coords[0]), int(coords[1])
    except Exception:
        pass
    return None
