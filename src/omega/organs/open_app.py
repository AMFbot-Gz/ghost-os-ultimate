"""
open_app — Organe macOS : ouvre une application
Utilise AppleScript + open pour lancer n'importe quelle app macOS
"""

import subprocess


def run(params: dict) -> dict:
    """
    Ouvre une application macOS.
    params:
      - app (str): nom de l'application (ex: "Safari", "Terminal", "Google Chrome")
      - url (str, optionnel): URL à ouvrir dans le navigateur
    """
    # Accepter plusieurs noms de paramètre courants
    app = params.get("app") or params.get("name") or params.get("application") or params.get("app_name") or ""
    url = params.get("url") or params.get("link") or ""

    if not app:
        return {"success": False, "result": "Paramètre 'app' requis", "data": None}

    try:
        if url:
            # Ouvrir URL dans l'application spécifiée
            script = f'tell application "{app}" to open location "{url}"'
            result = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=10
            )
        else:
            # Ouvrir l'application simplement
            result = subprocess.run(
                ["open", "-a", app],
                capture_output=True, text=True, timeout=10
            )

        if result.returncode == 0:
            return {
                "success": True,
                "result": f"Application '{app}' ouverte avec succès",
                "data": {"app": app, "url": url}
            }
        else:
            # Fallback via AppleScript
            script = f'tell application "{app}" to activate'
            result2 = subprocess.run(
                ["osascript", "-e", script],
                capture_output=True, text=True, timeout=10
            )
            if result2.returncode == 0:
                return {
                    "success": True,
                    "result": f"Application '{app}' activée via AppleScript",
                    "data": {"app": app}
                }
            return {
                "success": False,
                "result": f"Impossible d'ouvrir '{app}': {result.stderr.strip()}",
                "data": None
            }

    except subprocess.TimeoutExpired:
        return {"success": False, "result": f"Timeout: '{app}' ne répond pas", "data": None}
    except Exception as e:
        return {"success": False, "result": f"Erreur: {e}", "data": None}
