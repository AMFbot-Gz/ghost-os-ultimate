"""
run_terminal — Organe exécution shell
Exécute n'importe quelle commande dans le terminal macOS
"""

import subprocess
import os
import shlex


def run(params: dict) -> dict:
    """
    Exécute une commande shell.
    params:
      - cmd (str): commande à exécuter
      - cwd (str, optionnel): répertoire de travail (défaut: home)
      - timeout (int, optionnel): timeout en secondes (défaut: 30)
      - shell (bool, optionnel): utiliser /bin/bash -c (défaut: True)
      - visible (bool, optionnel): ouvrir dans Terminal.app visible (défaut: False)
      - env (dict, optionnel): variables d'environnement additionnelles
    """
    cmd = params.get("cmd", "")
    cwd = params.get("cwd", os.path.expanduser("~"))
    timeout = params.get("timeout", 30)
    shell_mode = params.get("shell", True)
    visible = params.get("visible", False)
    extra_env = params.get("env", {})

    if not cmd:
        return {"success": False, "result": "Paramètre 'cmd' requis", "data": None}

    # Résoudre le répertoire de travail
    cwd = os.path.expanduser(cwd)
    if not os.path.isdir(cwd):
        cwd = os.path.expanduser("~")

    # Si visible → ouvrir dans Terminal.app
    if visible:
        return _run_in_terminal_app(cmd, cwd)

    # Environnement enrichi
    env = os.environ.copy()
    env.update(extra_env)
    # Assurer que PATH inclut les outils courants
    env["PATH"] = "/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:" + env.get("PATH", "")

    try:
        if shell_mode:
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env
            )
        else:
            result = subprocess.run(
                shlex.split(cmd),
                capture_output=True,
                text=True,
                timeout=timeout,
                cwd=cwd,
                env=env
            )

        stdout = result.stdout.strip()
        stderr = result.stderr.strip()
        output = stdout or stderr

        return {
            "success": result.returncode == 0,
            "result": output[:2000] if output else f"Code retour: {result.returncode}",
            "data": {
                "returncode": result.returncode,
                "stdout": stdout[:1000],
                "stderr": stderr[:500],
                "cmd": cmd,
                "cwd": cwd
            }
        }

    except subprocess.TimeoutExpired:
        return {
            "success": False,
            "result": f"Timeout ({timeout}s) dépassé pour: {cmd[:100]}",
            "data": {"cmd": cmd, "timeout": timeout}
        }
    except Exception as e:
        return {"success": False, "result": f"Erreur shell: {e}", "data": None}


def _run_in_terminal_app(cmd: str, cwd: str) -> dict:
    """Ouvre un Terminal.app visible et exécute la commande."""
    # Échapper pour AppleScript
    safe_cmd = cmd.replace('\\', '\\\\').replace('"', '\\"')
    safe_cwd = cwd.replace('\\', '\\\\').replace('"', '\\"')

    script = f"""
tell application "Terminal"
    activate
    do script "cd \\"{safe_cwd}\\" && {safe_cmd}"
end tell
"""
    result = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True, text=True, timeout=10
    )

    if result.returncode == 0:
        return {
            "success": True,
            "result": f"Commande lancée dans Terminal.app: {cmd[:100]}",
            "data": {"visible": True, "cmd": cmd}
        }
    return {
        "success": False,
        "result": f"Erreur Terminal.app: {result.stderr.strip()[:200]}",
        "data": None
    }
