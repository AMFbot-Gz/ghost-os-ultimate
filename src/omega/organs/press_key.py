"""
press_key — Organe raccourcis clavier
Appuie sur n'importe quelle touche ou combinaison (cmd+c, escape, return, etc.)
"""

import subprocess


# Mapping touches → AppleScript
KEY_MAP = {
    "return": "return",
    "enter": "return",
    "escape": "escape",
    "esc": "escape",
    "tab": "tab",
    "space": "space",
    "backspace": "delete",
    "delete": "delete",
    "up": "up arrow",
    "down": "down arrow",
    "left": "left arrow",
    "right": "right arrow",
    "home": "home",
    "end": "end",
    "pageup": "page up",
    "pagedown": "page down",
    "f1": "F1", "f2": "F2", "f3": "F3", "f4": "F4",
    "f5": "F5", "f6": "F6", "f7": "F7", "f8": "F8",
    "f9": "F9", "f10": "F10", "f11": "F11", "f12": "F12",
}

# Mapping modifiers
MOD_MAP = {
    "cmd": "command down",
    "command": "command down",
    "ctrl": "control down",
    "control": "control down",
    "alt": "option down",
    "option": "option down",
    "shift": "shift down",
}


def run(params: dict) -> dict:
    """
    Appuie sur une touche ou combinaison.
    params:
      - key (str): touche principale (ex: "return", "c", "escape", "cmd+c", "cmd+shift+3")
      - count (int, optionnel): nombre de fois (défaut: 1)

    Exemples:
      {"key": "return"}
      {"key": "escape"}
      {"key": "cmd+c"}
      {"key": "cmd+shift+3"}  # screenshot macOS
      {"key": "cmd+z"}        # annuler
      {"key": "cmd+v"}        # coller
      {"key": "tab", "count": 3}
    """
    key_combo = params.get("key") or params.get("keys") or params.get("shortcut") or params.get("keycode") or ""
    count = params.get("count", 1)

    if not key_combo:
        return {"success": False, "result": "Paramètre 'key' requis", "data": None}

    try:
        for _ in range(count):
            success, msg = _press_key_applescript(key_combo)
            if not success:
                # Fallback pyautogui
                success, msg = _press_key_pyautogui(key_combo)
                if not success:
                    return {"success": False, "result": msg, "data": None}

        return {
            "success": True,
            "result": f"Touche '{key_combo}' appuyée {count}x",
            "data": {"key": key_combo, "count": count}
        }

    except Exception as e:
        return {"success": False, "result": f"Erreur touche: {e}", "data": None}


def _press_key_applescript(key_combo: str) -> tuple:
    """Génère et exécute un keystroke AppleScript."""
    parts = [p.lower().strip() for p in key_combo.split("+")]

    modifiers = []
    key = None

    for part in parts:
        if part in MOD_MAP:
            modifiers.append(MOD_MAP[part])
        else:
            key = part

    if key is None:
        return False, "Aucune touche principale trouvée"

    # Construire la commande AppleScript
    if key in KEY_MAP:
        # Touche spéciale → key code
        as_key = KEY_MAP[key]
        if modifiers:
            mod_str = ", ".join(modifiers)
            script = f'tell application "System Events" to key code (key code of "{as_key}") using {{{mod_str}}}'
            # Approche plus fiable pour touches spéciales avec modifiers
            script = f'tell application "System Events" to keystroke (key code 36) using {{{mod_str}}}'
            if as_key == "escape":
                script = f'tell application "System Events" to key code 53 using {{{mod_str}}}'
            elif as_key == "return":
                script = f'tell application "System Events" to key code 36 using {{{mod_str}}}'
            elif as_key == "tab":
                script = f'tell application "System Events" to key code 48 using {{{mod_str}}}'
            elif as_key == "delete":
                script = f'tell application "System Events" to key code 51 using {{{mod_str}}}'
            elif as_key == "up arrow":
                script = f'tell application "System Events" to key code 126 using {{{mod_str}}}'
            elif as_key == "down arrow":
                script = f'tell application "System Events" to key code 125 using {{{mod_str}}}'
            elif as_key == "left arrow":
                script = f'tell application "System Events" to key code 123 using {{{mod_str}}}'
            elif as_key == "right arrow":
                script = f'tell application "System Events" to key code 124 using {{{mod_str}}}'
        else:
            if as_key == "return":
                script = 'tell application "System Events" to key code 36'
            elif as_key == "escape":
                script = 'tell application "System Events" to key code 53'
            elif as_key == "tab":
                script = 'tell application "System Events" to key code 48'
            elif as_key == "delete":
                script = 'tell application "System Events" to key code 51'
            elif as_key == "space":
                script = 'tell application "System Events" to keystroke " "'
            elif as_key == "up arrow":
                script = 'tell application "System Events" to key code 126'
            elif as_key == "down arrow":
                script = 'tell application "System Events" to key code 125'
            elif as_key == "left arrow":
                script = 'tell application "System Events" to key code 123'
            elif as_key == "right arrow":
                script = 'tell application "System Events" to key code 124'
            else:
                script = f'tell application "System Events" to keystroke "{as_key}"'
    else:
        # Touche normale (lettre/chiffre)
        if modifiers:
            mod_str = ", ".join(modifiers)
            script = f'tell application "System Events" to keystroke "{key}" using {{{mod_str}}}'
        else:
            script = f'tell application "System Events" to keystroke "{key}"'

    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=5
    )

    if result.returncode == 0:
        return True, "OK"
    return False, result.stderr.strip()


def _press_key_pyautogui(key_combo: str) -> tuple:
    """Fallback via pyautogui hotkey."""
    parts = [p.lower().strip() for p in key_combo.split("+")]

    # pyautogui utilise "ctrl" pas "cmd" pour macOS hotkeys
    pyag_parts = []
    for p in parts:
        if p in ("cmd", "command"):
            pyag_parts.append("command")
        elif p in ("ctrl", "control"):
            pyag_parts.append("ctrl")
        elif p in ("alt", "option"):
            pyag_parts.append("alt")
        elif p == "shift":
            pyag_parts.append("shift")
        elif p == "return":
            pyag_parts.append("enter")
        elif p == "escape":
            pyag_parts.append("esc")
        else:
            pyag_parts.append(p)

    keys_str = repr(pyag_parts)
    script = f"""
import pyautogui
pyautogui.FAILSAFE = False
pyautogui.hotkey(*{keys_str})
print("ok")
"""
    result = subprocess.run(
        ["python3", "-c", script],
        capture_output=True, text=True, timeout=5
    )

    if result.returncode == 0:
        return True, "OK"
    return False, result.stderr.strip()
