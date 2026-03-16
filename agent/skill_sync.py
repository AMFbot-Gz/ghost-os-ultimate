"""
Couche skill_sync — port 8017
Synchronisation des skills entre Ruche locale et Reine centrale.

Rôle :
  - Si REINE_URL est défini  → cette machine est une Ruche → synchro avec la Reine
  - Si REINE_URL est absent  → cette machine EST la Reine → mode hub passif

Comportement :
  - Au démarrage : pull tous les skills manquants ou obsolètes depuis la Reine
  - Toutes les 5 min : sync delta (only since last_sync)
  - POST /sync : sync manuelle immédiate
  - POST /publish/:name : publie un skill local vers la Reine
  - GET  /status : état de la synchro
  - GET  /health : healthcheck standard
"""

import json
import os
import asyncio
import httpx
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional
from dotenv import load_dotenv

load_dotenv()

# ─── Helpers machine ─────────────────────────────────────────────────────────

def _compute_machine_id() -> str:
    """ID stable basé sur hostname + adresse MAC."""
    import hashlib, socket, uuid
    raw = f"{socket.gethostname()}-{uuid.getnode()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


# ─── Config ──────────────────────────────────────────────────────────────────
REINE_URL       = os.getenv("REINE_URL", "").rstrip("/")       # ex: http://192.168.1.10:3000
MACHINE_ID      = os.getenv("MACHINE_ID") or _compute_machine_id()
RUCHE_ID        = os.getenv("RUCHE_ID") or f"ruche-{MACHINE_ID[:8]}"
SYNC_INTERVAL_S = int(os.getenv("SKILL_SYNC_INTERVAL", "300"))  # 5 min par défaut
ROOT            = Path(__file__).parent.parent
SKILLS_DIR      = ROOT / "skills"
REGISTRY_FILE   = SKILLS_DIR / "registry.json"

# ─── État interne ─────────────────────────────────────────────────────────────
_state = {
    "last_sync":       None,
    "last_sync_ok":    None,
    "pulled_total":    0,
    "pushed_total":    0,
    "errors":          [],
    "is_reine":        not bool(REINE_URL),
}


def _read_local_registry() -> dict:
    try:
        if REGISTRY_FILE.exists():
            return json.loads(REGISTRY_FILE.read_text("utf-8"))
    except Exception:
        pass
    return {"version": "1.0.0", "skills": []}


def _parse_version(v: str) -> tuple:
    """Retourne un tuple (major, minor, patch) pour comparaison."""
    parts = str(v or "0.0.0").split(".")
    try:
        return tuple(int(x) for x in parts[:3])
    except ValueError:
        return (0, 0, 0)


# ─── Sync logic ───────────────────────────────────────────────────────────────

async def _pull_skill(client: httpx.AsyncClient, name: str, hub_version: str) -> bool:
    """Télécharge un skill depuis le hub de la Reine et l'installe localement."""
    try:
        # Télécharge code + manifest en parallèle
        code_r, manifest_r = await asyncio.gather(
            client.get(f"{REINE_URL}/api/v1/hub/skills/{name}/code", timeout=15),
            client.get(f"{REINE_URL}/api/v1/hub/skills/{name}/manifest", timeout=10),
            return_exceptions=True,
        )

        if isinstance(code_r, Exception) or code_r.status_code != 200:
            return False

        code_data = code_r.json()
        if not code_data.get("ok") or not code_data.get("code"):
            return False

        skill_dir = SKILLS_DIR / name
        skill_dir.mkdir(parents=True, exist_ok=True)

        # Écriture atomique du code
        tmp = skill_dir / ".skill.js.tmp"
        tmp.write_text(code_data["code"], "utf-8")
        tmp.rename(skill_dir / "skill.js")

        # Manifest (optionnel)
        if not isinstance(manifest_r, Exception) and manifest_r.status_code == 200:
            mdata = manifest_r.json()
            if mdata.get("ok") and mdata.get("manifest"):
                tmp_m = skill_dir / ".manifest.json.tmp"
                tmp_m.write_text(json.dumps(mdata["manifest"], indent=2, ensure_ascii=False), "utf-8")
                tmp_m.rename(skill_dir / "manifest.json")

        print(f"[SkillSync] ↓ Pulled: {name} v{hub_version}")
        return True

    except Exception as e:
        print(f"[SkillSync] Erreur pull {name}: {e}")
        return False


async def _push_skill(client: httpx.AsyncClient, name: str) -> bool:
    """Publie un skill local vers le hub de la Reine."""
    skill_dir = SKILLS_DIR / name
    skill_file = skill_dir / "skill.js"
    manifest_file = skill_dir / "manifest.json"

    if not skill_file.exists():
        return False

    try:
        code = skill_file.read_text("utf-8")
        manifest = {}
        if manifest_file.exists():
            manifest = json.loads(manifest_file.read_text("utf-8"))

        version = manifest.get("version", "1.0.0")

        payload = {
            "name":       name,
            "version":    version,
            "code":       code,
            "manifest":   manifest,
            "machine_id": MACHINE_ID,
            "ruche_id":   RUCHE_ID,
        }

        r = await client.post(
            f"{REINE_URL}/api/v1/hub/skills/publish",
            json=payload,
            timeout=20,
        )

        if r.status_code == 200 and r.json().get("ok"):
            print(f"[SkillSync] ↑ Pushed: {name} v{version}")
            return True

        print(f"[SkillSync] Push {name} refusé: {r.text[:200]}")
        return False

    except Exception as e:
        print(f"[SkillSync] Erreur push {name}: {e}")
        return False


async def _update_local_registry(pulled_names: list[str]) -> None:
    """Ajoute les skills pullés dans le registry local s'ils n'y sont pas."""
    if not pulled_names:
        return
    try:
        reg = _read_local_registry()
        existing = {s["name"] for s in reg.get("skills", [])}
        for name in pulled_names:
            if name not in existing:
                manifest_file = SKILLS_DIR / name / "manifest.json"
                entry = {"name": name, "version": "1.0.0", "created": datetime.utcnow().isoformat()}
                if manifest_file.exists():
                    try:
                        m = json.loads(manifest_file.read_text("utf-8"))
                        entry.update({k: m[k] for k in ("version", "description") if k in m})
                    except Exception:
                        pass
                reg["skills"].append(entry)

        reg["lastUpdated"] = datetime.utcnow().isoformat()
        tmp = REGISTRY_FILE.parent / ".registry.tmp"
        tmp.write_text(json.dumps(reg, indent=2, ensure_ascii=False), "utf-8")
        tmp.rename(REGISTRY_FILE)
    except Exception as e:
        print(f"[SkillSync] Erreur mise à jour registry local: {e}")


async def run_sync(since: Optional[str] = None) -> dict:
    """
    Effectue une synchronisation complète avec la Reine :
    1. Pull les skills que la Reine a mais la Ruche n'a pas (ou version inférieure)
    2. Push les skills locaux que la Reine n'a pas (ou version inférieure)
    """
    if _state["is_reine"]:
        return {"ok": True, "message": "Cette machine est la Reine — pas de sync nécessaire"}

    if not REINE_URL:
        return {"ok": False, "error": "REINE_URL non configuré"}

    pulled, pushed, errors = [], [], []

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            # ── Récupérer le registry de la Reine ──────────────────────────
            params = {"since": since} if since else {}
            r = await client.get(f"{REINE_URL}/api/v1/hub/registry", params=params, timeout=15)
            if r.status_code != 200:
                raise RuntimeError(f"Registry Reine inaccessible: HTTP {r.status_code}")

            hub_skills = r.json().get("skills", [])
            local_reg  = _read_local_registry()
            local_map  = {s["name"]: s for s in local_reg.get("skills", [])}

            # ── PULL : skills hub > local ──────────────────────────────────
            pull_tasks = []
            for hub_skill in hub_skills:
                name        = hub_skill["name"]
                hub_version = hub_skill.get("version", "1.0.0")
                local_ver   = local_map.get(name, {}).get("version", "0.0.0")

                if _parse_version(hub_version) > _parse_version(local_ver):
                    pull_tasks.append((name, hub_version))

            for name, hub_version in pull_tasks:
                ok = await _pull_skill(client, name, hub_version)
                if ok:
                    pulled.append(name)
                else:
                    errors.append(f"pull:{name}")

            # ── PUSH : skills locaux > hub ─────────────────────────────────
            hub_map = {s["name"]: s for s in hub_skills}
            for local_skill in local_reg.get("skills", []):
                name      = local_skill["name"]
                local_ver = local_skill.get("version", "1.0.0")
                hub_ver   = hub_map.get(name, {}).get("version", "0.0.0")

                if _parse_version(local_ver) > _parse_version(hub_ver):
                    ok = await _push_skill(client, name)
                    if ok:
                        pushed.append(name)
                    else:
                        errors.append(f"push:{name}")

    except Exception as e:
        errors.append(str(e))
        _state["errors"] = (_state["errors"] + [str(e)])[-20:]  # garder les 20 dernières erreurs

    # ── Mise à jour du registry local avec les nouveaux skills ──────────────
    await _update_local_registry(pulled)

    now = datetime.utcnow().isoformat()
    _state["last_sync"]    = now
    _state["last_sync_ok"] = len(errors) == 0
    _state["pulled_total"] += len(pulled)
    _state["pushed_total"] += len(pushed)

    return {
        "ok":     len(errors) == 0,
        "pulled": pulled,
        "pushed": pushed,
        "errors": errors,
        "at":     now,
    }


# ─── Boucle de sync automatique ───────────────────────────────────────────────

async def _auto_sync_loop():
    """Tourne en arrière-plan, synchro toutes les SYNC_INTERVAL_S secondes."""
    if _state["is_reine"]:
        print("[SkillSync] Mode Reine — boucle sync inactive")
        return

    await asyncio.sleep(10)  # attente initiale au boot
    while True:
        try:
            since = _state.get("last_sync")
            result = await run_sync(since=since)
            if result.get("pulled") or result.get("pushed"):
                print(f"[SkillSync] Auto-sync: ↓{len(result['pulled'])} pulled, ↑{len(result['pushed'])} pushed")
        except Exception as e:
            print(f"[SkillSync] Erreur boucle auto: {e}")
        await asyncio.sleep(SYNC_INTERVAL_S)


# ─── API FastAPI ──────────────────────────────────────────────────────────────

app = FastAPI(title="SkillSync", version="1.0.0")


@app.on_event("startup")
async def startup():
    # Sync initiale au démarrage (non-bloquant)
    asyncio.create_task(_auto_sync_loop())
    if not _state["is_reine"]:
        asyncio.create_task(_initial_sync())


async def _initial_sync():
    await asyncio.sleep(3)  # laisse les autres layers démarrer
    result = await run_sync()
    if result.get("pulled"):
        print(f"[SkillSync] Sync initiale: {len(result['pulled'])} skills récupérés de la Reine")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "mode":   "reine" if _state["is_reine"] else "ruche",
        "reine_url": REINE_URL or None,
        "machine_id": MACHINE_ID,
        "ruche_id":   RUCHE_ID,
    }


@app.post("/sync")
async def manual_sync(background_tasks: BackgroundTasks):
    """Déclenche une sync immédiate (non-bloquante, résultat via /status)."""
    background_tasks.add_task(_run_sync_background)
    return {"ok": True, "message": "Sync démarrée en arrière-plan"}


async def _run_sync_background():
    result = await run_sync()
    print(f"[SkillSync] Sync manuelle: pulled={result.get('pulled')}, pushed={result.get('pushed')}")


@app.post("/publish/{name}")
async def publish_skill(name: str):
    """Publie immédiatement un skill local vers la Reine."""
    if _state["is_reine"]:
        raise HTTPException(status_code=400, detail="Cette machine est la Reine")
    if not REINE_URL:
        raise HTTPException(status_code=400, detail="REINE_URL non configuré")

    async with httpx.AsyncClient(timeout=20) as client:
        ok = await _push_skill(client, name)

    if not ok:
        raise HTTPException(status_code=500, detail=f"Échec publication de '{name}'")

    _state["pushed_total"] += 1
    return {"ok": True, "name": name, "machine_id": MACHINE_ID}


@app.get("/status")
async def status():
    local_reg = _read_local_registry()
    return {
        "ok":           True,
        "mode":         "reine" if _state["is_reine"] else "ruche",
        "machine_id":   MACHINE_ID,
        "ruche_id":     RUCHE_ID,
        "reine_url":    REINE_URL or None,
        "local_skills": len(local_reg.get("skills", [])),
        "last_sync":    _state["last_sync"],
        "last_sync_ok": _state["last_sync_ok"],
        "pulled_total": _state["pulled_total"],
        "pushed_total": _state["pushed_total"],
        "recent_errors": _state["errors"][-5:],
        "sync_interval_s": SYNC_INTERVAL_S,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("skill_sync:app", host="0.0.0.0", port=8019, reload=False)
