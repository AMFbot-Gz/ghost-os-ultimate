"""
read_clipboard — Organe presse-papiers
Lire et écrire dans le presse-papiers macOS
"""

import subprocess


def run(params: dict) -> dict:
    """
    Accès au presse-papiers.
    params:
      - action (str): "read" | "write" | "clear" (défaut: "read")
      - text (str): texte à écrire (si action == "write")
    """
    action = params.get("action", "read")
    text = params.get("text", "")

    try:
        if action == "read":
            return _read_clipboard()
        elif action == "write":
            return _write_clipboard(text)
        elif action == "clear":
            return _write_clipboard("")
        else:
            return {"success": False, "result": f"Action inconnue: {action}", "data": None}

    except Exception as e:
        return {"success": False, "result": f"Erreur clipboard: {e}", "data": None}


def _read_clipboard() -> dict:
    """Lit le contenu du presse-papiers."""
    result = subprocess.run(
        ["pbpaste"],
        capture_output=True, text=True, timeout=5
    )

    if result.returncode == 0:
        content = result.stdout
        return {
            "success": True,
            "result": f"Presse-papiers lu ({len(content)} caractères)",
            "data": {
                "text": content,
                "length": len(content),
                "preview": content[:200]
            }
        }
    return {
        "success": False,
        "result": f"Erreur lecture clipboard: {result.stderr.strip()}",
        "data": None
    }


def _write_clipboard(text: str) -> dict:
    """Écrit du texte dans le presse-papiers."""
    result = subprocess.run(
        ["pbcopy"],
        input=text,
        capture_output=True, text=True, timeout=5
    )

    if result.returncode == 0:
        return {
            "success": True,
            "result": f"Texte copié dans le presse-papiers ({len(text)} caractères)",
            "data": {"text": text[:100], "length": len(text)}
        }
    return {
        "success": False,
        "result": f"Erreur écriture clipboard: {result.stderr.strip()}",
        "data": None
    }
