#!/usr/bin/env python3
"""
import_n8n.py — Importe un workflow n8n (JSON) et le convertit en skill Ghost OS

Usage:
  python3 scripts/import_n8n.py workflow.json
  python3 scripts/import_n8n.py workflow.json --name my_skill --install
  python3 scripts/import_n8n.py --dir /path/to/n8n/exports/ --install-all
  python3 scripts/import_n8n.py --url https://api.github.com/repos/user/repo/contents/workflow.json

Options:
  --name NAME      Nom du skill généré (auto-déduit du workflow si absent)
  --install        Installe directement dans skills/ après validation
  --install-all    Installe tous les workflows d'un dossier
  --dir DIR        Dossier contenant des fichiers .json n8n
  --url URL        URL GitHub d'un fichier JSON (utilise GITHUB_TOKEN si dispo)
  --dry-run        Affiche le skill généré sans installer
  --validate       Valide via Evolution layer (:8005) avant install
"""

import argparse
import base64
import json
import os
import re
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

# ─── CONSTANTES ───────────────────────────────────────────────────────────────

ROOT = Path(__file__).parent.parent
SKILLS_DIR = ROOT / "skills"
REGISTRY_PATH = SKILLS_DIR / "registry.json"
EVOLUTION_VALIDATE_URL = "http://localhost:8005/validate_skill_code"

# Types n8n sécurisés à bloquer (contiennent des credentials)
BLOCKED_TYPE_PATTERNS = [
    "credential", "password", "secret", "oauth", "auth", "token",
]

# Mapping n8n node type → générateur de code JS
# Chaque entrée est une fonction (node_name, params) → str de code JS
NODE_TYPE_MAP = {
    "n8n-nodes-base.start":             "_gen_start",
    "n8n-nodes-base.noOp":              "_gen_noop",
    "n8n-nodes-base.webhook":           "_gen_webhook",
    "n8n-nodes-base.respondToWebhook":  "_gen_respond_webhook",
    "n8n-nodes-base.httpRequest":       "_gen_http_request",
    "n8n-nodes-base.function":          "_gen_function",
    "n8n-nodes-base.executeCommand":    "_gen_execute_command",
    "n8n-nodes-base.readBinaryFiles":   "_gen_read_file",
    "n8n-nodes-base.writeBinaryFile":   "_gen_write_file",
    "n8n-nodes-base.set":               "_gen_set",
    "n8n-nodes-base.if":                "_gen_if",
    "n8n-nodes-base.switch":            "_gen_switch",
    "n8n-nodes-base.merge":             "_gen_merge",
    "n8n-nodes-base.wait":              "_gen_wait",
    "n8n-nodes-base.telegram":          "_gen_telegram",
    "n8n-nodes-base.googleSheets":      "_gen_google_sheets",
    "n8n-nodes-base.slack":             "_gen_slack",
}


# ─── UTILITAIRES ──────────────────────────────────────────────────────────────

def slugify(text: str) -> str:
    """Convertit un nom arbitraire en identifiant snake_case valide."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "_", text)
    text = re.sub(r"^_|_$", "", text)
    return text[:40] or "n8n_skill"


def sanitize_url(url: str) -> str:
    """
    Valide qu'une URL extraite des paramètres n8n est safe à inclure dans le code.
    Retourne l'URL si valide, sinon une chaîne vide.
    """
    if not isinstance(url, str):
        return ""
    url = url.strip()
    # Autoriser seulement http:// et https://
    if not re.match(r"^https?://[a-zA-Z0-9._/\-?=&%+#:@]+$", url):
        return ""
    return url


def sanitize_js_string(value: str) -> str:
    """Échappe les guillemets et caractères dangereux pour inclusion dans une string JS."""
    if not isinstance(value, str):
        value = str(value)
    # Échapper backslash, backtick, ${ pour éviter l'injection dans les template literals
    value = value.replace("\\", "\\\\")
    value = value.replace("`", "\\`")
    value = value.replace("${", "\\${")
    return value


def check_node_security(node: dict) -> tuple[bool, str]:
    """
    Vérifie qu'un node ne contient pas de credentials ou de types sensibles.
    Retourne (is_safe, reason).
    """
    node_type = node.get("type", "").lower()
    node_name = node.get("name", "").lower()

    for pattern in BLOCKED_TYPE_PATTERNS:
        if pattern in node_type:
            return False, f"Type de node '{node['type']}' contient '{pattern}' (credentials bloqués)"
        if pattern in node_name:
            return False, f"Nom de node '{node['name']}' contient '{pattern}' (credentials bloqués)"

    # Vérifier que les paramètres ne contiennent pas de mots-clés sensibles explicites
    params_str = json.dumps(node.get("parameters", {})).lower()
    for pattern in ["api_key", "apikey", "api-key", "bearer", "private_key"]:
        if pattern in params_str:
            return False, f"Paramètres du node '{node['name']}' semblent contenir des credentials ('{pattern}')"

    return True, ""


# ─── RÉSOLUTION DE L'ORDRE TOPOLOGIQUE ───────────────────────────────────────

def topological_sort(nodes: list[dict], connections: dict) -> list[dict]:
    """
    Trie les nodes dans l'ordre d'exécution (BFS topologique).
    connections est la structure n8n : { "NodeName": { "main": [[{node, type, index}]] } }
    """
    # Construire un index nom → node
    name_to_node = {n["name"]: n for n in nodes}

    # Construire la liste d'adjacence (parent → enfants)
    children: dict[str, list[str]] = {n["name"]: [] for n in nodes}
    in_degree: dict[str, int] = {n["name"]: 0 for n in nodes}

    for source_name, outputs in connections.items():
        for branch in outputs.get("main", []):
            for edge in branch:
                target = edge.get("node", "")
                if target in children.get(source_name, []):
                    continue
                if source_name in children:
                    children[source_name].append(target)
                if target in in_degree:
                    in_degree[target] += 1

    # BFS depuis les nodes sans parents (in_degree == 0)
    queue = [name for name, deg in in_degree.items() if deg == 0]
    sorted_names: list[str] = []

    while queue:
        current = queue.pop(0)
        sorted_names.append(current)
        for child in children.get(current, []):
            in_degree[child] -= 1
            if in_degree[child] == 0:
                queue.append(child)

    # Ajouter les nodes non atteints (cycles ou isolés) à la fin
    for n in nodes:
        if n["name"] not in sorted_names:
            sorted_names.append(n["name"])

    return [name_to_node[name] for name in sorted_names if name in name_to_node]


# ─── GÉNÉRATEURS DE CODE PAR TYPE DE NODE ────────────────────────────────────

def _gen_start(node_name: str, params: dict) -> str:
    return f"  // Node: {node_name} (start) — point d'entrée, pas de code"


def _gen_noop(node_name: str, params: dict) -> str:
    return f"  // Node: {node_name} (noOp) — passthrough"


def _gen_webhook(node_name: str, params: dict) -> str:
    return (
        f"  // Node: {node_name} (webhook) — retourne les données reçues\n"
        f"  results.push({{ node: {json.dumps(node_name)}, data: params }});"
    )


def _gen_respond_webhook(node_name: str, params: dict) -> str:
    return (
        f"  // Node: {node_name} (respondToWebhook)\n"
        f"  results.push({{ node: {json.dumps(node_name)}, response: params }});"
    )


def _gen_http_request(node_name: str, params: dict) -> str:
    raw_url = params.get("url", "")
    url = sanitize_url(raw_url)
    method = str(params.get("method", "GET")).upper()
    if method not in ("GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"):
        method = "GET"

    if not url:
        return (
            f"  // Node: {node_name} (httpRequest) — URL invalide ou absente, node ignoré\n"
            f"  results.push({{ node: {json.dumps(node_name)}, skipped: true, reason: 'invalid URL' }});"
        )

    safe_url = sanitize_js_string(url)

    if method == "GET":
        return (
            f"  // Node: {node_name} (httpRequest) — {method} {url}\n"
            f"  {{\n"
            f"    const _res_{slugify(node_name)} = await fetch(`{safe_url}`, {{\n"
            f"      method: 'GET',\n"
            f"      signal: AbortSignal.timeout(15000),\n"
            f"    }});\n"
            f"    const _text_{slugify(node_name)} = await _res_{slugify(node_name)}.text();\n"
            f"    results.push({{ node: {json.dumps(node_name)}, status: _res_{slugify(node_name)}.status, data: _text_{slugify(node_name)}.slice(0, 4000) }});\n"
            f"  }}"
        )
    else:
        body_val = params.get("body", params.get("bodyParameters", None))
        body_str = json.dumps(body_val) if body_val is not None else "null"
        return (
            f"  // Node: {node_name} (httpRequest) — {method} {url}\n"
            f"  {{\n"
            f"    const _body_{slugify(node_name)} = {body_str};\n"
            f"    const _res_{slugify(node_name)} = await fetch(`{safe_url}`, {{\n"
            f"      method: '{method}',\n"
            f"      headers: {{ 'Content-Type': 'application/json' }},\n"
            f"      body: _body_{slugify(node_name)} ? JSON.stringify(_body_{slugify(node_name)}) : undefined,\n"
            f"      signal: AbortSignal.timeout(15000),\n"
            f"    }});\n"
            f"    const _text_{slugify(node_name)} = await _res_{slugify(node_name)}.text();\n"
            f"    results.push({{ node: {json.dumps(node_name)}, status: _res_{slugify(node_name)}.status, data: _text_{slugify(node_name)}.slice(0, 4000) }});\n"
            f"  }}"
        )


def _gen_function(node_name: str, params: dict) -> str:
    # Le code JS est directement intégré
    raw_code = params.get("functionCode", params.get("jsCode", "// TODO: code n8n"))
    # Indenter chaque ligne du code embarqué
    indented = "\n".join("    " + line for line in raw_code.splitlines())
    return (
        f"  // Node: {node_name} (function) — code JS intégré\n"
        f"  {{\n"
        f"    let $input = {{ item: {{ json: params }} }};\n"
        f"    let $json = params;\n"
        f"{indented}\n"
        f"    results.push({{ node: {json.dumps(node_name)}, done: true }});\n"
        f"  }}"
    )


def _gen_execute_command(node_name: str, params: dict) -> str:
    command = sanitize_js_string(str(params.get("command", "")))
    # execSync est importé en haut du fichier (voir generate_skill_js)
    return (
        f"  // Node: {node_name} (executeCommand)\n"
        f"  {{\n"
        f"    const _out_{slugify(node_name)} = execSync(`{command}`, {{ encoding: 'utf8', timeout: 10000 }});\n"
        f"    results.push({{ node: {json.dumps(node_name)}, output: _out_{slugify(node_name)} }});\n"
        f"  }}"
    )


def _gen_read_file(node_name: str, params: dict) -> str:
    file_path = sanitize_js_string(str(params.get("filePath", params.get("fileSelector", "/tmp/input"))))
    # readFileSync est importé en haut du fichier (voir generate_skill_js)
    return (
        f"  // Node: {node_name} (readBinaryFiles)\n"
        f"  {{\n"
        f"    const _data_{slugify(node_name)} = readFileSync(`{file_path}`);\n"
        f"    results.push({{ node: {json.dumps(node_name)}, size: _data_{slugify(node_name)}.length }});\n"
        f"  }}"
    )


def _gen_write_file(node_name: str, params: dict) -> str:
    file_path = sanitize_js_string(str(params.get("fileName", params.get("filePath", "/tmp/output"))))
    # writeFileSync est importé en haut du fichier (voir generate_skill_js)
    return (
        f"  // Node: {node_name} (writeBinaryFile) — écrit dans {file_path}\n"
        f"  {{\n"
        f"    const _payload_{slugify(node_name)} = results.length > 0 ? JSON.stringify(results[results.length - 1]) : JSON.stringify(params);\n"
        f"    writeFileSync(`{file_path}`, _payload_{slugify(node_name)}, 'utf8');\n"
        f"    results.push({{ node: {json.dumps(node_name)}, written: `{file_path}` }});\n"
        f"  }}"
    )


def _gen_set(node_name: str, params: dict) -> str:
    values = params.get("values", params.get("keepOnlySet", {}))
    assignments = ""
    if isinstance(values, dict):
        for key, val in list(values.items())[:20]:  # limiter à 20 clés
            safe_key = re.sub(r"[^a-zA-Z0-9_]", "_", str(key))
            safe_val = json.dumps(val)
            assignments += f"    params['{safe_key}'] = {safe_val};\n"
    return (
        f"  // Node: {node_name} (set) — assignation de variables\n"
        f"  {{\n"
        f"{assignments}"
        f"    results.push({{ node: {json.dumps(node_name)}, params }});\n"
        f"  }}"
    )


def _gen_if(node_name: str, params: dict) -> str:
    condition = sanitize_js_string(str(params.get("conditions", {}).get("string", [{}])[0].get("value2", "true")))
    return (
        f"  // Node: {node_name} (if) — branchement conditionnel\n"
        f"  if ({json.dumps(condition)}) {{\n"
        f"    results.push({{ node: {json.dumps(node_name)}, branch: 'true' }});\n"
        f"  }} else {{\n"
        f"    results.push({{ node: {json.dumps(node_name)}, branch: 'false' }});\n"
        f"  }}"
    )


def _gen_switch(node_name: str, params: dict) -> str:
    mode = sanitize_js_string(str(params.get("mode", "expression")))
    return (
        f"  // Node: {node_name} (switch) — mode: {mode}\n"
        f"  switch ({json.dumps(mode)}) {{\n"
        f"    default:\n"
        f"      results.push({{ node: {json.dumps(node_name)}, branch: 'default' }});\n"
        f"  }}"
    )


def _gen_merge(node_name: str, params: dict) -> str:
    mode = str(params.get("mode", "append"))
    return (
        f"  // Node: {node_name} (merge) — mode: {mode}\n"
        f"  results.push({{ node: {json.dumps(node_name)}, merged: Object.assign({{}}, ...results.map(r => r)) }});"
    )


def _gen_wait(node_name: str, params: dict) -> str:
    # amount en secondes, convertir en ms
    amount = params.get("amount", 1)
    try:
        ms = int(float(amount) * 1000)
    except (TypeError, ValueError):
        ms = 1000
    ms = min(ms, 60000)  # plafond 60s
    return (
        f"  // Node: {node_name} (wait) — attente {ms}ms\n"
        f"  await new Promise(resolve => setTimeout(resolve, {ms}));\n"
        f"  results.push({{ node: {json.dumps(node_name)}, waited_ms: {ms} }});"
    )


def _gen_telegram(node_name: str, params: dict) -> str:
    # Ne pas inclure les tokens Telegram — utiliser une variable d'env
    chat_id = sanitize_js_string(str(params.get("chatId", "")))
    text = sanitize_js_string(str(params.get("text", "")))
    return (
        f"  // Node: {node_name} (telegram) — envoie un message Telegram\n"
        f"  // Token requis : variable d'environnement TELEGRAM_BOT_TOKEN\n"
        f"  {{\n"
        f"    const _tgToken = process.env.TELEGRAM_BOT_TOKEN || '';\n"
        f"    if (!_tgToken) throw new Error('TELEGRAM_BOT_TOKEN manquant');\n"
        f"    const _tgRes_{slugify(node_name)} = await fetch(\n"
        f"      `https://api.telegram.org/bot${{_tgToken}}/sendMessage`,\n"
        f"      {{\n"
        f"        method: 'POST',\n"
        f"        headers: {{ 'Content-Type': 'application/json' }},\n"
        f"        body: JSON.stringify({{ chat_id: `{chat_id}`, text: `{text}` }}),\n"
        f"        signal: AbortSignal.timeout(10000),\n"
        f"      }}\n"
        f"    );\n"
        f"    results.push({{ node: {json.dumps(node_name)}, ok: _tgRes_{slugify(node_name)}.ok }});\n"
        f"  }}"
    )


def _gen_google_sheets(node_name: str, params: dict) -> str:
    operation = str(params.get("operation", "append"))
    spreadsheet_id = sanitize_js_string(str(params.get("sheetId", params.get("spreadsheetId", ""))))
    return (
        f"  // Node: {node_name} (googleSheets) — opération: {operation}\n"
        f"  // Authentification Google : utiliser GOOGLE_ACCESS_TOKEN env\n"
        f"  {{\n"
        f"    const _gsToken = process.env.GOOGLE_ACCESS_TOKEN || '';\n"
        f"    if (!_gsToken) throw new Error('GOOGLE_ACCESS_TOKEN manquant');\n"
        f"    const _gsRes_{slugify(node_name)} = await fetch(\n"
        f"      `https://sheets.googleapis.com/v4/spreadsheets/{spreadsheet_id}/values/A1:append?valueInputOption=RAW`,\n"
        f"      {{\n"
        f"        method: 'POST',\n"
        f"        headers: {{\n"
        f"          'Authorization': `Bearer ${{_gsToken}}`,\n"
        f"          'Content-Type': 'application/json',\n"
        f"        }},\n"
        f"        body: JSON.stringify({{ values: [Object.values(params)] }}),\n"
        f"        signal: AbortSignal.timeout(15000),\n"
        f"      }}\n"
        f"    );\n"
        f"    results.push({{ node: {json.dumps(node_name)}, ok: _gsRes_{slugify(node_name)}.ok }});\n"
        f"  }}"
    )


def _gen_slack(node_name: str, params: dict) -> str:
    channel = sanitize_js_string(str(params.get("channel", "#general")))
    text = sanitize_js_string(str(params.get("text", "")))
    return (
        f"  // Node: {node_name} (slack) — poste dans {channel}\n"
        f"  // Token requis : SLACK_BOT_TOKEN env\n"
        f"  {{\n"
        f"    const _slToken = process.env.SLACK_BOT_TOKEN || '';\n"
        f"    if (!_slToken) throw new Error('SLACK_BOT_TOKEN manquant');\n"
        f"    const _slRes_{slugify(node_name)} = await fetch(\n"
        f"      'https://slack.com/api/chat.postMessage',\n"
        f"      {{\n"
        f"        method: 'POST',\n"
        f"        headers: {{\n"
        f"          'Authorization': `Bearer ${{_slToken}}`,\n"
        f"          'Content-Type': 'application/json',\n"
        f"        }},\n"
        f"        body: JSON.stringify({{ channel: `{channel}`, text: `{text}` }}),\n"
        f"        signal: AbortSignal.timeout(10000),\n"
        f"      }}\n"
        f"    );\n"
        f"    results.push({{ node: {json.dumps(node_name)}, ok: _slRes_{slugify(node_name)}.ok }});\n"
        f"  }}"
    )


def _gen_unknown(node_name: str, node_type: str, params: dict) -> str:
    """Fallback pour les types non mappés."""
    return (
        f"  // Node: {node_name} (type non supporté: {node_type})\n"
        f"  // Paramètres bruts: {json.dumps(params)[:200]}\n"
        f"  results.push({{ node: {json.dumps(node_name)}, skipped: true, reason: 'type non supporté: {node_type}' }});"
    )


# ─── DISPATCH ─────────────────────────────────────────────────────────────────

# Table de dispatch : node_type → fonction Python
_DISPATCH: dict = {
    "n8n-nodes-base.start":            _gen_start,
    "n8n-nodes-base.noOp":             _gen_noop,
    "n8n-nodes-base.webhook":          _gen_webhook,
    "n8n-nodes-base.respondToWebhook": _gen_respond_webhook,
    "n8n-nodes-base.httpRequest":      _gen_http_request,
    "n8n-nodes-base.function":         _gen_function,
    "n8n-nodes-base.executeCommand":   _gen_execute_command,
    "n8n-nodes-base.readBinaryFiles":  _gen_read_file,
    "n8n-nodes-base.writeBinaryFile":  _gen_write_file,
    "n8n-nodes-base.set":              _gen_set,
    "n8n-nodes-base.if":               _gen_if,
    "n8n-nodes-base.switch":           _gen_switch,
    "n8n-nodes-base.merge":            _gen_merge,
    "n8n-nodes-base.wait":             _gen_wait,
    "n8n-nodes-base.telegram":         _gen_telegram,
    "n8n-nodes-base.googleSheets":     _gen_google_sheets,
    "n8n-nodes-base.slack":            _gen_slack,
}


def generate_node_code(node: dict) -> str:
    node_type = node.get("type", "")
    node_name = node.get("name", "unknown")
    params = node.get("parameters", {})

    fn = _DISPATCH.get(node_type)
    if fn:
        return fn(node_name, params)
    return _gen_unknown(node_name, node_type, params)


# ─── GÉNÉRATION DU SKILL.JS ───────────────────────────────────────────────────

def _collect_imports(nodes_sorted: list[dict]) -> str:
    """
    Détermine les imports ESM de haut niveau nécessaires selon les node types présents.
    En ESM, les imports doivent être au niveau module — jamais dans un bloc.
    """
    node_types = {n.get("type", "") for n in nodes_sorted}
    imports: list[str] = []

    needs_fs = (
        "n8n-nodes-base.writeBinaryFile" in node_types
        or "n8n-nodes-base.readBinaryFiles" in node_types
    )
    needs_child = "n8n-nodes-base.executeCommand" in node_types

    if needs_fs and needs_child:
        imports.append("import { readFileSync, writeFileSync } from 'fs';")
        imports.append("import { execSync } from 'child_process';")
    elif needs_fs:
        imports.append("import { readFileSync, writeFileSync } from 'fs';")
    elif needs_child:
        imports.append("import { execSync } from 'child_process';")

    return "\n".join(imports)


def generate_skill_js(workflow_name: str, nodes_sorted: list[dict]) -> str:
    """Génère le contenu complet du fichier skill.js ESM."""
    imported_at = datetime.now(timezone.utc).isoformat()
    node_list = ", ".join(n.get("name", "?") for n in nodes_sorted)

    node_blocks = []
    for node in nodes_sorted:
        block = generate_node_code(node)
        node_blocks.append(block)

    nodes_code = "\n\n".join(node_blocks)
    top_imports = _collect_imports(nodes_sorted)
    imports_section = (top_imports + "\n") if top_imports else ""

    skill_js = f"""// Auto-généré depuis n8n workflow: {workflow_name}
// Nodes: {node_list}
// Importé le: {imported_at}
// NE PAS MODIFIER MANUELLEMENT — regénérer via import_n8n.py
{imports_section}
export async function run(params = {{}}) {{
  const results = [];

{nodes_code}

  return {{ success: true, results, workflow: {json.dumps(workflow_name)} }};
}}
"""
    return skill_js


# ─── GÉNÉRATION DU MANIFEST.JSON ─────────────────────────────────────────────

def generate_manifest(skill_name: str, workflow_name: str, nodes: list[dict]) -> dict:
    """Génère le manifest.json Ghost OS pour le skill importé."""
    return {
        "name": skill_name,
        "description": f"Importé depuis n8n workflow: {workflow_name}",
        "version": "1.0.0",
        "imported": True,
        "source": "n8n",
        "workflow_name": workflow_name,
        "node_count": len(nodes),
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "created": datetime.now(timezone.utc).isoformat(),
    }


# ─── CHARGEMENT DU WORKFLOW ───────────────────────────────────────────────────

def load_workflow_from_file(path: Path) -> dict:
    """Charge un workflow n8n depuis un fichier JSON local."""
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_workflow_from_url(url: str) -> dict:
    """
    Charge un workflow depuis une URL.
    Supporte les URLs GitHub raw et les API GitHub (avec GITHUB_TOKEN si disponible).
    Décode automatiquement le contenu base64 des réponses de l'API GitHub.
    """
    headers = {"Accept": "application/json"}
    github_token = os.environ.get("GITHUB_TOKEN", "")
    if github_token:
        headers["Authorization"] = f"Bearer {github_token}"

    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            raw = resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Erreur HTTP {e.code} lors du téléchargement de {url}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Impossible de contacter {url}: {e.reason}") from e

    data = json.loads(raw)

    # API GitHub : le contenu est en base64
    if isinstance(data, dict) and "content" in data and "encoding" in data:
        if data["encoding"] == "base64":
            content = base64.b64decode(data["content"]).decode("utf-8")
            return json.loads(content)

    return data


# ─── VALIDATION VIA EVOLUTION LAYER ──────────────────────────────────────────

def validate_skill_code(skill_js: str) -> tuple[bool, str]:
    """
    Envoie le code générné à l'Evolution layer (:8005) pour validation.
    Retourne (is_valid, message).
    """
    payload = json.dumps({"code": skill_js}).encode("utf-8")
    req = urllib.request.Request(
        EVOLUTION_VALIDATE_URL,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            result = json.loads(resp.read().decode("utf-8"))
            if result.get("valid") or result.get("success"):
                return True, result.get("message", "OK")
            return False, result.get("error", result.get("message", "Validation échouée"))
    except urllib.error.HTTPError as e:
        return False, f"Evolution layer HTTP {e.code}"
    except Exception as e:
        return False, f"Evolution layer inaccessible: {e}"


# ─── INSTALLATION DU SKILL ────────────────────────────────────────────────────

def install_skill(skill_name: str, skill_js: str, manifest: dict) -> Path:
    """
    Installe le skill dans skills/{skill_name}/ et met à jour registry.json.
    Retourne le chemin du dossier créé.
    """
    skill_dir = SKILLS_DIR / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)

    # Écrire skill.js
    skill_js_path = skill_dir / "skill.js"
    skill_js_path.write_text(skill_js, encoding="utf-8")

    # Écrire manifest.json
    manifest_path = skill_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    # Mettre à jour registry.json
    registry: dict = {"version": "1.1.0", "lastUpdated": "", "skills": []}
    if REGISTRY_PATH.exists():
        try:
            registry = json.loads(REGISTRY_PATH.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            pass

    entry = {
        "name": skill_name,
        "description": manifest["description"],
        "version": manifest["version"],
        "created": manifest["created"],
        "source": "n8n",
        "imported": True,
    }

    # Remplacer l'entrée existante ou en ajouter une nouvelle
    existing_idx = next(
        (i for i, s in enumerate(registry.get("skills", [])) if s.get("name") == skill_name),
        None,
    )
    if existing_idx is not None:
        registry["skills"][existing_idx] = entry
    else:
        registry.setdefault("skills", []).append(entry)

    registry["lastUpdated"] = datetime.now(timezone.utc).isoformat()
    REGISTRY_PATH.write_text(json.dumps(registry, indent=2), encoding="utf-8")

    return skill_dir


# ─── CONVERSION D'UN WORKFLOW ─────────────────────────────────────────────────

def convert_workflow(
    workflow: dict,
    skill_name_override: str | None = None,
    dry_run: bool = False,
    validate: bool = False,
    install: bool = False,
) -> dict:
    """
    Convertit un workflow n8n en skill Ghost OS.
    Retourne un dict de résultat : { success, skill_name, skill_js, manifest, ... }
    """
    workflow_name = workflow.get("name", "Unnamed Workflow")
    nodes: list[dict] = workflow.get("nodes", [])
    connections: dict = workflow.get("connections", {})

    if not nodes:
        return {"success": False, "error": f"Workflow '{workflow_name}' ne contient aucun node"}

    # Vérification de sécurité sur chaque node
    for node in nodes:
        is_safe, reason = check_node_security(node)
        if not is_safe:
            return {
                "success": False,
                "error": f"Sécurité : {reason}",
                "blocked_node": node.get("name"),
            }

    # Déduire le nom du skill
    skill_name = skill_name_override or slugify(workflow_name)

    # Tri topologique
    nodes_sorted = topological_sort(nodes, connections)

    # Génération du code
    skill_js = generate_skill_js(workflow_name, nodes_sorted)
    manifest = generate_manifest(skill_name, workflow_name, nodes)

    result: dict = {
        "success": True,
        "skill_name": skill_name,
        "workflow_name": workflow_name,
        "node_count": len(nodes),
        "skill_js": skill_js,
        "manifest": manifest,
        "installed": False,
        "validated": None,
    }

    if dry_run:
        print(f"\n{'='*60}")
        print(f"DRY-RUN — Skill: {skill_name}")
        print(f"Workflow: {workflow_name} ({len(nodes)} nodes)")
        print(f"{'='*60}")
        print(skill_js)
        print(f"{'='*60}")
        print("Manifest:")
        print(json.dumps(manifest, indent=2))
        return result

    # Validation optionnelle
    if validate:
        print(f"  → Validation via Evolution layer ({EVOLUTION_VALIDATE_URL})...")
        is_valid, msg = validate_skill_code(skill_js)
        result["validated"] = is_valid
        result["validation_message"] = msg
        if not is_valid:
            print(f"  ✗ Validation échouée: {msg}")
            result["success"] = False
            result["error"] = f"Validation échouée: {msg}"
            return result
        print(f"  ✓ Validation OK: {msg}")

    # Installation
    if install:
        skill_dir = install_skill(skill_name, skill_js, manifest)
        result["installed"] = True
        result["skill_dir"] = str(skill_dir)
        print(f"  ✓ Installé dans: {skill_dir}")
        print(f"  ✓ registry.json mis à jour")

    return result


# ─── CHARGEMENT DEPUIS UN DOSSIER ─────────────────────────────────────────────

def process_directory(
    dir_path: Path,
    install_all: bool = False,
    validate: bool = False,
    dry_run: bool = False,
) -> list[dict]:
    """Convertit tous les fichiers .json d'un dossier."""
    json_files = list(dir_path.glob("*.json"))
    if not json_files:
        print(f"Aucun fichier .json trouvé dans {dir_path}")
        return []

    results = []
    for json_file in json_files:
        print(f"\n→ Traitement: {json_file.name}")
        try:
            workflow = load_workflow_from_file(json_file)
            result = convert_workflow(
                workflow,
                dry_run=dry_run,
                validate=validate,
                install=install_all,
            )
            results.append(result)
            status = "✓" if result["success"] else "✗"
            print(f"  {status} {result.get('skill_name', '?')} — {result.get('error', 'OK')}")
        except Exception as e:
            print(f"  ✗ Erreur: {e}")
            results.append({"success": False, "error": str(e), "file": str(json_file)})

    return results


# ─── ENTRÉE PRINCIPALE ────────────────────────────────────────────────────────

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Importeur n8n → Ghost OS skill",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("workflow_file", nargs="?", help="Fichier JSON n8n à convertir")
    parser.add_argument("--name", help="Nom du skill généré")
    parser.add_argument("--install", action="store_true", help="Installe le skill après conversion")
    parser.add_argument("--install-all", action="store_true", help="Installe tous les workflows d'un dossier")
    parser.add_argument("--dir", help="Dossier contenant des fichiers .json n8n")
    parser.add_argument("--url", help="URL d'un fichier JSON n8n (GitHub ou raw)")
    parser.add_argument("--dry-run", action="store_true", help="Affiche le skill sans installer")
    parser.add_argument("--validate", action="store_true", help="Valide via Evolution layer (:8005)")
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    # ── Mode dossier ──────────────────────────────────────────────────────────
    if args.dir:
        dir_path = Path(args.dir)
        if not dir_path.is_dir():
            print(f"✗ Dossier introuvable: {dir_path}", file=sys.stderr)
            sys.exit(1)
        print(f"Ghost OS — Import n8n batch depuis: {dir_path}")
        results = process_directory(
            dir_path,
            install_all=args.install_all,
            validate=args.validate,
            dry_run=args.dry_run,
        )
        ok = sum(1 for r in results if r.get("success"))
        print(f"\nRésumé: {ok}/{len(results)} workflows convertis avec succès")
        sys.exit(0 if ok == len(results) else 1)

    # ── Mode URL ──────────────────────────────────────────────────────────────
    if args.url:
        print(f"Ghost OS — Import n8n depuis URL: {args.url}")
        try:
            workflow = load_workflow_from_url(args.url)
        except RuntimeError as e:
            print(f"✗ {e}", file=sys.stderr)
            sys.exit(1)

        result = convert_workflow(
            workflow,
            skill_name_override=args.name,
            dry_run=args.dry_run,
            validate=args.validate,
            install=args.install,
        )
        if not result["success"]:
            print(f"✗ Erreur: {result.get('error')}", file=sys.stderr)
            sys.exit(1)
        print(f"✓ Skill '{result['skill_name']}' converti depuis URL")
        sys.exit(0)

    # ── Mode fichier unique ───────────────────────────────────────────────────
    if not args.workflow_file:
        print("✗ Fournir un fichier JSON, --dir ou --url", file=sys.stderr)
        print("Usage: python3 scripts/import_n8n.py workflow.json [--dry-run] [--install]")
        sys.exit(1)

    workflow_path = Path(args.workflow_file)
    if not workflow_path.exists():
        print(f"✗ Fichier introuvable: {workflow_path}", file=sys.stderr)
        sys.exit(1)

    print(f"Ghost OS — Import n8n: {workflow_path.name}")
    try:
        workflow = load_workflow_from_file(workflow_path)
    except (json.JSONDecodeError, OSError) as e:
        print(f"✗ Impossible de lire {workflow_path}: {e}", file=sys.stderr)
        sys.exit(1)

    result = convert_workflow(
        workflow,
        skill_name_override=args.name,
        dry_run=args.dry_run,
        validate=args.validate,
        install=args.install,
    )

    if not result["success"]:
        print(f"✗ Erreur: {result.get('error')}", file=sys.stderr)
        sys.exit(1)

    print(f"✓ Skill '{result['skill_name']}' prêt ({result['node_count']} nodes)")
    if result.get("installed"):
        print(f"  → Installé dans: {result['skill_dir']}")
    elif not args.dry_run:
        print(f"  → Utiliser --install pour installer dans skills/")


if __name__ == "__main__":
    main()
