"""
type_text — Organe frappe clavier
Tape du texte dans l'application active via pyautogui + AppleScript
"""

import subprocess
import time


def run(params: dict) -> dict:
    """
    Tape du texte dans l'application active.
    params:
      - text (str): texte à taper
      - interval (float, optionnel): délai entre chaque caractère (défaut: 0.03)
      - clear_first (bool, optionnel): sélectionner tout avant de taper (défaut: False)
      - method (str): "pyautogui" | "applescript" (défaut: "applescript")
    """
    text = params.get("text") or params.get("content") or params.get("message") or params.get("input") or ""
    interval = params.get("interval", 0.03)
    clear_first = params.get("clear_first", False)
    method = params.get("method", "applescript")

    if not text:
        return {"success": False, "result": "Paramètre 'text' requis", "data": None}

    try:
        if method == "applescript":
            return _type_applescript(text, clear_first)
        else:
            return _type_pyautogui(text, interval, clear_first)

    except Exception as e:
        return {"success": False, "result": f"Erreur frappe: {e}", "data": None}


def _type_applescript(text: str, clear_first: bool) -> dict:
    """Frappe via AppleScript keystroke — supporte Unicode."""
    # Échapper les guillemets dans le texte
    safe_text = text.replace('\\', '\\\\').replace('"', '\\"')

    clear_cmd = ""
    if clear_first:
        clear_cmd = 'keystroke "a" using {command down}\ndelay 0.1\n'

    script = f"""
tell application "System Events"
    {clear_cmd}
    keystroke "{safe_text}"
end tell
"""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=15
    )

    if result.returncode == 0:
        return {
            "success": True,
            "result": f"Texte tapé ({len(text)} caractères) via AppleScript",
            "data": {"method": "applescript", "length": len(text)}
        }

    # Fallback pyautogui
    return _type_pyautogui(text, 0.03, clear_first)


def _type_pyautogui(text: str, interval: float, clear_first: bool) -> dict:
    """Frappe via pyautogui typewrite."""
    script = f"""
import pyautogui, time
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.02
"""
    if clear_first:
        script += "pyautogui.hotkey('cmd', 'a')\ntime.sleep(0.1)\n"

    # pyautogui.typewrite ne supporte pas bien Unicode → utiliser write
    safe_text = text.replace("'", "\\'")
    script += f"pyautogui.write('{safe_text}', interval={interval})\nprint('ok')\n"

    result = subprocess.run(
        ["python3", "-c", script],
        capture_output=True, text=True, timeout=20
    )

    if result.returncode == 0:
        return {
            "success": True,
            "result": f"Texte tapé ({len(text)} caractères) via pyautogui",
            "data": {"method": "pyautogui", "length": len(text)}
        }
    return {
        "success": False,
        "result": f"Erreur frappe: {result.stderr.strip()[:200]}",
        "data": None
    }
