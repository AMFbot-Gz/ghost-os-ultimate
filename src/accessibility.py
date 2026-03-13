#!/usr/bin/env python3
"""
accessibility.py — Semantic Screen Reader LaRuche v1.0
Open Source: macOS Accessibility API (AXUIElement) + AppKit + pyautogui

Fournit un lecteur sémantique de l'interface macOS :
- Lecture de l'arbre AX (rôles, labels, positions) sans vision LLM
- Recherche d'éléments par description textuelle
- Clic sémantique par label (pas de coordonnées fixes)
- Analyse structurée de l'écran

Usage CLI:
  python3 src/accessibility.py read_elements [--app AppName]
  python3 src/accessibility.py find_element --query "bouton Envoyer"
  python3 src/accessibility.py smart_click --query "bouton Envoyer"
  python3 src/accessibility.py screen_info
"""

import sys
import json
import argparse
import subprocess
import re
import time
from typing import Optional

import AppKit
import pyautogui

pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.05

# ─── App info ─────────────────────────────────────────────────────────────────

def get_frontmost_app() -> dict:
    workspace = AppKit.NSWorkspace.sharedWorkspace()
    app = workspace.frontmostApplication()
    if not app:
        return {}
    return {
        "name": app.localizedName(),
        "pid": app.processIdentifier(),
        "bundleId": app.bundleIdentifier() or "",
        "isActive": app.isActive(),
    }

def get_running_apps() -> list:
    workspace = AppKit.NSWorkspace.sharedWorkspace()
    apps = workspace.runningApplications()
    return [
        {
            "name": a.localizedName(),
            "pid": a.processIdentifier(),
            "bundleId": a.bundleIdentifier() or "",
            "active": a.isActive(),
        }
        for a in apps
        if a.activationPolicy() == 0  # NSApplicationActivationPolicyRegular
    ]

# ─── AX Tree via osascript ────────────────────────────────────────────────────

_AX_SCRIPT_TEMPLATE = """\
tell application "System Events"
    tell ({PROC_SELECTOR})
        set appName to name
        set lineList to {}
        set wins to every window
        repeat with w in wins
            try
                repeat with e in (every button of w)
                    try
                        set t to description of e
                        if t is missing value or t is "" then
                            try
                                set t to title of e
                            end try
                        end if
                        if t is missing value then set t to ""
                        set p to position of e
                        set s to size of e
                        set end of lineList to "button|" & t & "|" & ((item 1 of p) as integer) & "|" & ((item 2 of p) as integer) & "|" & ((item 1 of s) as integer) & "|" & ((item 2 of s) as integer)
                    end try
                end repeat
            end try
            try
                repeat with e in (every text field of w)
                    try
                        set t to description of e
                        if t is missing value then set t to ""
                        set p to position of e
                        set s to size of e
                        set end of lineList to "text_field|" & t & "|" & ((item 1 of p) as integer) & "|" & ((item 2 of p) as integer) & "|" & ((item 1 of s) as integer) & "|" & ((item 2 of s) as integer)
                    end try
                end repeat
            end try
            try
                repeat with e in (every pop up button of w)
                    try
                        set t to description of e
                        if t is missing value then set t to ""
                        set p to position of e
                        set s to size of e
                        set end of lineList to "popup|" & t & "|" & ((item 1 of p) as integer) & "|" & ((item 2 of p) as integer) & "|" & ((item 1 of s) as integer) & "|" & ((item 2 of s) as integer)
                    end try
                end repeat
            end try
            try
                repeat with e in (every checkbox of w)
                    try
                        set t to title of e
                        if t is missing value then set t to ""
                        set p to position of e
                        set s to size of e
                        set end of lineList to "checkbox|" & t & "|" & ((item 1 of p) as integer) & "|" & ((item 2 of p) as integer) & "|" & ((item 1 of s) as integer) & "|" & ((item 2 of s) as integer)
                    end try
                end repeat
            end try
            try
                set txts to every static text of w
                if (length of txts) > 25 then set txts to items 1 thru 25 of txts
                repeat with e in txts
                    try
                        set t to value of e
                        if t is not missing value and t is not "" and (length of t) < 80 then
                            set p to position of e
                            set s to size of e
                            set end of lineList to "text|" & t & "|" & ((item 1 of p) as integer) & "|" & ((item 2 of p) as integer) & "|" & ((item 1 of s) as integer) & "|" & ((item 2 of s) as integer)
                        end if
                    end try
                end repeat
            end try
        end repeat
        set AppleScript's text item delimiters to ";;;"
        set joinedStr to lineList as string
        set AppleScript's text item delimiters to ""
        return appName & "||" & joinedStr
    end tell
end tell
"""

def _build_ax_script(app_name: str = "") -> str:
    if app_name:
        proc_selector = f'process "{app_name}"'
    else:
        proc_selector = "first process whose frontmost is true"
    return _AX_SCRIPT_TEMPLATE.replace("{PROC_SELECTOR}", proc_selector)

def _parse_ax_output(raw: str) -> dict:
    """Parse la sortie pipe+semicolon-delimitée du script AX en dict."""
    if "||" not in raw:
        return {"app": "unknown", "elements": []}

    parts = raw.split("||", 1)
    app_name = parts[0].strip()
    body = parts[1].strip() if len(parts) > 1 else ""

    if not body:
        return {"app": app_name, "elements": []}

    entries = [e.strip() for e in body.split(";;;") if e.strip()]
    elements = []
    for entry in entries:
        fields = entry.split("|")
        if len(fields) < 6:
            continue
        try:
            elements.append({
                "role":  fields[0].strip(),
                "title": fields[1].strip(),
                "x":     int(float(fields[2])),
                "y":     int(float(fields[3])),
                "w":     int(float(fields[4])),
                "h":     int(float(fields[5])),
            })
        except (ValueError, IndexError):
            continue

    return {"app": app_name, "elements": elements}

def read_ax_elements(app_name: str = "") -> dict:
    """Lit l'arbre AX de l'app de premier plan (ou app_name si spécifié)."""
    script = _build_ax_script(app_name)
    try:
        result = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True, text=True, timeout=12
        )
        output = result.stdout.strip()
        if not output:
            return {"app": app_name or "unknown", "elements": [],
                    "error": result.stderr.strip()[:200] if result.stderr else "empty"}
        return _parse_ax_output(output)
    except subprocess.TimeoutExpired:
        return {"app": app_name or "unknown", "elements": [], "error": "Timeout AX (12s)"}
    except Exception as e:
        return {"app": app_name or "unknown", "elements": [], "error": str(e)}

# ─── Semantic Element Finder ──────────────────────────────────────────────────

def score_element(elem: dict, query: str) -> float:
    """Score de correspondance entre un élément et une description sémantique.

    Gère : correspondance exacte, partielle, par mots, par racine (stemming léger).
    """
    q = query.lower().strip()
    title = (elem.get("title") or "").lower()
    role = (elem.get("role") or "").lower()

    if not title:
        return 0.0

    score = 0.0

    # Correspondance exacte
    if q == title:
        score = 1.0
    # Le titre contient la requête
    elif q in title:
        score = 0.85
    # La requête contient le titre
    elif title in q:
        score = 0.75
    else:
        # Correspondance par mots individuels
        q_words = q.split()
        t_words = title.split()
        if q_words and t_words:
            # Mots en commun (exact)
            q_set = set(q_words)
            t_set = set(t_words)
            exact_overlap = len(q_set & t_set) / len(q_set) if q_set else 0

            # Stemming léger : chercher si le début d'un mot query est dans un mot title
            stem_matches = 0
            for qw in q_words:
                stem = qw[:max(4, len(qw)-2)]  # racine = min(4 chars, len-2)
                if any(stem in tw for tw in t_words):
                    stem_matches += 1
            stem_overlap = stem_matches / len(q_words) if q_words else 0

            score = max(exact_overlap * 0.65, stem_overlap * 0.5)

            # Boost si plusieurs mots correspondent
            if exact_overlap > 0.5 or stem_overlap > 0.5:
                score = min(1.0, score + 0.1)

    # Bonus pour le rôle mentionné dans la requête
    role_keywords = {
        "button": ["bouton", "button", "clic", "click", "btn"],
        "text_field": ["champ", "field", "input", "zone", "saisie", "search", "recherche", "url", "adresse"],
        "popup": ["menu", "dropdown", "liste"],
        "checkbox": ["case", "checkbox", "cocher", "activer"],
    }
    for elem_role, keywords in role_keywords.items():
        if role == elem_role and any(kw in q for kw in keywords):
            score = min(1.0, score + 0.1)

    return score

# Synonymes FR/EN pour les termes UI communs
_UI_SYNONYMS = {
    "close": ["fermer", "fermeture", "quitter", "exit"],
    "fermer": ["close", "fermeture", "quitter", "exit"],
    "minimize": ["minimiser", "minimisation", "réduire"],
    "minimiser": ["minimize", "minimisation", "réduire"],
    "fullscreen": ["plein écran", "maximiser", "maximize", "plein-écran"],
    "plein écran": ["fullscreen", "maximiser", "maximize"],
    "search": ["recherche", "rechercher", "chercher", "find"],
    "recherche": ["search", "find", "chercher"],
    "send": ["envoyer", "submit", "soumettre"],
    "envoyer": ["send", "submit", "soumettre"],
    "cancel": ["annuler", "annulation"],
    "annuler": ["cancel", "dismiss"],
    "ok": ["confirmer", "valider", "confirm", "validate"],
    "back": ["retour", "précédent", "previous"],
    "retour": ["back", "go back", "précédent"],
    "forward": ["suivant", "avant", "next"],
    "reload": ["recharger", "actualiser", "refresh"],
    "new tab": ["nouvel onglet", "new tab"],
}

def _expand_query_with_synonyms(query: str) -> list:
    """Retourne la requête + ses synonymes pour un meilleur matching."""
    q = query.lower().strip()
    variants = [q]
    # Synonymes directs
    if q in _UI_SYNONYMS:
        variants.extend(_UI_SYNONYMS[q])
    # Chercher si un mot de la requête est dans les synonymes
    for word in q.split():
        if word in _UI_SYNONYMS:
            variants.extend(_UI_SYNONYMS[word])
    return list(dict.fromkeys(variants))  # dédupliquer en gardant l'ordre

def find_element_by_query(query: str, app_name: str = "", threshold: float = 0.3) -> Optional[dict]:
    """Trouve un élément UI par description sémantique."""
    data = read_ax_elements(app_name)
    elements = data.get("elements", [])

    if not elements:
        return None

    # Étendre la requête avec ses synonymes
    query_variants = _expand_query_with_synonyms(query)

    best = None
    best_score = 0.0

    for elem in elements:
        # Score max parmi tous les variants de la requête
        s = max(score_element(elem, variant) for variant in query_variants)
        if s > best_score:
            best_score = s
            best = elem

    if best_score >= threshold:
        # Centre de l'élément
        cx = int(best["x"] + best["w"] / 2)
        cy = int(best["y"] + best["h"] / 2)
        return {
            "found": True,
            "title": best.get("title"),
            "role": best.get("role"),
            "x": cx,
            "y": cy,
            "bounds": {"x": best["x"], "y": best["y"], "w": best["w"], "h": best["h"]},
            "confidence": best_score,
            "app": data.get("app"),
        }

    return {"found": False, "query": query, "best_match": best.get("title") if best else None, "best_score": best_score}

# ─── Smart Click ──────────────────────────────────────────────────────────────

def smart_click(query: str, app_name: str = "", double: bool = False) -> dict:
    """Trouve un élément et clique dessus par description sémantique."""
    result = find_element_by_query(query, app_name)

    if not result or not result.get("found"):
        return {"success": False, "error": f"Élément non trouvé: {query}", "closest": result}

    x, y = result["x"], result["y"]

    try:
        if double:
            pyautogui.doubleClick(x, y)
        else:
            pyautogui.click(x, y)

        return {
            "success": True,
            "clicked": result["title"],
            "role": result["role"],
            "x": x, "y": y,
            "confidence": result["confidence"],
        }
    except Exception as e:
        return {"success": False, "error": str(e), "element": result}

# ─── Screen Info ──────────────────────────────────────────────────────────────

def get_screen_info() -> dict:
    """Infos complètes sur l'écran et l'app de premier plan."""
    screen_size = pyautogui.size()
    frontmost = get_frontmost_app()
    apps = get_running_apps()

    return {
        "screen": {
            "width": screen_size.width,
            "height": screen_size.height,
        },
        "frontmost_app": frontmost,
        "running_apps": apps[:10],
    }

def get_structured_screen(app_name: str = "") -> dict:
    """Analyse sémantique complète de l'écran : app + éléments AX."""
    info = get_screen_info()
    elements = read_ax_elements(app_name)

    # Grouper par rôle
    by_role = {}
    for e in elements.get("elements", []):
        role = e.get("role", "unknown")
        if role not in by_role:
            by_role[role] = []
        by_role[role].append(e.get("title", ""))

    return {
        "success": True,
        "screen": info["screen"],
        "frontmost_app": elements.get("app") or info.get("frontmost_app", {}).get("name"),
        "elements_count": len(elements.get("elements", [])),
        "elements_by_role": by_role,
        "all_elements": elements.get("elements", []),
        "interactive": [
            e for e in elements.get("elements", [])
            if e.get("role") in ["button", "text_field", "link", "checkbox"]
        ],
    }

# ─── Wait for Element ─────────────────────────────────────────────────────────

def wait_for_element(query: str, timeout: float = 10.0, interval: float = 0.5, app_name: str = "") -> dict:
    """Attend qu'un élément apparaisse sur l'écran (polling AX tree)."""
    start = time.time()
    while time.time() - start < timeout:
        result = find_element_by_query(query, app_name)
        if result and result.get("found"):
            return {"success": True, "found": True, "element": result, "elapsed": time.time() - start}
        time.sleep(interval)
    return {"success": False, "found": False, "query": query, "timeout": timeout}

# ─── CLI entrypoint ───────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="LaRuche Semantic Screen Reader")
    parser.add_argument("action", choices=["read_elements", "find_element", "smart_click", "screen_info", "screen_elements", "wait_for_element"])
    parser.add_argument("--app", default="", help="App name filter")
    parser.add_argument("--query", default="", help="Semantic query for element search")
    parser.add_argument("--double", action="store_true", help="Double click")
    parser.add_argument("--timeout", type=float, default=10.0, help="Wait timeout in seconds")
    parser.add_argument("--threshold", type=float, default=0.3, help="Confidence threshold")
    args = parser.parse_args()

    result = {}

    if args.action == "read_elements":
        result = read_ax_elements(args.app)
    elif args.action == "find_element":
        if not args.query:
            result = {"success": False, "error": "--query requis"}
        else:
            result = find_element_by_query(args.query, args.app, args.threshold)
    elif args.action == "smart_click":
        if not args.query:
            result = {"success": False, "error": "--query requis"}
        else:
            result = smart_click(args.query, args.app, args.double)
    elif args.action == "screen_info":
        result = get_screen_info()
    elif args.action == "screen_elements":
        result = get_structured_screen(args.app)
    elif args.action == "wait_for_element":
        if not args.query:
            result = {"success": False, "error": "--query requis"}
        else:
            result = wait_for_element(args.query, args.timeout, app_name=args.app)

    print(json.dumps(result, ensure_ascii=False, default=str))

if __name__ == "__main__":
    main()
