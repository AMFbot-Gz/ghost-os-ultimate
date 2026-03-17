"""
Couche mémoire — port 8006
Mémoire épisodique JSONL + ChromaDB sémantique + world state

Architecture :
  - JSONL            → source de vérité, lecture rapide, append-only
  - ChromaDB         → index vectoriel pour recherche sémantique (nomic-embed-text via Ollama)
  - Fallback         → si ChromaDB indisponible, retour à la recherche par mots-clés
  - World state      → JSON partagé entre les couches
"""
import json
import os
import asyncio
import tempfile
import hashlib
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, Query
from pydantic import BaseModel
from typing import Optional, List, Any
import httpx
import yaml
from dotenv import load_dotenv
load_dotenv()

# ─── ChromaDB — import optionnel ──────────────────────────────────────────
try:
    import chromadb
    _CHROMA_AVAILABLE = True
except ImportError:
    _CHROMA_AVAILABLE = False

ROOT = Path(__file__).resolve().parent.parent

with open(ROOT / "agent_config.yml") as f:
    CONFIG = yaml.safe_load(f)

app = FastAPI(title="PICO-RUCHE Memory", version="2.0.0")

EPISODE_FILE     = ROOT / CONFIG["memory"]["episode_file"]
EPISODES_FILE    = EPISODE_FILE  # alias Phase 28
PERSISTENT_FILE  = ROOT / CONFIG["memory"]["persistent_file"]
WORLD_STATE_FILE = ROOT / CONFIG["memory"]["world_state_file"]
MAX_EPISODES     = CONFIG["memory"]["max_episodes"]
OLLAMA_URL       = CONFIG["ollama"]["base_url"]
EMBED_MODEL      = "nomic-embed-text"
CHROMA_DIR       = ROOT / "agent" / "memory" / "chromadb"
CHROMA_PATH      = Path(__file__).parent / "chroma_db"   # alias Phase 28
CHROMA_COLLECTION= "ghost_os_episodes"
ARCHIVE_FILE     = EPISODE_FILE.parent / "episodes_archive.jsonl"

EPISODE_FILE.parent.mkdir(parents=True, exist_ok=True)
CHROMA_DIR.mkdir(parents=True, exist_ok=True)
if not EPISODE_FILE.exists():
    EPISODE_FILE.write_text("")
if not WORLD_STATE_FILE.exists():
    WORLD_STATE_FILE.write_text("{}")

_FILE_LOCK       = asyncio.Lock()
_corruption_count = 0

# ─── ChromaDB — init non-bloquant ─────────────────────────────────────────

_chroma_client     = None
_chroma_collection = None
_chroma_ready      = False


def _init_chroma() -> bool:
    """Initialise ChromaDB avec stockage persistant local.
    Retourne True si succès, False si ChromaDB indisponible (dégradé silencieux).
    """
    global _chroma_client, _chroma_collection, _chroma_ready
    if not _CHROMA_AVAILABLE:
        print("[Memory] ⚠️  ChromaDB non installé (mode dégradé mots-clés)")
        _chroma_ready = False
        return False
    try:
        _chroma_client = chromadb.PersistentClient(path=str(CHROMA_DIR))
        _chroma_collection = _chroma_client.get_or_create_collection(
            name=CHROMA_COLLECTION,
            metadata={"hnsw:space": "cosine"},  # distance cosine pour la similarité sémantique
        )
        _chroma_ready = True
        count = _chroma_collection.count()
        print(f"[Memory] ✅ ChromaDB initialisé — {count} épisodes indexés dans '{CHROMA_COLLECTION}'")
        return True
    except Exception as e:
        print(f"[Memory] ⚠️  ChromaDB indisponible (mode dégradé mots-clés): {e}")
        _chroma_ready = False
        return False


async def _get_embedding(text: str) -> Optional[List[float]]:
    """Génère un embedding via Ollama nomic-embed-text.
    Retourne None si le modèle est indisponible (fallback silencieux).
    """
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.post(
                f"{OLLAMA_URL}/api/embeddings",
                json={"model": EMBED_MODEL, "prompt": text[:2000]},
            )
            r.raise_for_status()
            embedding = r.json().get("embedding")
            if not embedding:
                return None
            return embedding
    except Exception as e:
        print(f"[Memory] Embedding error: {e}")
        return None


def _episode_id(episode: dict) -> str:
    """ID déterministe basé sur mission + timestamp (évite les doublons)."""
    key = f"{episode.get('mission', '')}|{episode.get('timestamp', '')}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def _episode_to_text(ep: dict) -> str:
    """Concatène les champs pertinents pour l'embedding."""
    parts = [
        ep.get("mission", ""),
        ep.get("result", ""),
        ep.get("learned", "") or "",
    ]
    return " ".join(p for p in parts if p).strip()[:1500]


async def _index_episode(episode: dict) -> bool:
    """Indexe un épisode dans ChromaDB de manière asynchrone.
    Retourne True si succès, False sinon (silencieux).
    """
    if not _chroma_ready or _chroma_collection is None:
        return False
    try:
        text = _episode_to_text(episode)
        if not text:
            return False
        embedding = await _get_embedding(text)
        if not embedding:
            return False

        ep_id = _episode_id(episode)
        # Métadonnées stockées pour reconstruction sans re-lire le JSONL
        metadata = {
            "timestamp":   episode.get("timestamp", ""),
            "success":     str(episode.get("success", False)),
            "duration_ms": str(episode.get("duration_ms", 0)),
            "model_used":  episode.get("model_used", ""),
            "machine_id":  episode.get("machine_id", ""),
            "skills_used": ",".join(episode.get("skills_used", [])),
        }

        # upsert — évite les doublons si on ré-indexe
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: _chroma_collection.upsert(
                ids=[ep_id],
                embeddings=[embedding],
                documents=[text],
                metadatas=[metadata],
            )
        )
        return True
    except Exception as e:
        print(f"[Memory] Index error: {e}")
        return False


async def _index_episode_chroma(episode: dict) -> bool:
    """Alias Phase 28 — indexe un épisode dans ChromaDB (délègue à _index_episode)."""
    return await _index_episode(episode)


async def semantic_search(query: str, n_results: int = 5, min_similarity: float = 0.3) -> List[dict]:
    """Recherche sémantique dans ChromaDB.
    Retourne les épisodes JSONL correspondants par similarité cosine.
    """
    if not _chroma_ready or _chroma_collection is None:
        return []
    try:
        embedding = await _get_embedding(query)
        if not embedding:
            return []

        count = _chroma_collection.count()
        if count == 0:
            return []

        loop = asyncio.get_event_loop()
        results = await loop.run_in_executor(
            None,
            lambda: _chroma_collection.query(
                query_embeddings=[embedding],
                n_results=min(n_results, count),
                include=["documents", "metadatas", "distances"],
            )
        )

        hits = []
        ids        = results.get("ids", [[]])[0]
        documents  = results.get("documents", [[]])[0]
        metadatas  = results.get("metadatas", [[]])[0]
        distances  = results.get("distances", [[]])[0]

        for ep_id, doc, meta, dist in zip(ids, documents, metadatas, distances):
            # ChromaDB cosine → distance [0,2], similarity = 1 - dist/2
            similarity = 1.0 - (dist / 2.0)
            if similarity < min_similarity:
                continue
            hits.append({
                "id":         ep_id,
                "mission":    doc.split(" ")[0:10],   # extrait rapide
                "document":   doc,
                "similarity": round(similarity, 3),
                "success":    meta.get("success") == "True",
                "timestamp":  meta.get("timestamp", ""),
                "model_used": meta.get("model_used", ""),
                "machine_id": meta.get("machine_id", ""),
            })

        # Trier par similarité décroissante
        hits.sort(key=lambda x: x["similarity"], reverse=True)
        return hits

    except Exception as e:
        print(f"[Memory] Semantic search error: {e}")
        return []


async def _reindex_all() -> int:
    """Ré-indexe tous les épisodes JSONL dans ChromaDB (migration ou rebuild).
    Retourne le nombre d'épisodes indexés.
    """
    if not _chroma_ready:
        return 0
    episodes = _read_episodes_safe(EPISODE_FILE)
    indexed = 0
    for ep in episodes:
        ok = await _index_episode(ep)
        if ok:
            indexed += 1
    print(f"[Memory] 🔄 Ré-indexation: {indexed}/{len(episodes)} épisodes indexés dans ChromaDB")
    return indexed


# ─── JSONL helpers ────────────────────────────────────────────────────────

class Episode(BaseModel):
    mission:    str
    result:     str
    success:    bool
    duration_ms: int
    model_used: str
    skills_used: List[str] = []
    learned:    Optional[str] = None
    machine_id: str = ""


class WorldStateUpdate(BaseModel):
    key:   str
    value: Any


class SemanticSearchRequest(BaseModel):
    query:          str
    n_results:      int = 5
    min_similarity: float = 0.3


def atomic_write_json(filepath, data) -> None:
    """Écriture atomique JSON via fichier temp + rename."""
    path = Path(filepath)
    fd, tmp_path = tempfile.mkstemp(dir=str(path.parent.resolve()), suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, str(path))
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _read_episodes_safe(filepath: Path) -> list:
    """Lit episodes.jsonl en sautant les lignes corrompues."""
    global _corruption_count
    episodes = []
    if not filepath.exists():
        return episodes
    for line in filepath.read_text(encoding="utf-8").strip().split("\n"):
        line = line.strip()
        if not line:
            continue
        try:
            episodes.append(json.loads(line))
        except json.JSONDecodeError as e:
            _corruption_count += 1
            print(f"[Memory] Ligne corrompue ignorée: {e} — {line[:80]}")
            if _corruption_count > 10:
                print(f"[Memory] ⚠️ ALERTE: {_corruption_count} lignes corrompues dans {filepath.name}")
                _corruption_count = 0
    return episodes


async def _trim_unlocked(filepath: Path, max_ep: int) -> None:
    """Trim JSONL — doit être appelé sous _FILE_LOCK."""
    try:
        if not filepath.exists():
            return
        lines = [l for l in filepath.read_text(encoding="utf-8").splitlines() if l.strip()]
        if len(lines) <= max_ep:
            return
        to_archive = lines[:-max_ep]
        kept = lines[-max_ep:]
        archive_path = filepath.parent / "episodes_archive.jsonl"
        try:
            # Écriture atomique pour l'archive (Phase 23)
            archive_tmp = Path(str(archive_path) + '.tmp')
            existing_archive = archive_path.read_text(encoding='utf-8') if archive_path.exists() else ''
            new_lines = "\n".join(to_archive) + "\n"
            archive_tmp.write_text(existing_archive + new_lines, encoding='utf-8')
            archive_tmp.replace(archive_path)
            print(f"[Memory] 📦 Archivage: {len(to_archive)} épisodes")
        except Exception as arch_err:
            print(f"[Memory] ⚠️  Archive error: {arch_err}")
        tmp_path = filepath.with_suffix(".tmp")
        tmp_path.write_text("\n".join(kept) + "\n", encoding="utf-8")
        os.replace(tmp_path, filepath)
        print(f"[Memory] 🗑️  Trim: {len(lines)} → {len(kept)}")
    except Exception as e:
        print(f"[Memory] ⚠️  Trim error: {e}")


# ─── Startup ───────────────────────────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Init ChromaDB au démarrage + ré-indexation si collection vide."""
    loop = asyncio.get_event_loop()
    chroma_ok = await loop.run_in_executor(None, _init_chroma)

    if chroma_ok and _chroma_collection is not None:
        count = await loop.run_in_executor(None, _chroma_collection.count)
        if count == 0:
            episodes = _read_episodes_safe(EPISODE_FILE)
            if episodes:
                print(f"[Memory] 🔄 Collection vide — ré-indexation de {len(episodes)} épisodes existants...")
                asyncio.create_task(_reindex_all())
            else:
                print("[Memory] ℹ️  Collection vide, aucun épisode à indexer pour l'instant.")


# ─── Endpoints ────────────────────────────────────────────────────────────

@app.post("/episode")
async def save_episode(episode: Episode):
    async with _FILE_LOCK:
        entry = {"timestamp": datetime.utcnow().isoformat(), **episode.model_dump()}
        # Écriture atomique — épisode JSONL (Phase 23)
        tmp = Path(str(EPISODE_FILE) + '.tmp')
        existing = EPISODE_FILE.read_text(encoding='utf-8') if EPISODE_FILE.exists() else ''
        tmp.write_text(existing + json.dumps(entry, ensure_ascii=False) + '\n', encoding='utf-8')
        tmp.replace(EPISODE_FILE)
        await _trim_unlocked(EPISODE_FILE, MAX_EPISODES)
        if episode.learned:
            # Écriture atomique — profil persistant (Phase 23)
            learned_line = f"\n### {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} — Apprentissage\n{episode.learned}\n"
            tmp_p = Path(str(PERSISTENT_FILE) + '.tmp')
            existing_p = PERSISTENT_FILE.read_text(encoding='utf-8') if PERSISTENT_FILE.exists() else ''
            tmp_p.write_text(existing_p + learned_line, encoding='utf-8')
            tmp_p.replace(PERSISTENT_FILE)
        episodes = _read_episodes_safe(EPISODE_FILE)

    # Indexation ChromaDB en arrière-plan (non-bloquant)
    asyncio.create_task(_index_episode(entry))

    return {"saved": True, "total_episodes": len(episodes), "indexed_in_chroma": _chroma_ready}


@app.get("/episodes")
async def get_episodes(limit: int = 20):
    async with _FILE_LOCK:
        episodes = _read_episodes_safe(EPISODE_FILE)
    # Ajoute _id à chaque épisode pour permettre la suppression depuis le dashboard
    enriched = [{"_id": _episode_id(ep), **ep} for ep in reversed(episodes[-limit:])]
    return {"episodes": enriched}


@app.post("/search")
async def search_episodes(query: dict):
    """Recherche hybride : sémantique ChromaDB si disponible, sinon mots-clés."""
    keywords = query.get("keywords", [])
    machine  = query.get("machine_id", "")
    text_q   = " ".join(keywords)

    # ── Recherche sémantique ChromaDB ─────────────────────────────────────
    if _chroma_ready and text_q:
        hits = await semantic_search(text_q, n_results=10)
        if hits:
            # Récupère les épisodes JSONL complets pour les hits sémantiques
            all_eps   = _read_episodes_safe(EPISODE_FILE)
            hits_docs = {h["document"] for h in hits}
            # Retrouve les épisodes JSONL correspondants par texte similaire
            results = []
            for ep in all_eps:
                if machine and ep.get("machine_id", "") not in ("", machine):
                    continue
                ep_text = _episode_to_text(ep)
                # Match si le texte de l'épisode correspond à un hit ChromaDB
                if any(ep_text[:100] in doc or doc[:100] in ep_text for doc in hits_docs):
                    results.append(ep)
            if results:
                return {"results": results[-10:], "method": "semantic", "hits": len(hits)}

    # ── Fallback : recherche par mots-clés ────────────────────────────────
    results = []
    for ep in _read_episodes_safe(EPISODE_FILE):
        if machine and ep.get("machine_id", "") not in ("", machine):
            continue
        ep_text = (ep.get("mission", "") + ep.get("result", "") + (ep.get("learned") or "")).lower()
        if not keywords or any(k.lower() in ep_text for k in keywords):
            results.append(ep)
    return {"results": results[-10:], "method": "keywords"}


@app.post("/semantic_search")
async def semantic_search_endpoint(req: SemanticSearchRequest):
    """Recherche sémantique pure par similarité cosine (ChromaDB + nomic-embed-text).

    Retourne les épisodes les plus similaires à la requête, triés par score.
    """
    if not _chroma_ready:
        return {
            "results": [],
            "error":   "ChromaDB non disponible — utilise /search (mots-clés)",
            "chroma_ready": False,
        }

    hits = await semantic_search(req.query, req.n_results, req.min_similarity)

    # Enrichir avec le contenu JSONL complet
    if hits:
        all_eps = _read_episodes_safe(EPISODE_FILE)
        enriched = []
        for hit in hits:
            # Trouver l'épisode JSONL correspondant
            matching = next(
                (ep for ep in all_eps if _episode_to_text(ep)[:100] in hit["document"]
                 or hit["document"][:100] in _episode_to_text(ep)),
                None
            )
            # Injecte _id dans l'épisode JSONL pour permettre la suppression
            ep_with_id = {"_id": hit["id"], **matching} if matching else None
            enriched.append({
                **hit,
                "episode": ep_with_id,
            })
        return {
            "results":     enriched,
            "query":       req.query,
            "total_found": len(enriched),
            "chroma_ready": True,
            "embed_model": EMBED_MODEL,
        }

    return {
        "results":     [],
        "query":       req.query,
        "total_found": 0,
        "chroma_ready": True,
        "embed_model": EMBED_MODEL,
    }


@app.get("/semantic_search")
async def semantic_search_get(q: str = Query(...), n: int = Query(5)):
    """Recherche sémantique dans les épisodes via ChromaDB (GET, Phase 28)."""
    if not _chroma_collection:
        return {"results": [], "backend": "unavailable", "query": q}
    try:
        results = _chroma_collection.query(
            query_texts=[q],
            n_results=min(n, _chroma_collection.count() or 1),
        )
        episodes = []
        for i, doc in enumerate(results['documents'][0]):
            episodes.append({
                "id": results['ids'][0][i],
                "text": doc,
                "distance": results['distances'][0][i] if 'distances' in results else None,
                "metadata": results['metadatas'][0][i],
            })
        return {"results": episodes, "backend": "chromadb", "query": q, "count": len(episodes)}
    except Exception as e:
        return {"results": [], "backend": "error", "error": str(e)}


@app.post("/reindex")
async def reindex():
    """Force une ré-indexation complète des épisodes JSONL dans ChromaDB."""
    if not _chroma_ready:
        return {"error": "ChromaDB non disponible"}
    asyncio.create_task(_reindex_all())
    episodes_count = len(_read_episodes_safe(EPISODE_FILE))
    return {
        "started": True,
        "episodes_to_index": episodes_count,
        "message": "Ré-indexation lancée en arrière-plan",
    }


@app.get("/episodes/by_machine/{machine_id}")
async def get_episodes_by_machine(machine_id: str, limit: int = 20):
    async with _FILE_LOCK:
        all_eps = _read_episodes_safe(EPISODE_FILE)
    filtered = [ep for ep in all_eps if ep.get("machine_id", "") in ("", machine_id)]
    return {"machine_id": machine_id, "episodes": list(reversed(filtered[-limit:]))}


@app.get("/world")
async def get_world_state():
    return json.loads(WORLD_STATE_FILE.read_text(encoding="utf-8"))


@app.post("/world")
async def update_world_state(update: WorldStateUpdate):
    state = json.loads(WORLD_STATE_FILE.read_text(encoding="utf-8"))
    state[update.key] = update.value
    state["last_updated"] = datetime.utcnow().isoformat()
    atomic_write_json(WORLD_STATE_FILE, state)
    return {"updated": True}


@app.get("/profile")
async def get_profile():
    profile = PERSISTENT_FILE.read_text(encoding="utf-8") if PERSISTENT_FILE.exists() else "Aucun profil."
    episodes_count = len(_read_episodes_safe(EPISODE_FILE))
    chroma_count = 0
    if _chroma_ready and _chroma_collection:
        try:
            loop = asyncio.get_event_loop()
            chroma_count = await loop.run_in_executor(None, _chroma_collection.count)
        except Exception:
            pass
    return {
        "profile":         profile,
        "total_episodes":  episodes_count,
        "chroma_indexed":  chroma_count,
        "chroma_ready":    _chroma_ready,
    }


@app.delete("/episode/{episode_id}")
async def delete_episode(episode_id: str):
    """Supprime un épisode par son ID (hash SHA256 16 chars) depuis JSONL et ChromaDB."""
    deleted_jsonl = False
    deleted_chroma = False

    async with _FILE_LOCK:
        episodes = _read_episodes_safe(EPISODE_FILE)
        new_episodes = [ep for ep in episodes if _episode_id(ep) != episode_id]
        deleted_jsonl = len(new_episodes) < len(episodes)

        if deleted_jsonl:
            tmp = EPISODE_FILE.with_suffix(".tmp")
            lines = [json.dumps(ep, ensure_ascii=False) for ep in new_episodes]
            tmp.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
            os.replace(tmp, EPISODE_FILE)

    if _chroma_ready and _chroma_collection:
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: _chroma_collection.delete(ids=[episode_id]))
            deleted_chroma = True
        except Exception as e:
            print(f"[Memory] ChromaDB delete error: {e}")

    if not deleted_jsonl:
        return {"deleted": False, "error": f"Épisode {episode_id} introuvable"}
    return {"deleted": True, "episode_id": episode_id, "jsonl": True, "chroma": deleted_chroma}


@app.get("/health")
async def health():
    episode_count = 0
    chroma_count  = 0
    try:
        episode_count = len(_read_episodes_safe(EPISODE_FILE))
    except Exception:
        pass
    if _chroma_ready and _chroma_collection:
        try:
            loop = asyncio.get_event_loop()
            chroma_count = await loop.run_in_executor(None, _chroma_collection.count)
        except Exception:
            pass
    return {
        "status":          "ok",
        "layer":           "memory",
        "episode_count":   episode_count,
        "max_episodes":    MAX_EPISODES,
        "chroma_ready":    _chroma_ready,
        "chroma_indexed":  chroma_count,
        "embed_model":     EMBED_MODEL,
        "episode_file":    str(EPISODE_FILE),
        "world_state_file": str(WORLD_STATE_FILE),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=CONFIG["ports"]["memory"])
