#!/usr/bin/env python3
"""
vision.py — Vision Engine LaRuche v3.0
LLaVA (Ollama) + pHash fingerprinting + Delta-Screening
Zéro écriture disque — traitement RAM uniquement
"""

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
from typing import Optional

import aiohttp
import pyautogui
from PIL import Image

logger = logging.getLogger("laruche.vision")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [VISION] %(message)s")

OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
VISION_MODEL = os.getenv("OLLAMA_MODEL", "llava:7b")
RETINA_SCALE = float(os.getenv("RETINA_SCALE", "2.0"))

# Cache pHash pour le Screen Fingerprinting
_phash_cache: dict[str, dict] = {}
MAX_PHASH_CACHE = 50

# Session HTTP globale réutilisable (évite reconnexion à chaque appel)
_http_session: aiohttp.ClientSession | None = None


async def get_http_session() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        _http_session = aiohttp.ClientSession(
            timeout=aiohttp.ClientTimeout(total=90)
        )
    return _http_session

# Résolution logique macOS Retina
LOGICAL_W = 1536
LOGICAL_H = 960


def compute_phash(image: Image.Image) -> str:
    """Calcule le hash perceptuel d'une image pour le cache."""
    small = image.convert("L").resize((8, 8), Image.LANCZOS)
    pixels = list(small.getdata())
    avg = sum(pixels) / len(pixels)
    bits = "".join("1" if p > avg else "0" for p in pixels)
    return hex(int(bits, 2))[2:].zfill(16)


def capture_screen_b64(region: Optional[tuple] = None) -> tuple[str, str]:
    """
    Capture l'écran, redimensionne à résolution logique, encode en base64.
    Retourne (base64_png, phash).
    Zéro écriture disque — tout en RAM.
    """
    if region:
        x, y, w, h = region
        shot = pyautogui.screenshot(region=(x * 2, y * 2, w * 2, h * 2))
        shot = shot.resize((w, h), Image.LANCZOS)
    else:
        shot = pyautogui.screenshot()
        if shot.size != (LOGICAL_W, LOGICAL_H):
            shot = shot.resize((LOGICAL_W, LOGICAL_H), Image.LANCZOS)

    phash = compute_phash(shot)

    buf = io.BytesIO()
    shot.save(buf, format="PNG", optimize=True)
    b64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return b64, phash


async def analyze_screen(question: str, region: Optional[tuple] = None) -> dict:
    """
    Analyse l'écran avec LLaVA.
    Cache pHash: si la même image → retourne résultat mémorisé sans appel LLM.
    """
    b64, phash = capture_screen_b64(region)

    # Screen Fingerprinting — cache pHash
    if phash in _phash_cache:
        cached = _phash_cache[phash]
        if question in cached:
            logger.info(f"Cache hit pHash {phash[:8]}")
            return cached[question]

    logger.info(f"Analyse LLaVA: {question[:60]}")

    try:
        session = await get_http_session()
        async with session.post(
            f"{OLLAMA_HOST}/api/generate",
            json={
                "model": VISION_MODEL,
                "prompt": question,
                "images": [b64],
                "stream": False,
            },
        ) as resp:
            if resp.status != 200:
                return {"success": False, "error": f"Ollama HTTP {resp.status}"}
            data = await resp.json()
            result = {
                "success": True,
                "response": data.get("response", ""),
                "phash": phash,
            }

            # Mise en cache (LRU simple, max MAX_PHASH_CACHE entrées)
            if phash not in _phash_cache:
                if len(_phash_cache) >= MAX_PHASH_CACHE:
                    oldest = next(iter(_phash_cache))
                    del _phash_cache[oldest]
                _phash_cache[phash] = {}
            _phash_cache[phash][question] = result

            return result

    except asyncio.TimeoutError:
        return {"success": False, "error": "Timeout LLaVA (90s)"}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def find_element(description: str) -> Optional[dict]:
    """
    Cherche un élément UI à l'écran.
    Retourne {"x": int, "y": int, "confidence": float} ou None.
    """
    question = (
        f"Trouve '{description}' sur cet écran. "
        "Si trouvé, donne les coordonnées X,Y en format JSON: "
        '{"found": true, "x": 450, "y": 320, "confidence": 0.9, "label": "..."} '
        "Sinon: {\"found\": false}"
    )

    result = await analyze_screen(question)
    if not result.get("success"):
        return None

    response = result.get("response", "")
    try:
        json_match = re.search(r"\{[^{}]*\}", response)
        if json_match:
            data = json.loads(json_match.group())
            if data.get("found"):
                return {"x": data["x"], "y": data["y"], "confidence": data.get("confidence", 0.7)}
    except Exception:
        pass

    return None


async def watch_change(zone: Optional[tuple] = None, interval: float = 0.5, callback=None):
    """
    Surveille une zone de l'écran et appelle callback si changement détecté.
    """
    last_phash = None
    while True:
        _, phash = capture_screen_b64(zone)
        if last_phash and phash != last_phash and callback:
            await callback(phash)
        last_phash = phash
        await asyncio.sleep(interval)


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="LaRuche Vision Engine CLI")
    parser.add_argument("--fn", default="test", help="Fonction à appeler")
    parser.add_argument("--args", default="{}", help="Arguments JSON")

    cli_args = parser.parse_args()
    fn_name = cli_args.fn
    fn_args = {}
    try:
        fn_args = json.loads(cli_args.args)
    except json.JSONDecodeError:
        pass

    async def run_fn():
        if fn_name == "analyze_screen":
            question = fn_args.get("question", "Décris ce que tu vois.")
            region = fn_args.get("region", None)
            if isinstance(region, str):
                try:
                    region = tuple(json.loads(region))
                except Exception:
                    region = None
            result = await analyze_screen(question, region)
            print(json.dumps(result))

        elif fn_name == "find_element":
            description = fn_args.get("description", fn_args.get("query", ""))
            result = await find_element(description)
            if result:
                print(json.dumps({**result, "found": True}))
            else:
                print(json.dumps({"found": False, "description": description}))

        elif fn_name == "capture":
            b64, phash = capture_screen_b64()
            print(json.dumps({"success": True, "phash": phash, "b64_length": len(b64)}))

        else:
            # Mode test
            b64, phash = capture_screen_b64()
            result = await analyze_screen("Décris brièvement ce que tu vois.")
            print(json.dumps({"phash": phash, "response": result.get("response", "")[:200]}))

    asyncio.run(run_fn())
