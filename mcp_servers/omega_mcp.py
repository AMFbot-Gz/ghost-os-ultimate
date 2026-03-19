#!/usr/bin/env python3
"""
omega_mcp.py — Serveur MCP pour Omega (agent auto-codeur)
==========================================================
Expose l'agent Omega comme serveur MCP JSON-RPC sur stdin/stdout.
PicoClaw et d'autres clients MCP peuvent dispatcher des missions.

Protocol MCP (Model Context Protocol) :
  → Client envoie JSON-RPC 2.0 sur stdin
  ← Serveur répond JSON-RPC 2.0 sur stdout

Outils exposés :
  - execute_mission(mission: str) → rapport complet
  - run_organ(name: str, params: dict) → résultat organe
  - list_organs() → liste des organes disponibles
  - self_code_organ(name: str, description: str) → créer un organe
  - see_screen(question: str) → analyser l'écran
"""

import sys
import json
import traceback
from pathlib import Path

# Ajouter le répertoire parent au path pour importer omega
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from omega import omega as ω


def mcp_response(req_id, result=None, error=None):
    """Construit une réponse JSON-RPC 2.0."""
    resp = {"jsonrpc": "2.0", "id": req_id}
    if error:
        resp["error"] = {"code": -32000, "message": str(error)}
    else:
        resp["result"] = result
    return json.dumps(resp, ensure_ascii=False)


def handle_request(req: dict) -> str:
    """Dispatch une requête MCP."""
    req_id = req.get("id")
    method = req.get("method", "")
    params = req.get("params", {})

    # Handshake MCP
    if method == "initialize":
        return mcp_response(req_id, {
            "protocolVersion": "2024-11-05",
            "serverInfo": {"name": "omega", "version": "1.0.0"},
            "capabilities": {"tools": {}}
        })

    if method == "tools/list":
        return mcp_response(req_id, {"tools": [
            {
                "name": "execute_mission",
                "description": "Exécute une mission complète de façon autonome. Planifie, auto-code les organes manquants, exécute avec contrôle souris/clavier/apps.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "mission": {"type": "string", "description": "Description de la mission à accomplir"}
                    },
                    "required": ["mission"]
                }
            },
            {
                "name": "run_organ",
                "description": "Exécute un organe spécifique du registre Omega.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Nom de l'organe"},
                        "params": {"type": "object", "description": "Paramètres de l'organe"}
                    },
                    "required": ["name"]
                }
            },
            {
                "name": "list_organs",
                "description": "Liste tous les organes disponibles dans le registre Omega.",
                "inputSchema": {"type": "object", "properties": {}}
            },
            {
                "name": "self_code_organ",
                "description": "Génère automatiquement un nouvel organe Python via Ollama.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Nom de l'organe à créer"},
                        "description": {"type": "string", "description": "Description de ce que fait l'organe"},
                        "context": {"type": "string", "description": "Contexte de la mission"}
                    },
                    "required": ["name", "description"]
                }
            },
            {
                "name": "see_screen",
                "description": "Capture et analyse visuellement l'écran avec llava:7b.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "question": {"type": "string", "description": "Question à poser sur l'écran"}
                    }
                }
            },
            {
                "name": "memory_search",
                "description": "Recherche sémantique dans les missions passées via ChromaDB (nomic-embed-text). Trouve des missions similaires exécutées par Omega.",
                "inputSchema": {
                    "type": "object",
                    "properties": {
                        "query": {"type": "string", "description": "Ce que tu cherches dans la mémoire"},
                        "limit": {"type": "integer", "description": "Nombre de résultats (défaut: 5)"}
                    },
                    "required": ["query"]
                }
            }
        ]})

    if method == "tools/call":
        tool_name = params.get("name", "")
        tool_params = params.get("arguments", {})

        try:
            if tool_name == "execute_mission":
                mission = tool_params.get("mission", "")
                if not mission:
                    return mcp_response(req_id, error="Paramètre 'mission' requis")
                rapport = ω.execute_mission(mission)
                return mcp_response(req_id, {
                    "content": [{"type": "text", "text": rapport}]
                })

            elif tool_name == "run_organ":
                name = tool_params.get("name", "")
                organ_params = tool_params.get("params", {})
                result = ω.run_organ(name, organ_params)
                return mcp_response(req_id, {
                    "content": [{"type": "text", "text": json.dumps(result, ensure_ascii=False)}]
                })

            elif tool_name == "list_organs":
                reg = ω.load_registry()
                organs_list = []
                for name, info in reg.items():
                    organs_list.append(f"🧠 {name} — {info['description']} (utilisé {info.get('uses', 0)}x)")
                text = "\n".join(organs_list) if organs_list else "Aucun organe enregistré"
                return mcp_response(req_id, {
                    "content": [{"type": "text", "text": text}]
                })

            elif tool_name == "self_code_organ":
                name = tool_params.get("name", "")
                description = tool_params.get("description", "")
                context = tool_params.get("context", "")
                if not name or not description:
                    return mcp_response(req_id, error="Paramètres 'name' et 'description' requis")
                success, path_or_err = ω.self_code_organ(name, description, context)
                text = f"✅ Organe '{name}' créé: {path_or_err}" if success else f"❌ Échec: {path_or_err}"
                return mcp_response(req_id, {
                    "content": [{"type": "text", "text": text}]
                })

            elif tool_name == "see_screen":
                question = tool_params.get("question", "")
                description = ω.see_screen()
                return mcp_response(req_id, {
                    "content": [{"type": "text", "text": description}]
                })

            elif tool_name == "memory_search":
                query = tool_params.get("query", "")
                limit = tool_params.get("limit", 5)
                if not query:
                    return mcp_response(req_id, error="Paramètre 'query' requis")
                results = ω.memory_search(query, limit)
                if not results:
                    text = "Aucune mission similaire trouvée en mémoire."
                else:
                    lines = [f"📚 {len(results)} résultats sémantiques pour '{query}':"]
                    for r in results:
                        content = r.get("content", r.get("mission", str(r)))[:200]
                        lines.append(f"• {content}")
                    text = "\n".join(lines)
                return mcp_response(req_id, {
                    "content": [{"type": "text", "text": text}]
                })

            else:
                return mcp_response(req_id, error=f"Outil inconnu: {tool_name}")

        except Exception as e:
            return mcp_response(req_id, error=f"Erreur: {traceback.format_exc()[:500]}")

    # Notifications (pas de réponse)
    if method in ("notifications/initialized",):
        return None

    return mcp_response(req_id, error=f"Méthode inconnue: {method}")


def main():
    """Boucle principale MCP sur stdin/stdout."""
    print("[OmegaMCP] 🚀 Serveur MCP Omega démarré", file=sys.stderr)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            response = handle_request(req)
            if response:
                print(response, flush=True)
        except json.JSONDecodeError as e:
            err = mcp_response(None, error=f"JSON invalide: {e}")
            print(err, flush=True)
        except Exception as e:
            err = mcp_response(None, error=f"Erreur serveur: {traceback.format_exc()[:300]}")
            print(err, flush=True)


if __name__ == "__main__":
    main()
