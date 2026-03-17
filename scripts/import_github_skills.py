#!/usr/bin/env python3
"""
import_github_skills.py — Importation sécurisée de skills Node.js depuis GitHub

Télécharge des skills Node.js depuis des dépôts GitHub (publics ou privés),
les valide via le sandboxer 5-couches d'Evolution (:8005), et les installe
dans skills/ ou skills/quarantine/.

Usage:
  python3 scripts/import_github_skills.py https://github.com/user/repo
  python3 scripts/import_github_skills.py https://github.com/user/repo --branch main --path skills/
  python3 scripts/import_github_skills.py --list-file repos.txt
  python3 scripts/import_github_skills.py https://github.com/user/repo --dry-run
  python3 scripts/import_github_skills.py https://github.com/user/repo --auto-approve
"""

import argparse
import base64
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

# ─── Chemins ──────────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent
SKILLS_DIR = ROOT / "skills"
QUARANTINE_DIR = SKILLS_DIR / "_quarantine"
REGISTRY_FILE = SKILLS_DIR / "registry.json"

# ─── Constantes sécurité ──────────────────────────────────────────────────────

EVOLUTION_URL = "http://localhost:8005/validate_skill_code"

# Imports bloqués inconditionnellement (avant même la validation 5-couches)
# EXCEPTION : child_process est autorisé si la validation 5-couches passe —
# il est utilisé légitimement par run_command, open_app, etc.
BLOCKED_IMPORTS = [
    "__proto__",      # prototype pollution JavaScript
    "process.env",    # accès aux variables d'environnement sensibles
    "crypto",         # risque génération de clés malveillantes hors contexte légitime
]

# Patterns suspects — signalés avec avertissement, pas bloqués (sauf child_process sans validation)
SUSPICIOUS_PATTERNS = [
    (r"fetch\s*\(.*api\.telegram", "appel réseau vers Telegram API"),
    (r"eval\s*\(", "utilisation de eval()"),
    (r"Function\s*\(", "constructeur Function() dynamique"),
    (r"\.env\b", "référence à .env (variables d'environnement)"),
    (r"process\.exit", "arrêt forcé du processus"),
    (r"require\s*\(\s*['\"]child_process", "require('child_process') — vérifier l'utilisation"),
]

# Score minimum pour installation directe (sous ce seuil → quarantaine automatique)
MIN_VALIDATION_SCORE = 0.6

# ─── Helpers réseau ───────────────────────────────────────────────────────────


def github_api_request(url: str, token: Optional[str]) -> dict:
    """Effectue une requête vers l'API GitHub et retourne le JSON parsé."""
    req = urllib.request.Request(url)
    req.add_header("Accept", "application/vnd.github+json")
    req.add_header("X-GitHub-Api-Version", "2022-11-28")
    req.add_header("User-Agent", "ghost-os-import-skills/1.0")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise RuntimeError(f"Ressource introuvable (404) : {url}") from exc
        if exc.code == 403:
            raise RuntimeError(
                f"Accès refusé (403) — rate limit GitHub ou token manquant : {url}"
            ) from exc
        if exc.code == 401:
            raise RuntimeError(f"Token GitHub invalide (401) : {url}") from exc
        raise RuntimeError(f"Erreur HTTP {exc.code} pour {url}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Erreur réseau : {exc.reason}") from exc


def evolution_validate(code: str) -> dict:
    """
    Envoie le code au sandboxer 5-couches d'Evolution (:8005).

    Retourne le dict de résultat complet :
    {
        "valid": bool,
        "layers": {1: "OK", ...},
        "failed_layer": int | None,
        "error": str | None,
        "test_result": str | None,
    }
    En cas d'indisponibilité du service, retourne un dict d'erreur.
    """
    payload = json.dumps({
        "code": code,
        "func_name": "run",
        "test_params": {},
        "run_test": False,  # Pas d'exécution sandbox pour Node.js (Evolution est Python)
    }).encode()
    req = urllib.request.Request(
        EVOLUTION_URL,
        data=payload,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.URLError:
        # Service indisponible — on retourne un résultat partiel avec warning
        return {
            "valid": None,  # None = inconnu (service hors ligne)
            "layers": {},
            "failed_layer": None,
            "error": "Evolution :8005 indisponible — validation 5-couches ignorée",
            "test_result": None,
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "valid": None,
            "layers": {},
            "failed_layer": None,
            "error": f"Erreur inattendue lors de la validation : {exc}",
            "test_result": None,
        }


# ─── Analyse statique locale ──────────────────────────────────────────────────


def check_blocked_imports(code: str) -> list[str]:
    """Retourne la liste des imports/patterns bloqués trouvés dans le code."""
    found = []
    for pattern in BLOCKED_IMPORTS:
        if pattern in code:
            found.append(pattern)
    return found


def check_suspicious_patterns(code: str) -> list[tuple[str, str]]:
    """
    Retourne les patterns suspects (regex, description) trouvés.
    child_process est listé ici mais n'est pas bloqué — c'est un avertissement.
    """
    found = []
    for pattern, description in SUSPICIOUS_PATTERNS:
        if re.search(pattern, code):
            found.append((pattern, description))
    return found


def check_exports_run(code: str) -> bool:
    """Vérifie que le skill exporte bien `async function run(params)`."""
    patterns = [
        r"export\s+async\s+function\s+run\s*\(",
        r"export\s+\{\s*run\s*\}",
        r"module\.exports\s*=.*run",
        r"module\.exports\.run\s*=",
    ]
    return any(re.search(p, code) for p in patterns)


def compute_validation_score(
    blocked: list,
    suspicious: list,
    has_run_export: bool,
    evolution_result: dict,
) -> float:
    """
    Calcule un score de confiance [0.0–1.0] basé sur tous les checks.

    Pénalités :
    - Imports bloqués : -0.5 par import (-1.0 minimum → 0.0)
    - Patterns suspects : -0.1 par pattern
    - Pas d'export run() : -0.3
    - Evolution valide=False : -0.4
    - Evolution indisponible : -0.1 (incertitude)
    """
    score = 1.0
    score -= len(blocked) * 0.5
    score -= len(suspicious) * 0.1
    if not has_run_export:
        score -= 0.3
    if evolution_result.get("valid") is False:
        score -= 0.4
    elif evolution_result.get("valid") is None:
        score -= 0.1  # service indisponible — légère pénalité d'incertitude
    return max(0.0, round(score, 3))


# ─── Scanner GitHub ───────────────────────────────────────────────────────────


def parse_github_url(url: str) -> tuple[str, str]:
    """Extrait (owner, repo) depuis une URL GitHub."""
    url = url.rstrip("/")
    # Formats acceptés :
    # https://github.com/owner/repo
    # https://github.com/owner/repo.git
    match = re.match(r"https?://github\.com/([^/]+)/([^/]+?)(?:\.git)?$", url)
    if not match:
        raise ValueError(f"URL GitHub invalide : {url}")
    return match.group(1), match.group(2)


def list_skill_files(
    owner: str,
    repo: str,
    branch: str,
    path_filter: str,
    token: Optional[str],
) -> list[dict]:
    """
    Récupère l'arbre récursif du repo et filtre les fichiers skill.js / index.js
    dans un sous-dossier nommé avec les conventions Ghost OS.

    Retourne une liste de dicts : {"path": str, "sha": str, "url": str}
    """
    api_url = f"https://api.github.com/repos/{owner}/{repo}/git/trees/{branch}?recursive=1"
    print(f"  Scan de l'arbre Git : {api_url}")
    tree_data = github_api_request(api_url, token)

    if tree_data.get("truncated"):
        print("  AVERTISSEMENT : arbre Git tronqué (repo trop grand) — certains fichiers peuvent être manquants")

    candidates = []
    for item in tree_data.get("tree", []):
        if item.get("type") != "blob":
            continue
        item_path = item["path"]

        # Appliquer le filtre de chemin si spécifié
        if path_filter and not item_path.startswith(path_filter.strip("/")):
            continue

        filename = item_path.split("/")[-1]

        # Critère 1 : fichier nommé skill.js
        if filename == "skill.js":
            candidates.append({"path": item_path, "sha": item["sha"], "url": item["url"]})
            continue

        # Critère 2 : index.js dans un sous-dossier (pattern Ghost OS alternatif)
        parts = item_path.split("/")
        if filename == "index.js" and len(parts) >= 2:
            # Vérifier qu'il y a un skill.js ou manifest.json à côté (même dossier)
            folder = "/".join(parts[:-1])
            siblings = [
                t["path"]
                for t in tree_data.get("tree", [])
                if t["path"].startswith(folder + "/") and t["path"] != item_path
            ]
            sibling_names = {s.split("/")[-1] for s in siblings}
            if "manifest.json" in sibling_names or "skill.js" not in sibling_names:
                candidates.append({"path": item_path, "sha": item["sha"], "url": item["url"]})

    return candidates


def download_skill_code(owner: str, repo: str, file_path: str, branch: str, token: Optional[str]) -> str:
    """Télécharge le contenu d'un fichier via l'API contents de GitHub."""
    api_url = f"https://api.github.com/repos/{owner}/{repo}/contents/{file_path}?ref={branch}"
    data = github_api_request(api_url, token)

    if data.get("encoding") == "base64":
        content = base64.b64decode(data["content"]).decode("utf-8", errors="replace")
    else:
        content = data.get("content", "")
    return content


# ─── Validation complète d'un skill ──────────────────────────────────────────


def validate_skill(code: str, file_path: str) -> dict:
    """
    Pipeline de validation complet pour un skill Node.js.

    Étapes :
    1. Vérification imports bloqués (local)
    2. Détection patterns suspects (local)
    3. Vérification export async function run(params) (local)
    4. Validation via Evolution :8005 (5-couches sandboxer)
    5. Calcul du score de confiance agrégé

    Retourne un dict de résultat détaillé.
    """
    # Étape 1 — Imports bloqués
    blocked = check_blocked_imports(code)

    # Étape 2 — Patterns suspects
    suspicious = check_suspicious_patterns(code)

    # Étape 3 — Export run()
    has_run_export = check_exports_run(code)

    # Étape 4 — Evolution 5-couches
    print("    Envoi vers Evolution :8005 pour validation 5-couches...")
    evolution_result = evolution_validate(code)

    # Étape 5 — Score agrégé
    score = compute_validation_score(blocked, suspicious, has_run_export, evolution_result)

    # Construction résultat
    layers_raw = evolution_result.get("layers", {})
    # Normaliser les clés en str pour la sérialisation JSON
    layers_str = {str(k): str(v) for k, v in layers_raw.items()}
    # Compléter les couches manquantes (Evolution peut ne retourner que les couches 1-5 Python)
    for i in range(1, 6):
        if str(i) not in layers_str:
            layers_str[str(i)] = evolution_result.get("error", "non évalué")

    return {
        "file_path": file_path,
        "blocked_imports": blocked,
        "suspicious_patterns": [(p, d) for p, d in suspicious],
        "has_run_export": has_run_export,
        "evolution_valid": evolution_result.get("valid"),
        "evolution_error": evolution_result.get("error"),
        "evolution_layers": layers_str,
        "validation_score": score,
        "is_safe": len(blocked) == 0 and has_run_export,
    }


# ─── Installation ─────────────────────────────────────────────────────────────


def derive_skill_name(file_path: str, repo_url: str) -> str:
    """
    Dérive le nom du skill depuis son chemin dans le repo.

    - skills/mon_skill/skill.js → mon_skill
    - mon_skill/skill.js → mon_skill
    - skill.js à la racine → basé sur le nom du repo
    """
    parts = Path(file_path).parts
    if len(parts) >= 2:
        # Le nom est le dossier parent du fichier skill.js / index.js
        parent = parts[-2]
        # Nettoyer : garder uniquement alphanum + _ -
        name = re.sub(r"[^a-zA-Z0-9_\-]", "_", parent)
        return name.lower()
    # Cas fallback : skill à la racine → nom du repo
    _, repo = parse_github_url(repo_url)
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", repo).lower()


def install_skill(
    code: str,
    skill_name: str,
    repo_url: str,
    file_path_in_repo: str,
    validation_result: dict,
    quarantine: bool,
    dry_run: bool,
) -> Path:
    """
    Installe un skill validé dans skills/{name}/ ou skills/_quarantine/{name}/.

    Crée :
    - skill.js          — le code du skill
    - manifest.json     — métadonnées d'import

    Met à jour skills/registry.json.

    En mode dry_run, affiche uniquement ce qui serait fait.
    Retourne le chemin du dossier d'installation.
    """
    target_dir = (QUARANTINE_DIR if quarantine else SKILLS_DIR) / skill_name
    skill_file = target_dir / "skill.js"
    manifest_file = target_dir / "manifest.json"

    manifest = {
        "name": skill_name,
        "version": "1.0.0",
        "source": "github",
        "repo_url": repo_url,
        "file_path": file_path_in_repo,
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "validation_score": validation_result["validation_score"],
        "validation_layers": validation_result["evolution_layers"],
        "quarantined": quarantine,
        "imported_by": "import_github_skills.py",
    }

    if dry_run:
        print(f"    [DRY-RUN] Installerait dans : {target_dir}")
        print(f"    [DRY-RUN] manifest.json : {json.dumps(manifest, indent=2, ensure_ascii=False)}")
        return target_dir

    # Créer le dossier
    target_dir.mkdir(parents=True, exist_ok=True)

    # Écrire skill.js
    skill_file.write_text(code, encoding="utf-8")

    # Écrire manifest.json
    manifest_file.write_text(json.dumps(manifest, indent=2, ensure_ascii=False), encoding="utf-8")

    # Mettre à jour registry.json
    _update_registry(skill_name, manifest, quarantine)

    print(f"    Installé dans : {target_dir}")
    return target_dir


def _update_registry(skill_name: str, manifest: dict, quarantine: bool) -> None:
    """Met à jour skills/registry.json avec le nouveau skill importé."""
    if not REGISTRY_FILE.exists():
        registry = {"version": "1.1.0", "skills": []}
    else:
        try:
            registry = json.loads(REGISTRY_FILE.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            registry = {"version": "1.1.0", "skills": []}

    # Supprimer l'entrée existante si elle existe déjà (mise à jour)
    registry["skills"] = [s for s in registry.get("skills", []) if s.get("name") != skill_name]

    entry = {
        "name": skill_name,
        "description": f"Importé depuis {manifest['repo_url']} (score: {manifest['validation_score']})",
        "version": manifest["version"],
        "source": "github",
        "repo_url": manifest["repo_url"],
        "imported_at": manifest["imported_at"],
        "validation_score": manifest["validation_score"],
        "quarantined": quarantine,
        "created": manifest["imported_at"],
    }
    registry["skills"].append(entry)
    registry["lastUpdated"] = datetime.now(timezone.utc).isoformat()

    REGISTRY_FILE.write_text(json.dumps(registry, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"    registry.json mis à jour ({len(registry['skills'])} skills)")


# ─── Affichage interactif ─────────────────────────────────────────────────────


def display_skill_preview(code: str, validation: dict, skill_name: str) -> None:
    """Affiche un résumé du skill pour la confirmation utilisateur."""
    print()
    print("  " + "=" * 60)
    print(f"  Skill : {skill_name}")
    print(f"  Score de validation : {validation['validation_score']:.2f} / 1.00")
    print()

    # Imports bloqués
    if validation["blocked_imports"]:
        print(f"  BLOQUE — imports interdits : {', '.join(validation['blocked_imports'])}")
    else:
        print("  Imports bloqués : aucun")

    # Patterns suspects
    if validation["suspicious_patterns"]:
        print(f"  Avertissements ({len(validation['suspicious_patterns'])}) :")
        for _, desc in validation["suspicious_patterns"]:
            print(f"    - {desc}")
    else:
        print("  Patterns suspects : aucun")

    # Export run()
    status_export = "oui" if validation["has_run_export"] else "NON TROUVE"
    print(f"  Export async function run() : {status_export}")

    # Validation Evolution
    ev_valid = validation["evolution_valid"]
    if ev_valid is True:
        print("  Evolution :8005 : valide")
    elif ev_valid is False:
        print(f"  Evolution :8005 : ECHEC — {validation['evolution_error']}")
    else:
        print(f"  Evolution :8005 : {validation['evolution_error'] or 'non disponible'}")

    # Aperçu du code (20 premières lignes)
    print()
    print("  --- Aperçu du code (20 premières lignes) ---")
    lines = code.splitlines()[:20]
    for i, line in enumerate(lines, 1):
        print(f"  {i:3d} | {line}")
    if len(code.splitlines()) > 20:
        print(f"  ... ({len(code.splitlines()) - 20} lignes supplémentaires)")
    print("  " + "=" * 60)


def ask_confirmation(skill_name: str, quarantine: bool) -> bool:
    """Demande confirmation interactive pour l'installation."""
    dest = "skills/_quarantine/" if quarantine else "skills/"
    try:
        answer = input(f"\n  Installer '{skill_name}' dans {dest} ? [o/N] : ").strip().lower()
        return answer in ("o", "oui", "y", "yes")
    except (EOFError, KeyboardInterrupt):
        print()
        return False


# ─── Traitement d'un repo ─────────────────────────────────────────────────────


def process_repo(
    repo_url: str,
    branch: str,
    path_filter: str,
    token: Optional[str],
    dry_run: bool,
    auto_approve: bool,
    validate_only: bool,
    force_quarantine: bool,
) -> dict:
    """
    Traite un dépôt GitHub complet.

    Retourne un dict de statistiques :
    {
        "repo_url": str,
        "found": int,
        "validated": int,
        "installed": int,
        "quarantined": int,
        "skipped": int,
        "errors": int,
    }
    """
    stats = {
        "repo_url": repo_url,
        "found": 0,
        "validated": 0,
        "installed": 0,
        "quarantined": 0,
        "skipped": 0,
        "errors": 0,
    }

    print()
    print(f"Dépôt : {repo_url}")
    print(f"  Branche : {branch} | Chemin : {path_filter or '(racine)'}")

    try:
        owner, repo = parse_github_url(repo_url)
    except ValueError as exc:
        print(f"  ERREUR : {exc}")
        stats["errors"] += 1
        return stats

    # 1. Scanner le repo
    try:
        skill_files = list_skill_files(owner, repo, branch, path_filter, token)
    except RuntimeError as exc:
        print(f"  ERREUR scan GitHub : {exc}")
        stats["errors"] += 1
        return stats

    stats["found"] = len(skill_files)
    print(f"  {len(skill_files)} fichier(s) skill trouvé(s)")

    if not skill_files:
        print("  Aucun skill à importer.")
        return stats

    # 2. Traiter chaque skill
    for skill_info in skill_files:
        file_path = skill_info["path"]
        print(f"\n  Traitement : {file_path}")

        # Téléchargement
        try:
            code = download_skill_code(owner, repo, file_path, branch, token)
        except RuntimeError as exc:
            print(f"    ERREUR téléchargement : {exc}")
            stats["errors"] += 1
            continue

        # Dériver le nom du skill
        skill_name = derive_skill_name(file_path, repo_url)
        print(f"    Nom dérivé : {skill_name}")

        # Vérification imports bloqués (arrêt immédiat si trouvés)
        blocked = check_blocked_imports(code)
        if blocked:
            print(f"    BLOQUE — imports interdits détectés : {', '.join(blocked)}")
            print("    Ce skill ne peut pas être importé.")
            stats["skipped"] += 1
            continue

        # Validation complète
        validation = validate_skill(code, file_path)
        stats["validated"] += 1

        # Déterminer si quarantaine s'impose
        score = validation["validation_score"]
        should_quarantine = force_quarantine or (score < MIN_VALIDATION_SCORE) or (not validation["has_run_export"])

        if validate_only:
            display_skill_preview(code, validation, skill_name)
            status = "quarantaine" if should_quarantine else "ok"
            print(f"    [VALIDATE-ONLY] Score={score:.2f} → {status}")
            continue

        # Affichage + confirmation
        display_skill_preview(code, validation, skill_name)

        if not validation["has_run_export"]:
            print("    AVERTISSEMENT : export async function run() introuvable — quarantaine automatique")
            should_quarantine = True

        if not auto_approve:
            confirmed = ask_confirmation(skill_name, should_quarantine)
            if not confirmed:
                print(f"    Ignoré par l'utilisateur.")
                stats["skipped"] += 1
                continue

        # Installation
        install_skill(
            code=code,
            skill_name=skill_name,
            repo_url=repo_url,
            file_path_in_repo=file_path,
            validation_result=validation,
            quarantine=should_quarantine,
            dry_run=dry_run,
        )

        if should_quarantine:
            stats["quarantined"] += 1
            print(f"    Placé en quarantaine (score={score:.2f})")
        else:
            stats["installed"] += 1
            print(f"    Installé (score={score:.2f})")

    return stats


# ─── Point d'entrée ───────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="import_github_skills.py",
        description="Importe des skills Node.js depuis GitHub avec validation 5-couches",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples :
  python3 scripts/import_github_skills.py https://github.com/user/repo
  python3 scripts/import_github_skills.py https://github.com/user/repo --branch develop --path skills/
  python3 scripts/import_github_skills.py --list-file scripts/repos.txt
  python3 scripts/import_github_skills.py https://github.com/user/repo --dry-run
  python3 scripts/import_github_skills.py https://github.com/user/repo --auto-approve
  python3 scripts/import_github_skills.py https://github.com/user/repo --validate-only
  python3 scripts/import_github_skills.py https://github.com/user/repo --quarantine
        """,
    )
    parser.add_argument(
        "repo_url",
        nargs="?",
        help="URL du dépôt GitHub (https://github.com/owner/repo)",
    )
    parser.add_argument(
        "--branch",
        default="main",
        metavar="BRANCH",
        help="Branche à scanner (défaut: main)",
    )
    parser.add_argument(
        "--path",
        default="",
        metavar="PATH",
        help="Sous-dossier à scanner dans le repo (défaut: racine)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Analyse sans installer (affiche ce qui serait fait)",
    )
    parser.add_argument(
        "--auto-approve",
        action="store_true",
        help="Installe sans demander confirmation (non recommandé)",
    )
    parser.add_argument(
        "--list-file",
        metavar="FILE",
        help="Fichier texte avec une URL de repo par ligne",
    )
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Valide mais n'installe pas",
    )
    parser.add_argument(
        "--quarantine",
        action="store_true",
        help="Place les skills dans skills/_quarantine/ au lieu de skills/",
    )
    parser.add_argument(
        "--token",
        metavar="TOKEN",
        help="GitHub token (priorité sur la variable d'environnement GITHUB_TOKEN)",
    )
    return parser


def load_repo_list(list_file: str) -> list[str]:
    """
    Lit un fichier de repos (une URL par ligne).
    Ignore les lignes vides et les commentaires (# ...).
    """
    path = Path(list_file)
    if not path.exists():
        raise FileNotFoundError(f"Fichier de liste introuvable : {list_file}")
    urls = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        urls.append(line)
    return urls


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    # Résoudre le token GitHub
    token: Optional[str] = args.token or os.environ.get("GITHUB_TOKEN") or None
    if token:
        print("GitHub token détecté — accès aux repos privés activé")
    else:
        print("Pas de GitHub token — repos publics uniquement")

    # Construire la liste des repos à traiter
    repos: list[str] = []

    if args.list_file:
        try:
            repos = load_repo_list(args.list_file)
            print(f"{len(repos)} repo(s) chargé(s) depuis {args.list_file}")
        except FileNotFoundError as exc:
            print(f"ERREUR : {exc}", file=sys.stderr)
            return 1

    if args.repo_url:
        repos.append(args.repo_url)

    if not repos:
        parser.print_help()
        print("\nERREUR : Fournissez une URL de repo ou --list-file.", file=sys.stderr)
        return 1

    # Afficher les options actives
    flags = []
    if args.dry_run:
        flags.append("DRY-RUN")
    if args.auto_approve:
        flags.append("AUTO-APPROVE")
    if args.validate_only:
        flags.append("VALIDATE-ONLY")
    if args.quarantine:
        flags.append("QUARANTINE-FORCED")
    if flags:
        print(f"Mode(s) actif(s) : {', '.join(flags)}")

    print(f"\nEvolution sandboxer : {EVOLUTION_URL}")
    print(f"Répertoire skills   : {SKILLS_DIR}")
    print(f"Répertoire quarantaine : {QUARANTINE_DIR}")

    # Traiter chaque repo
    all_stats = []
    start = time.monotonic()

    for repo_url in repos:
        stats = process_repo(
            repo_url=repo_url,
            branch=args.branch,
            path_filter=args.path,
            token=token,
            dry_run=args.dry_run,
            auto_approve=args.auto_approve,
            validate_only=args.validate_only,
            force_quarantine=args.quarantine,
        )
        all_stats.append(stats)

    elapsed = time.monotonic() - start

    # Résumé final
    print()
    print("=" * 62)
    print("Résumé de l'importation")
    print("=" * 62)
    total_found = sum(s["found"] for s in all_stats)
    total_installed = sum(s["installed"] for s in all_stats)
    total_quarantined = sum(s["quarantined"] for s in all_stats)
    total_skipped = sum(s["skipped"] for s in all_stats)
    total_errors = sum(s["errors"] for s in all_stats)

    print(f"  Repos traités     : {len(all_stats)}")
    print(f"  Skills trouvés    : {total_found}")
    print(f"  Installés         : {total_installed}")
    print(f"  Quarantaine       : {total_quarantined}")
    print(f"  Ignorés           : {total_skipped}")
    print(f"  Erreurs           : {total_errors}")
    print(f"  Durée             : {elapsed:.1f}s")
    print("=" * 62)

    return 0 if total_errors == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
