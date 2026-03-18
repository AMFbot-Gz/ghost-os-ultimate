"""
agent/ruche_bridge_server.py — Serveur FastAPI bridge vers les outils ruche-corps
Port : 8020

Stratégie :
  - Importe tools.builtins (déclenche l'enregistrement @tool de tous les 58 outils)
  - Expose /health, /tools, /tool/{tool_name}
  - Les outils async sont awaitables directement, les sync sont wrappés via asyncio.to_thread

Lancement :
  cd ~/Projects/ruche-corps && python3 ~/ghost-os-ultimate/agent/ruche_bridge_server.py
  ou via PM2 : pm2 start ruche_bridge_server.py --interpreter python3
"""

import asyncio
import os
import sys
import traceback

# ─── Path setup — doit être fait AVANT tout import ruche-corps ───────────────

RUCHE_CORPS_PATH = os.path.expanduser("~/Projects/ruche-corps")
sys.path.insert(0, RUCHE_CORPS_PATH)

# Variables d'environnement minimales requises par ruche-corps
os.environ.setdefault("RUCHE_HOME", os.path.expanduser("~/.ruche"))

# ─── Imports FastAPI ─────────────────────────────────────────────────────────

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import uvicorn

# ─── Import et initialisation du registre ruche-corps ───────────────────────

_import_error: str = ""

try:
    # Importer builtins déclenche tous les @tool decorators → registry se remplit
    import tools.builtins  # noqa: F401
    from tools.registry import registry
    _registry_ready = True
except Exception as _e:
    _import_error = f"{type(_e).__name__}: {_e}\n{traceback.format_exc()[-800:]}"
    _registry_ready = False
    registry = None

# ─── Application FastAPI ──────────────────────────────────────────────────────

app = FastAPI(
    title="ruche-bridge",
    description="Bridge FastAPI vers les 58 outils Python de ruche-corps",
    version="1.0.0",
)


# ─── Modèles Pydantic ─────────────────────────────────────────────────────────

class ToolCall(BaseModel):
    args: dict = {}


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.get("/health")
def health():
    """Santé du serveur et état du registre d'outils."""
    return {
        "status":         "ok",
        "service":        "ruche-bridge",
        "port":           8020,
        "registry_ready": _registry_ready,
        "tool_count":     len(registry._tools) if _registry_ready and registry else 0,
        "import_error":   _import_error or None,
        "ruche_path":     RUCHE_CORPS_PATH,
    }


@app.get("/tools")
def list_tools():
    """Liste de tous les outils disponibles avec leur catégorie et description."""
    if not _registry_ready or registry is None:
        return JSONResponse(
            status_code=503,
            content={"tools": [], "error": f"Registre non disponible: {_import_error}"},
        )
    tools_list = [
        {
            "name":        name,
            "description": meta.description,
            "category":    meta.category,
        }
        for name, meta in registry._tools.items()
    ]
    return {"tools": tools_list, "count": len(tools_list)}


@app.post("/tool/{tool_name}")
async def call_tool(tool_name: str, body: ToolCall):
    """
    Appelle un outil ruche-corps par nom.

    Body JSON : {"args": {"param1": "val1", ...}}
    Réponse   : {"success": true, "result": "...", "tool": "..."}
    """
    if not _registry_ready or registry is None:
        return JSONResponse(
            status_code=503,
            content={
                "success": False,
                "error":   f"Registre non disponible: {_import_error}",
                "tool":    tool_name,
            },
        )

    if tool_name not in registry._tools:
        available = registry.list_tools()
        return JSONResponse(
            status_code=404,
            content={
                "success":   False,
                "error":     f"Outil inconnu: {tool_name}",
                "available": available,
                "tool":      tool_name,
            },
        )

    result = await registry.execute(tool_name, body.args)

    if "error" in result:
        return JSONResponse(
            status_code=200,  # erreur métier, pas HTTP
            content={
                "success": False,
                "error":   result["error"],
                "trace":   result.get("trace"),
                "tool":    tool_name,
            },
        )

    return {
        "success": True,
        "result":  str(result.get("result", "")),
        "tool":    tool_name,
    }


@app.post("/tools/parallel")
async def call_tools_parallel(calls: list[ToolCall]):
    """
    Appels parallèles — accepte une liste de {tool_name, args}.
    Délègue à registry.execute_parallel.
    """
    if not _registry_ready or registry is None:
        return JSONResponse(
            status_code=503,
            content={"error": "Registre non disponible"},
        )
    # Normaliser en format attendu par execute_parallel
    formatted = [
        {"name": c.args.get("tool", ""), "arguments": c.args.get("args", {})}
        for c in calls
    ]
    results = await registry.execute_parallel(formatted)
    return {"results": results}


# ─── Entry point ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print(f"[ruche-bridge] Démarrage sur port 8020")
    print(f"[ruche-bridge] ruche-corps path : {RUCHE_CORPS_PATH}")
    if _registry_ready and registry:
        print(f"[ruche-bridge] {len(registry._tools)} outils chargés : {registry.list_tools()}")
    else:
        print(f"[ruche-bridge] ATTENTION — registre non chargé : {_import_error}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8020,
        log_level="info",
    )
