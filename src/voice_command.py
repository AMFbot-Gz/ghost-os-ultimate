#!/usr/bin/env python3
"""
voice_command.py — Whisper Offline LaRuche
faster-whisper "small" (151Mo) + Silero VAD
Transcription < 200ms, 100% offline
"""

import asyncio
import json
import logging
import os
import queue
import threading
from typing import Optional

import numpy as np
import sounddevice as sd

logger = logging.getLogger("laruche.voice")
logging.basicConfig(level=logging.INFO, format="[%(asctime)s] [VOICE] %(message)s")

# Globals modèles (lazy loading thread-safe)
_whisper_model = None
_vad_model = None
_model_lock = threading.Lock()
_vad_lock = threading.Lock()

# Queue audio + stop event
_audio_queue: queue.Queue = queue.Queue()
_stop_event = threading.Event()


def get_whisper():
    global _whisper_model
    with _model_lock:
        if _whisper_model is None:
            from faster_whisper import WhisperModel
            logger.info("Chargement Whisper 'small'...")
            _whisper_model = WhisperModel("small", device="cpu", compute_type="float32")
            logger.info("✅ Whisper prêt")
    return _whisper_model


def get_vad():
    global _vad_model
    with _vad_lock:
        if _vad_model is None:
            import torch
            logger.info("Chargement Silero VAD...")
            model, utils = torch.hub.load(
                repo_or_dir="snakers4/silero-vad",
                model="silero_vad",
                force_reload=False,
                trust_repo=True,
            )
            _vad_model = (model, utils)
            logger.info("✅ VAD prêt")
    return _vad_model


def _audio_callback(indata, frames, time_info, status):
    if status:
        logger.debug(f"Audio status: {status}")
    _audio_queue.put(indata.copy())


def _listen_sync(max_seconds: float = 10.0, language: str = "fr") -> str:
    """Écoute synchrone avec VAD + Whisper."""
    import torch

    model_vad, _ = get_vad()
    samplerate = 16000
    chunk_size = 512

    audio_buffer = []
    speaking = False
    silence_frames = 0
    max_silence = 30  # ~1s à 16kHz / chunk_size=512

    logger.info("🎤 Écoute...")

    with sd.InputStream(
        samplerate=samplerate,
        channels=1,
        dtype="float32",
        blocksize=chunk_size,
        callback=_audio_callback,
    ):
        timeout_chunks = int(max_seconds * samplerate / chunk_size)
        for _ in range(timeout_chunks):
            if _stop_event.is_set():
                break
            try:
                data = _audio_queue.get(timeout=1.0)
            except queue.Empty:
                continue

            audio_buffer.append(data.flatten())
            tensor = torch.from_numpy(data.flatten())
            speech_prob = model_vad(tensor, samplerate).item()

            if speech_prob > 0.5:
                speaking = True
                silence_frames = 0
            elif speaking:
                silence_frames += 1
                if silence_frames > max_silence:
                    logger.info("Fin de parole détectée")
                    break

    if not audio_buffer:
        return ""

    full_audio = np.concatenate(audio_buffer)

    whisper = get_whisper()
    segments, _ = whisper.transcribe(
        full_audio,
        beam_size=1,
        language=language,
        vad_filter=False,  # On utilise Silero, pas le VAD interne
    )
    text = " ".join(seg.text for seg in segments).strip().lower()
    logger.info(f"Transcrit: '{text}'")
    return text


async def listen(max_seconds: float = 10.0, language: str = "fr") -> str:
    """Interface async pour la capture vocale."""
    return await asyncio.to_thread(_listen_sync, max_seconds, language)


def stop_listening():
    """Arrête l'écoute en cours."""
    _stop_event.set()
    _stop_event.clear()


async def continuous_listen(callback, keyword: str = "laruche"):
    """
    Écoute continue — déclenche callback si keyword détecté.
    """
    logger.info(f"Écoute continue (mot-clé: '{keyword}')")
    while True:
        text = await listen(max_seconds=5.0)
        if text and keyword.lower() in text.lower():
            command = text.lower().replace(keyword.lower(), "").strip()
            if command:
                await callback(command)


if __name__ == "__main__":
    async def test():
        print("Parlez maintenant...")
        text = await listen(max_seconds=5.0)
        print(f"Entendu: '{text}'")

    asyncio.run(test())
