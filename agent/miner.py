"""
agent/miner.py — Couche 12 : Behavior Mining Engine  (Phase 15)
FastAPI :8012

Le cerveau proactif de la ruche :
  1. Mine les épisodes en continu → patterns comportementaux
  2. Score les patterns (fréquence × réussite × récence)
  3. Détecte les skill gaps (patterns sans skill couvrant)
  4. Génère proactivement les skills manquants via Evolution
  5. Pré-chauffe Ollama pour les modèles prédits
  6. Publie les découvertes sur le bus phéromone (signals.jsonl)
  7. Construit le profil utilisateur (user_profile.json)
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import re
import sqlite3
import uuid
from collections import Counter, defaultdict
from contextlib import asynccontextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

MINER_PORT     = int(os.getenv("MINER_PORT",     "8012"))
BRAIN_URL      = os.getenv("BRAIN_URL",      "http://localhost:8003")
EVOLUTION_URL  = os.getenv("EVOLUTION_URL",  "http://localhost:8005")
VALIDATOR_URL  = os.getenv("VALIDATOR_URL",  "http://localhost:8014")
OLLAMA_HOST    = os.getenv("OLLAMA_HOST",    "http://localhost:11434")

ROOT           = Path(__file__).parent.parent
EPISODES_FILE  = Path(__file__).parent / "memory" / "episodes.jsonl"
SKILLS_REG     = ROOT / "skills" / "registry.json"
DB_FILE        = Path(__file__).parent / "miner.db"
SIGNALS_FILE   = Path(__file__).parent / "signals.jsonl"
PROFILE_FILE   = Path(__file__).parent / "user_profile.json"

# Intervalles des boucles de fond (secondes)
MINING_INTERVAL  = int(os.getenv("MINING_INTERVAL",  "7200"))   # 2h
GAPFILL_INTERVAL = int(os.getenv("GAPFILL_INTERVAL", "14400"))  # 4h
WARMUP_INTERVAL  = int(os.getenv("WARMUP_INTERVAL",  "21600"))  # 6h

# Modèles Ollama à maintenir chauds
WARMUP_MODELS = [
    "llama3.2:3b",
    "nomic-embed-text",
    "llama3:latest",
    "codellama:7b",
    "moondream",
]

# ---------------------------------------------------------------------------
# Domain classification keywords
# ---------------------------------------------------------------------------

DOMAIN_KW: dict[str, list[str]] = {
    "ui":     ["safari", "browser", "chrome", "firefox", "click", "open_app", "app",
                "window", "screenshot", "type", "youtube", "url", "navigate", "goto",
                "button", "find_element", "smart_click", "press_key", "press_enter",
                "drag", "scroll", "hover", "screen", "desktop", "menu"],
    "file":   ["file", "read_file", "write", "copy", "move", "delete", "create",
                "folder", "directory", "path", "cat", "ls", "mkdir", "rm", "cp",
                "open", "save", "document", "pdf", "txt", "json", "yaml"],
    "code":   ["code", "python", "javascript", "typescript", "function", "debug",
                "test", "compile", "script", "import", "class", "bug", "error",
                "refactor", "git", "commit", "branch", "pull", "push", "pytest"],
    "web":    ["fetch", "http", "api", "curl", "request", "response", "json",
                "download", "scrape", "web", "html", "css", "endpoint", "rest",
                "graphql", "webhook", "header", "post", "get", "http_fetch"],
    "system": ["cpu", "memory", "disk", "process", "kill", "install", "service",
                "daemon", "port", "network", "ping", "ssh", "docker", "npm",
                "pip", "brew", "update", "run_shell", "run_command", "shell"],
    "data":   ["analyze", "summarize", "extract", "parse", "csv", "database",
                "query", "report", "chart", "table", "excel", "sql", "pandas",
                "statistics", "average", "count", "filter", "sort"],
    "media":  ["image", "video", "audio", "music", "photo", "mp4", "mp3",
                "resize", "convert", "compress", "ffmpeg", "youtube", "stream",
                "play", "pause", "record", "screenshot"],
}

STOP_WORDS = {"le", "la", "les", "un", "une", "des", "de", "du", "et", "en",
              "au", "aux", "pour", "sur", "dans", "par", "avec", "à", "ce",
              "se", "qui", "que", "est", "sont", "the", "a", "an", "and",
              "or", "to", "of", "in", "on", "at", "is", "are", "be", "it"}

# ---------------------------------------------------------------------------
# SQLite
# ---------------------------------------------------------------------------

def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(str(DB_FILE))
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c


def _init_db():
    with _conn() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS patterns (
            id              TEXT PRIMARY KEY,
            domain          TEXT NOT NULL DEFAULT 'general',
            label           TEXT NOT NULL,
            keywords_json   TEXT NOT NULL DEFAULT '[]',
            episode_count   INTEGER NOT NULL DEFAULT 1,
            success_count   INTEGER NOT NULL DEFAULT 0,
            total_duration_ms INTEGER NOT NULL DEFAULT 0,
            last_seen       TEXT NOT NULL,
            first_seen      TEXT NOT NULL,
            recency_score   REAL NOT NULL DEFAULT 0.0,
            pattern_score   REAL NOT NULL DEFAULT 0.0,
            skill_coverage  REAL NOT NULL DEFAULT 0.0,
            gap_score       REAL NOT NULL DEFAULT 0.0,
            matching_skills TEXT NOT NULL DEFAULT '[]',
            generated_skill TEXT,
            updated_at      TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS mining_runs (
            id           TEXT PRIMARY KEY,
            episodes_read INTEGER NOT NULL DEFAULT 0,
            patterns_found INTEGER NOT NULL DEFAULT 0,
            gaps_found    INTEGER NOT NULL DEFAULT 0,
            skills_generated INTEGER NOT NULL DEFAULT 0,
            duration_ms   INTEGER NOT NULL DEFAULT 0,
            ran_at        TEXT NOT NULL
        );
        """)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Episode loading
# ---------------------------------------------------------------------------

def _load_episodes() -> list[dict]:
    if not EPISODES_FILE.exists():
        return []
    episodes = []
    with open(EPISODES_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                ep = json.loads(line)
                if ep.get("mission"):
                    episodes.append(ep)
            except Exception:
                pass
    return episodes


# ---------------------------------------------------------------------------
# Text processing
# ---------------------------------------------------------------------------

def _tokenize(text: str) -> list[str]:
    """Tokenise, lowercase, remove stop words."""
    tokens = re.findall(r"[a-zA-ZÀ-ÿ_]{3,}", text.lower())
    return [t for t in tokens if t not in STOP_WORDS]


def _bigrams(tokens: list[str]) -> list[str]:
    return [f"{tokens[i]}_{tokens[i+1]}" for i in range(len(tokens) - 1)]


def _classify_domain(tokens: list[str]) -> str:
    scores = {domain: 0 for domain in DOMAIN_KW}
    token_set = set(tokens)
    for domain, kws in DOMAIN_KW.items():
        scores[domain] = sum(1 for kw in kws if kw in token_set)
    best = max(scores, key=scores.get)
    return best if scores[best] > 0 else "general"


def _bag_of_words(tokens: list[str]) -> dict[str, int]:
    return Counter(tokens)


def _cosine_sim(bv1: dict, bv2: dict) -> float:
    """Cosine similarity entre deux bag-of-words."""
    if not bv1 or not bv2:
        return 0.0
    common = set(bv1) & set(bv2)
    dot    = sum(bv1[k] * bv2[k] for k in common)
    norm1  = math.sqrt(sum(v*v for v in bv1.values()))
    norm2  = math.sqrt(sum(v*v for v in bv2.values()))
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return dot / (norm1 * norm2)


# ---------------------------------------------------------------------------
# Pattern extraction
# ---------------------------------------------------------------------------

def _recency_weight(ts_str: str) -> float:
    """Décroissance exponentielle sur 30 jours."""
    try:
        ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        age_days = (datetime.now(timezone.utc) - ts).total_seconds() / 86400
        return math.exp(-age_days / 30)
    except Exception:
        return 0.5


CLUSTER_SIMILARITY_THRESHOLD = 0.45


def _extract_patterns(episodes: list[dict]) -> list[dict]:
    """
    Cluster les épisodes par similarité de tokens.
    Retourne une liste de patterns avec métriques.
    """
    if not episodes:
        return []

    # Prépare chaque épisode
    prepared = []
    for ep in episodes:
        tokens = _tokenize(ep.get("mission", ""))
        if not tokens:
            continue
        prepared.append({
            "ep": ep,
            "tokens": tokens,
            "bov": _bag_of_words(tokens + _bigrams(tokens)),
            "domain": _classify_domain(tokens),
            "recency": _recency_weight(ep.get("timestamp", _now())),
            "success": bool(ep.get("success", False)),
            "duration_ms": int(ep.get("duration_ms") or 0),
        })

    if not prepared:
        return []

    # Clustering greedy
    clusters: list[list[dict]] = []
    assigned = [False] * len(prepared)

    for i, item in enumerate(prepared):
        if assigned[i]:
            continue
        cluster = [item]
        assigned[i] = True
        for j, other in enumerate(prepared):
            if assigned[j] or i == j:
                continue
            sim = _cosine_sim(item["bov"], other["bov"])
            if sim >= CLUSTER_SIMILARITY_THRESHOLD:
                cluster.append(other)
                assigned[j] = True
        clusters.append(cluster)

    # Construit un pattern par cluster
    patterns = []
    for cluster in clusters:
        if len(cluster) < 2:   # ignore les singletons
            continue

        # Centroïde = tokens les plus fréquents
        all_tokens: list[str] = []
        for item in cluster:
            all_tokens.extend(item["tokens"])
        top_tokens = [t for t, _ in Counter(all_tokens).most_common(8)]

        domain = Counter(item["domain"] for item in cluster).most_common(1)[0][0]

        # Label : 6 premiers tokens les plus représentatifs
        label = " ".join(top_tokens[:6]).strip().capitalize()
        if not label:
            continue

        episode_count  = len(cluster)
        success_count  = sum(1 for item in cluster if item["success"])
        success_rate   = success_count / episode_count
        total_dur      = sum(item["duration_ms"] for item in cluster)
        avg_recency    = sum(item["recency"] for item in cluster) / episode_count
        last_seen      = max(item["ep"].get("timestamp", _now()) for item in cluster)
        first_seen     = min(item["ep"].get("timestamp", _now()) for item in cluster)

        pattern_score  = episode_count * success_rate * avg_recency

        patterns.append({
            "id":             f"p_{uuid.uuid4().hex[:8]}",
            "domain":         domain,
            "label":          label,
            "keywords":       top_tokens,
            "episode_count":  episode_count,
            "success_count":  success_count,
            "success_rate":   round(success_rate, 3),
            "total_duration_ms": total_dur,
            "avg_duration_ms": round(total_dur / episode_count),
            "last_seen":      last_seen,
            "first_seen":     first_seen,
            "recency_score":  round(avg_recency, 3),
            "pattern_score":  round(pattern_score, 3),
        })

    # Trier par score décroissant
    patterns.sort(key=lambda p: p["pattern_score"], reverse=True)
    return patterns[:50]  # Top 50


# ---------------------------------------------------------------------------
# Skill coverage analysis
# ---------------------------------------------------------------------------

def _load_skills_registry() -> dict[str, str]:
    """Retourne {skill_name: description}."""
    try:
        with open(SKILLS_REG) as f:
            data = json.load(f)
        skills = data.get("skills", data)
        if isinstance(skills, dict):
            result = {}
            for k, v in skills.items():
                if k in ("version", "lastUpdated"):
                    continue
                if isinstance(v, dict):
                    result[k] = v.get("description", k)
                else:
                    result[k] = str(v)
            return result
        elif isinstance(skills, list):
            return {s["name"]: s.get("description", s["name"]) for s in skills if "name" in s}
    except Exception:
        pass
    return {}


def _compute_skill_coverage(pattern: dict, skills: dict[str, str]) -> tuple[float, list[str]]:
    """Retourne (coverage 0-1, liste skills couvrant ce pattern)."""
    p_bov = _bag_of_words(_tokenize(pattern["label"]) + pattern["keywords"])
    matching = []
    best_sim  = 0.0
    for skill_name, skill_desc in skills.items():
        s_bov = _bag_of_words(_tokenize(skill_name + " " + skill_desc))
        sim = _cosine_sim(p_bov, s_bov)
        if sim > 0.25:
            matching.append(skill_name)
        if sim > best_sim:
            best_sim = sim
    return round(min(1.0, best_sim * 1.5), 3), matching[:5]


# ---------------------------------------------------------------------------
# Signal bus (pheromone protocol)
# ---------------------------------------------------------------------------

_SIGNALS_LOCK = asyncio.Lock()


async def _emit_signal(sig_type: str, payload: dict):
    """Publie un signal phéromone dans signals.jsonl."""
    signal = {"type": sig_type, "ts": _now(), **payload}
    async with _SIGNALS_LOCK:
        with open(SIGNALS_FILE, "a") as f:
            f.write(json.dumps(signal, ensure_ascii=False) + "\n")


def _load_signals(limit: int = 100) -> list[dict]:
    if not SIGNALS_FILE.exists():
        return []
    lines = SIGNALS_FILE.read_text(encoding="utf-8").strip().splitlines()
    signals = []
    for line in reversed(lines[-limit * 2:]):
        try:
            signals.append(json.loads(line))
        except Exception:
            pass
    return signals[:limit]


# ---------------------------------------------------------------------------
# User profile
# ---------------------------------------------------------------------------

def _build_profile(episodes: list[dict], patterns: list[dict]) -> dict:
    if not episodes:
        return {}

    # Domaines
    domain_counts: Counter = Counter()
    hour_counts:   Counter = Counter()
    model_counts:  Counter = Counter()
    success_total  = 0
    duration_total = 0

    for ep in episodes:
        tokens = _tokenize(ep.get("mission", ""))
        domain_counts[_classify_domain(tokens)] += 1
        try:
            ts = datetime.fromisoformat(ep.get("timestamp", "").replace("Z", "+00:00"))
            hour_counts[ts.hour] += 1
        except Exception:
            pass
        model_counts[ep.get("model_used", "unknown")] += 1
        if ep.get("success"):
            success_total += 1
        duration_total += int(ep.get("duration_ms") or 0)

    total = len(episodes)
    top_domains = [
        {"domain": d, "count": c, "pct": round(c / total * 100, 1)}
        for d, c in domain_counts.most_common(7)
    ]
    peak_hours = [h for h, _ in hour_counts.most_common(4)]

    top_skills_needed = list({
        kw for p in patterns[:10]
        for kw in p["keywords"][:2]
        if p["skill_coverage"] < 0.5
    })[:8]

    profile = {
        "total_missions":   total,
        "success_rate":     round(success_total / total * 100, 1) if total else 0,
        "avg_duration_ms":  round(duration_total / total) if total else 0,
        "dominant_domain":  domain_counts.most_common(1)[0][0] if domain_counts else "general",
        "top_domains":      top_domains,
        "peak_hours":       peak_hours,
        "model_preference": model_counts.most_common(1)[0][0] if model_counts else "unknown",
        "top_patterns":     len(patterns),
        "skill_gaps":       sum(1 for p in patterns if p.get("gap_score", 0) > 1.5),
        "top_skills_needed": top_skills_needed,
        "last_updated":     _now(),
    }
    PROFILE_FILE.write_text(json.dumps(profile, ensure_ascii=False, indent=2))
    return profile


# ---------------------------------------------------------------------------
# Core mining cycle
# ---------------------------------------------------------------------------

_MINING_LOCK = asyncio.Lock()


async def run_mining_cycle() -> dict:
    """Cycle complet de minage. Retourne les stats."""
    async with _MINING_LOCK:
        t0 = datetime.now(timezone.utc)
        run_id = str(uuid.uuid4())

        episodes = _load_episodes()
        if not episodes:
            return {"episodes_read": 0, "patterns_found": 0, "gaps_found": 0, "skills_generated": 0}

        patterns = _extract_patterns(episodes)
        skills   = _load_skills_registry()

        # Calcule coverage + gap_score pour chaque pattern
        for p in patterns:
            coverage, matching = _compute_skill_coverage(p, skills)
            p["skill_coverage"] = coverage
            p["matching_skills"] = matching
            p["gap_score"] = round(p["pattern_score"] * (1 - coverage), 3)

        # Re-trier par gap_score pour les gaps
        gaps = sorted(
            [p for p in patterns if p["gap_score"] > 0.5],
            key=lambda x: x["gap_score"],
            reverse=True,
        )

        # Sauvegarde en DB
        with _conn() as db:
            # Vide les anciens patterns et réinsère
            db.execute("DELETE FROM patterns")
            for p in patterns:
                db.execute("""
                    INSERT OR REPLACE INTO patterns
                    (id,domain,label,keywords_json,episode_count,success_count,
                     total_duration_ms,last_seen,first_seen,recency_score,
                     pattern_score,skill_coverage,gap_score,matching_skills,
                     generated_skill,updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """, (
                    p["id"], p["domain"], p["label"],
                    json.dumps(p["keywords"]),
                    p["episode_count"], p["success_count"],
                    p["total_duration_ms"],
                    p["last_seen"], p["first_seen"],
                    p["recency_score"], p["pattern_score"],
                    p["skill_coverage"], p["gap_score"],
                    json.dumps(p["matching_skills"]),
                    p.get("generated_skill"), _now(),
                ))

        # Profil utilisateur
        profile = _build_profile(episodes, patterns)

        duration_ms = int((datetime.now(timezone.utc) - t0).total_seconds() * 1000)

        with _conn() as db:
            db.execute(
                "INSERT INTO mining_runs VALUES (?,?,?,?,?,?,?)",
                (run_id, len(episodes), len(patterns), len(gaps), 0, duration_ms, _now()),
            )

        await _emit_signal("mining_complete", {
            "episodes": len(episodes),
            "patterns": len(patterns),
            "gaps":     len(gaps),
            "top_domain": profile.get("dominant_domain", "?"),
            "duration_ms": duration_ms,
        })

        print(f"[Miner] ✅ Mining: {len(episodes)} eps → {len(patterns)} patterns, {len(gaps)} gaps ({duration_ms}ms)")
        return {
            "episodes_read":    len(episodes),
            "patterns_found":   len(patterns),
            "gaps_found":       len(gaps),
            "skills_generated": 0,
            "duration_ms":      duration_ms,
        }


# ---------------------------------------------------------------------------
# Gap-fill : génère des skills via Evolution
# ---------------------------------------------------------------------------

async def _fill_top_gaps(n: int = 3) -> int:
    """Génère les n skills manquants les plus importants."""
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM patterns WHERE gap_score > 1.0 AND generated_skill IS NULL "
            "ORDER BY gap_score DESC LIMIT ?", (n,)
        ).fetchall()

    generated = 0
    for row in rows:
        p = dict(row)
        keywords = json.loads(p["keywords_json"])
        skill_name = "_".join(keywords[:2]).lower().replace(" ", "_")
        skill_name = re.sub(r"[^a-z0-9_]", "", skill_name)[:30] or "auto_skill"
        skill_name = f"auto_{skill_name}_{p['id'][-4:]}"

        goal = (f"Automatise la tâche suivante pour un utilisateur macOS : "
                f"{p['label']}. Domaine: {p['domain']}. "
                f"Mots-clés: {', '.join(keywords[:5])}.")

        print(f"[Miner] 🔨 Génération skill: {skill_name} (gap_score={p['gap_score']})")
        try:
            async with httpx.AsyncClient(timeout=90) as c:
                r = await c.post(f"{EVOLUTION_URL}/generate-skill-node", json={
                    "name":        skill_name,
                    "goal":        goal,
                    "examples":    [],
                    "description": p["label"],
                    "params":      {"context": "string"},
                })
                if r.status_code == 200:
                    evo_result = r.json()
                    # ── Phase 17 : validation automatique ──────────────────
                    validated = False
                    try:
                        vr = await c.post(
                            f"{VALIDATOR_URL}/validate",
                            json={
                                "name":            skill_name,
                                "auto_deploy":     True,
                                "auto_quarantine": True,
                                "source":          "miner",
                            },
                            timeout=60,
                        )
                        if vr.status_code == 200:
                            v = vr.json()
                            validated = v.get("passed", False)
                            status = "✅ validé" if validated else f"🔒 quarantaine ({', '.join(v.get('checks_failed', []))})"
                            print(f"[Miner] Validator → {skill_name} : {status}")
                    except Exception as ve:
                        print(f"[Miner] ⚠️  validator unreachable: {ve} — skill généré sans validation")
                        validated = evo_result.get("syntax_ok", False)
                    # ── Marquer le pattern comme traité ───────────────────
                    with _conn() as db:
                        db.execute(
                            "UPDATE patterns SET generated_skill=? WHERE id=?",
                            (skill_name, p["id"]),
                        )
                    await _emit_signal("skill_generated", {
                        "skill":     skill_name,
                        "pattern":   p["label"],
                        "domain":    p["domain"],
                        "gap_score": p["gap_score"],
                        "validated": validated,
                    })
                    if validated:
                        generated += 1
        except Exception as e:
            print(f"[Miner] ⚠️  gap-fill failed for {skill_name}: {e}")

    return generated


# ---------------------------------------------------------------------------
# Warm-up Ollama models
# ---------------------------------------------------------------------------

async def _warmup_ollama() -> list[str]:
    """Pré-charge les modèles Ollama en RAM (1 token)."""
    warmed = []
    async with httpx.AsyncClient(timeout=5) as hc:
        try:
            r = await hc.get(f"{OLLAMA_HOST}/api/tags")
            if r.status_code != 200:
                return []
            available = {m["name"] for m in r.json().get("models", [])}
        except Exception:
            return []

    for model in WARMUP_MODELS:
        # Check approximatif : le modèle peut être "llama3:latest" ou "llama3"
        base = model.split(":")[0]
        if not any(base in name for name in available):
            continue
        try:
            async with httpx.AsyncClient(timeout=35) as c:
                await c.post(f"{OLLAMA_HOST}/api/generate", json={
                    "model": model, "prompt": ".", "stream": False,
                    "options": {"num_predict": 1},
                })
            warmed.append(model)
            await _emit_signal("model_warmed", {"model": model})
            print(f"[Miner] 🔥 Warm: {model}")
        except Exception as e:
            print(f"[Miner] ⚠️  warmup {model}: {e}")

    return warmed


# ---------------------------------------------------------------------------
# Background loops
# ---------------------------------------------------------------------------

async def _mining_loop():
    await asyncio.sleep(15)   # Warm-up initial
    while True:
        await run_mining_cycle()
        await asyncio.sleep(MINING_INTERVAL)


async def _gapfill_loop():
    await asyncio.sleep(60)
    while True:
        n = await _fill_top_gaps(3)
        if n:
            print(f"[Miner] 🧬 Gap-fill: {n} skills générés")
        await asyncio.sleep(GAPFILL_INTERVAL)


async def _warmup_loop():
    await asyncio.sleep(5)
    while True:
        warmed = await _warmup_ollama()
        print(f"[Miner] 🔥 Warmup terminé: {warmed}")
        await asyncio.sleep(WARMUP_INTERVAL)


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    _init_db()
    asyncio.create_task(_warmup_loop())
    asyncio.create_task(_mining_loop())
    asyncio.create_task(_gapfill_loop())
    print(f"[Miner] ✅ Démarré sur :{MINER_PORT}")
    yield


app = FastAPI(title="Behavior Mining Engine", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.post("/mine")
async def trigger_mining():
    """Déclenche manuellement un cycle de minage complet."""
    result = await run_mining_cycle()
    return {"ok": True, **result}


@app.get("/patterns")
async def get_patterns(
    domain:    str  = Query("all"),
    min_score: float = Query(0.0),
    limit:     int  = Query(30),
):
    with _conn() as db:
        if domain == "all":
            rows = db.execute(
                "SELECT * FROM patterns WHERE pattern_score >= ? "
                "ORDER BY pattern_score DESC LIMIT ?",
                (min_score, limit),
            ).fetchall()
        else:
            rows = db.execute(
                "SELECT * FROM patterns WHERE domain=? AND pattern_score >= ? "
                "ORDER BY pattern_score DESC LIMIT ?",
                (domain, min_score, limit),
            ).fetchall()
    patterns = []
    for r in rows:
        p = dict(r)
        p["keywords"]       = json.loads(p.get("keywords_json", "[]"))
        p["matching_skills"] = json.loads(p.get("matching_skills", "[]"))
        patterns.append(p)
    return {"patterns": patterns, "total": len(patterns)}


@app.get("/gaps")
async def get_gaps(limit: int = Query(20)):
    """Patterns sans skill couvrant → à combler en priorité."""
    with _conn() as db:
        rows = db.execute(
            "SELECT * FROM patterns WHERE gap_score > 0.5 "
            "ORDER BY gap_score DESC LIMIT ?", (limit,)
        ).fetchall()
    gaps = []
    for r in rows:
        p = dict(r)
        p["keywords"]        = json.loads(p.get("keywords_json", "[]"))
        p["matching_skills"] = json.loads(p.get("matching_skills", "[]"))
        gaps.append(p)
    return {"gaps": gaps, "total": len(gaps)}


@app.post("/gaps/{pattern_id}/generate")
async def generate_skill_for_gap(pattern_id: str):
    """Génère le skill manquant pour ce pattern spécifique."""
    with _conn() as db:
        row = db.execute("SELECT * FROM patterns WHERE id=?", (pattern_id,)).fetchone()
        if not row:
            from fastapi import HTTPException
            raise HTTPException(404, "pattern not found")
    p = dict(row)
    p["keywords_json"] = p.get("keywords_json", "[]")

    # Réutilise la logique gap-fill
    keywords    = json.loads(p["keywords_json"])
    skill_name  = "_".join(keywords[:2]).lower()
    skill_name  = re.sub(r"[^a-z0-9_]", "", skill_name)[:30] or "auto_skill"
    skill_name  = f"auto_{skill_name}_{p['id'][-4:]}"
    goal = (f"Automatise: {p['label']}. Domaine: {p['domain']}. "
            f"Mots-clés: {', '.join(keywords[:5])}.")
    try:
        async with httpx.AsyncClient(timeout=90) as c:
            r = await c.post(f"{EVOLUTION_URL}/generate-skill-node", json={
                "name": skill_name, "goal": goal, "examples": [],
                "description": p["label"], "params": {"context": "string"},
            })
            if r.status_code == 200:
                with _conn() as db:
                    db.execute("UPDATE patterns SET generated_skill=? WHERE id=?",
                               (skill_name, pattern_id))
                # Phase 17 : validation automatique
                validation = None
                try:
                    vr = await c.post(
                        f"{VALIDATOR_URL}/validate",
                        json={"name": skill_name, "auto_deploy": True,
                              "auto_quarantine": True, "source": "miner_manual"},
                        timeout=60,
                    )
                    if vr.status_code == 200:
                        validation = vr.json()
                except Exception:
                    pass
                await _emit_signal("skill_generated", {
                    "skill": skill_name, "pattern": p["label"],
                    "validated": validation.get("passed") if validation else None,
                })
                return {"ok": True, "skill": skill_name, "validation": validation}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": False, "error": "Evolution service error"}


@app.post("/warmup")
async def trigger_warmup():
    """Déclenche manuellement le pré-chauffage des modèles Ollama."""
    warmed = await _warmup_ollama()
    return {"ok": True, "warmed": warmed}


@app.get("/profile")
async def get_profile():
    """Profil comportemental de l'utilisateur."""
    if PROFILE_FILE.exists():
        try:
            return json.loads(PROFILE_FILE.read_text())
        except Exception:
            pass
    return {"error": "profile not yet built — trigger /mine first"}


@app.get("/signals")
async def get_signals(limit: int = Query(50)):
    """Derniers signaux phéromone émis."""
    signals = _load_signals(limit)
    return {"signals": signals, "total": len(signals)}


@app.get("/stats")
async def get_stats():
    with _conn() as db:
        total_patterns = db.execute("SELECT COUNT(*) as c FROM patterns").fetchone()["c"]
        total_gaps     = db.execute("SELECT COUNT(*) as c FROM patterns WHERE gap_score > 0.5").fetchone()["c"]
        skills_gen     = db.execute("SELECT COUNT(*) as c FROM patterns WHERE generated_skill IS NOT NULL").fetchone()["c"]
        last_run       = db.execute("SELECT * FROM mining_runs ORDER BY ran_at DESC LIMIT 1").fetchone()
        domain_counts  = db.execute(
            "SELECT domain, COUNT(*) as c FROM patterns GROUP BY domain ORDER BY c DESC"
        ).fetchall()
    return {
        "patterns_total":     total_patterns,
        "gaps_total":         total_gaps,
        "skills_generated":   skills_gen,
        "last_run":           dict(last_run) if last_run else None,
        "domain_distribution": [dict(r) for r in domain_counts],
        "signals_file":       str(SIGNALS_FILE),
        "profile_file":       str(PROFILE_FILE),
    }


@app.get("/health")
async def health():
    episodes_count = len(_load_episodes())
    with _conn() as db:
        patterns_count = db.execute("SELECT COUNT(*) as c FROM patterns").fetchone()["c"]
        gaps_count     = db.execute("SELECT COUNT(*) as c FROM patterns WHERE gap_score > 0.5").fetchone()["c"]
    return {
        "status":          "ok",
        "port":            MINER_PORT,
        "episodes":        episodes_count,
        "patterns":        patterns_count,
        "gaps":            gaps_count,
        "signals_file":    SIGNALS_FILE.exists(),
        "profile_file":    PROFILE_FILE.exists(),
    }
