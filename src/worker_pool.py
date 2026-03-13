#!/usr/bin/env python3
"""
worker_pool.py — Kimi-Overdrive Worker Pool LaRuche
10 instances max en parallèle, streaming, shadow logging SQLite
"""

import asyncio
import json
import logging
import os
import sqlite3
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import aiohttp

logger = logging.getLogger("laruche.workers")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [WORKERS] %(message)s")

ROOT = Path(__file__).parent.parent
DB_PATH = ROOT / ".laruche/shadow-errors.db"
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
MAX_WORKERS = int(os.getenv("MAX_KIMI_INSTANCES", "10"))
WORKER_TIMEOUT = 30  # secondes

# Session HTTP globale partagée par tous les workers
_global_session: aiohttp.ClientSession | None = None


async def get_session() -> aiohttp.ClientSession:
    global _global_session
    if _global_session is None or _global_session.closed:
        connector = aiohttp.TCPConnector(limit=MAX_WORKERS + 2, keepalive_timeout=30)
        _global_session = aiohttp.ClientSession(
            connector=connector,
            timeout=aiohttp.ClientTimeout(total=WORKER_TIMEOUT),
        )
    return _global_session


@dataclass
class WorkerTask:
    id: str
    description: str
    tokens_budget: int = 500
    temperature: float = 0.0
    model: str = None


@dataclass
class WorkerResult:
    task_id: str
    description: str
    output: str
    success: bool
    duration: float
    tokens_used: int = 0
    error: str = ""


class ShadowLogger:
    """Log les erreurs Kimi/Ollama dans SQLite pour auto-correction."""

    def __init__(self):
        self.conn = sqlite3.connect(str(DB_PATH))
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS kimi_errors (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT NOT NULL,
                task TEXT NOT NULL,
                error TEXT NOT NULL,
                corrected_prompt TEXT,
                resolved INTEGER DEFAULT 0
            )
        """)
        self.conn.commit()

    def log_error(self, task: str, error: str):
        self.conn.execute(
            "INSERT INTO kimi_errors (timestamp, task, error) VALUES (?, ?, ?)",
            (datetime.now().isoformat(), task[:200], str(error)[:500]),
        )
        self.conn.commit()

    def get_similar_errors(self, task: str, limit: int = 3) -> list:
        cursor = self.conn.execute(
            "SELECT task, error, corrected_prompt FROM kimi_errors WHERE resolved=1 LIMIT ?",
            (limit,),
        )
        return cursor.fetchall()


shadow_logger = ShadowLogger()


async def _call_ollama(prompt: str, model: str = None, temperature: float = 0.0) -> str:
    """Appel async Ollama avec timeout."""
    model = model or OLLAMA_MODEL
    try:
        session = await get_session()
        async with session.post(
            f"{OLLAMA_HOST}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False,
                  "options": {"temperature": temperature}},
        ) as resp:
            if resp.status != 200:
                raise Exception(f"Ollama HTTP {resp.status}")
            data = await resp.json()
            return data.get("response", "")
    except asyncio.TimeoutError:
        raise Exception(f"Timeout ({WORKER_TIMEOUT}s)")


async def execute_task(task: WorkerTask) -> WorkerResult:
    """Exécute une micro-tâche via Ollama."""
    start = time.time()
    logger.info(f"Worker [{task.id}] → {task.description[:60]}")

    # Contexte mémoire (erreurs similaires résolues)
    similar = shadow_logger.get_similar_errors(task.description)
    context = ""
    if similar:
        context = "\nErreurs similaires résolues:\n" + "\n".join(
            f"- Tâche: {e[0][:50]} | Correction: {e[2] or 'N/A'}"
            for e in similar
        )

    prompt = f"""Micro-tâche (max {task.tokens_budget} tokens):
{task.description}
{context}
Réponds directement, sans explication. Code production-ready si applicable."""

    try:
        output = await _call_ollama(prompt, task.model, task.temperature)
        duration = time.time() - start
        logger.info(f"Worker [{task.id}] ✅ ({duration:.1f}s)")
        return WorkerResult(
            task_id=task.id,
            description=task.description,
            output=output,
            success=True,
            duration=duration,
        )
    except Exception as e:
        duration = time.time() - start
        shadow_logger.log_error(task.description, str(e))
        logger.error(f"Worker [{task.id}] ❌ {e}")
        return WorkerResult(
            task_id=task.id,
            description=task.description,
            output="",
            success=False,
            duration=duration,
            error=str(e),
        )


async def execute_parallel(tasks: list[WorkerTask]) -> list[WorkerResult]:
    """
    Kimi-Overdrive: exécution parallèle de toutes les tâches.
    Limite à MAX_WORKERS instances simultanées.
    """
    semaphore = asyncio.Semaphore(MAX_WORKERS)

    async def bounded_task(task):
        async with semaphore:
            return await execute_task(task)

    logger.info(f"🚀 Kimi-Overdrive: {len(tasks)} tâches (max {MAX_WORKERS} parallèles)")
    start = time.time()

    results = await asyncio.gather(*[bounded_task(t) for t in tasks])

    duration = time.time() - start
    success_count = sum(1 for r in results if r.success)
    logger.info(f"✅ {success_count}/{len(tasks)} tâches réussies en {duration:.1f}s")

    return list(results)


async def chain_of_thought(raw_results: list[WorkerResult]) -> str:
    """
    Chain-of-Thought: Draft → Critique → Refactor
    Synthèse des résultats workers en output final.
    """
    draft = "\n\n".join(
        f"[{r.task_id}] {r.output[:300]}"
        for r in raw_results
        if r.success
    )

    if not draft:
        return "Aucun résultat exploitable."

    # Synthèse directe en un seul appel (plus rapide qu'un pipeline critique+refactor)
    task = next((r.description for r in raw_results if r.success), None)
    synthesis_prompt = f"""Synthétise ces résultats en une réponse finale claire:
{draft[:2000]}

Objectif: {task if task else "mission"}
Réponse concise et directe."""
    final = await _call_ollama(synthesis_prompt, temperature=0.2)
    return final


if __name__ == "__main__":
    async def test():
        tasks = [
            WorkerTask(id="t1", description="Écris une fonction Python pour calculer fibonacci"),
            WorkerTask(id="t2", description="Explique le pattern ReAct en 3 lignes"),
            WorkerTask(id="t3", description="Liste 5 commandes git utiles"),
        ]
        results = await execute_parallel(tasks)
        for r in results:
            print(f"\n[{r.task_id}] {'✅' if r.success else '❌'} ({r.duration:.1f}s)")
            print(r.output[:200])

        print("\n--- Chain-of-Thought ---")
        final = await chain_of_thought(results)
        print(final[:500])

    asyncio.run(test())
