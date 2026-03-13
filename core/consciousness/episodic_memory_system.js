/**
 * core/consciousness/episodic_memory_system.js
 * Ghost OS Ultimate — Mémoire épisodique avec recherche sémantique
 *
 * Compatible avec le format episodes.jsonl de PICO-RUCHE.
 * Ajoute : recherche cosine-similarity, compression automatique, stats.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const DEFAULT_MAX  = 10_000;
const COMPRESS_AT  = 0.9;    // Compresse quand rempli à 90%

export class EpisodicMemorySystem {
  constructor(options = {}) {
    this._episodes    = [];
    this._maxEpisodes = options.max || DEFAULT_MAX;
    this._filePath    = options.file_path || null;
    this._stats       = { stored: 0, recalled: 0, compressed: 0 };

    // Chargement depuis fichier si spécifié
    if (this._filePath && existsSync(this._filePath)) {
      this._loadFromFile();
    }
  }

  // ─── API principale ───────────────────────────────────────────────────────

  /** Stocke un épisode. Compresse si nécessaire. */
  async storeEpisode(episode) {
    const entry = {
      ...episode,
      id:        episode.id || `ep-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: episode.timestamp || Date.now(),
      _vector:   this._simpleVector(JSON.stringify(episode)),
    };

    this._episodes.push(entry);
    this._stats.stored++;

    // Auto-compression
    if (this._episodes.length >= this._maxEpisodes * COMPRESS_AT) {
      await this._compress();
    }

    // Persistance
    if (this._filePath) this._appendToFile(entry);

    return entry.id;
  }

  /** Recherche les N épisodes les plus similaires à une requête. */
  async recallSimilar(query, limit = 5) {
    this._stats.recalled++;
    const qVector = this._simpleVector(
      typeof query === 'string' ? query : JSON.stringify(query)
    );

    const ranked = this._episodes
      .map(ep => ({ ep, score: this._cosineSimilarity(qVector, ep._vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    return ranked.map(({ ep, score }) => ({ ...ep, _score: score, _vector: undefined }));
  }

  /** Recherche par type d'épisode. */
  getByType(type, limit = 20) {
    return this._episodes
      .filter(ep => ep.type === type)
      .slice(-limit)
      .map(ep => ({ ...ep, _vector: undefined }));
  }

  /** Épisodes récents. */
  getRecent(n = 10) {
    return this._episodes.slice(-n).map(ep => ({ ...ep, _vector: undefined }));
  }

  size() { return this._episodes.length; }
  getStats() { return { ...this._stats, current_size: this._episodes.length }; }

  // ─── Compression ─────────────────────────────────────────────────────────

  async _compress() {
    const keep = Math.floor(this._maxEpisodes * 0.5);
    // Garde les épisodes récents + ceux avec "success: false" (précieux pour l'apprentissage)
    const failures   = this._episodes.filter(ep => ep.success === false).slice(-100);
    const recent     = this._episodes.slice(-keep);
    const combined   = new Map();
    [...failures, ...recent].forEach(ep => combined.set(ep.id, ep));
    this._episodes   = Array.from(combined.values());
    this._stats.compressed++;
    console.log(`[EpisodicMemory] Compressé: ${combined.size} épisodes conservés`);
  }

  // ─── Persistance ─────────────────────────────────────────────────────────

  _loadFromFile() {
    try {
      const lines = readFileSync(this._filePath, 'utf-8').trim().split('\n');
      for (const line of lines) {
        if (!line) continue;
        try {
          const ep = JSON.parse(line);
          ep._vector = ep._vector || this._simpleVector(JSON.stringify(ep));
          this._episodes.push(ep);
        } catch { /* ligne corrompue ignorée */ }
      }
      console.log(`[EpisodicMemory] ${this._episodes.length} épisodes chargés depuis ${this._filePath}`);
    } catch (err) {
      console.warn('[EpisodicMemory] Impossible de charger:', err.message);
    }
  }

  _appendToFile(episode) {
    try {
      const line = JSON.stringify({ ...episode, _vector: undefined }) + '\n';
      writeFileSync(this._filePath, line, { flag: 'a', encoding: 'utf-8' });
    } catch (err) {
      console.error('[EpisodicMemory] Erreur écriture:', err.message);
    }
  }

  // ─── Vectorisation légère (bag-of-words normalisé) ────────────────────────

  _simpleVector(text, dims = 64) {
    const vec = new Float32Array(dims);
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    for (const word of words) {
      let hash = 5381;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) + hash) ^ word.charCodeAt(i);
        hash = hash & 0xffffffff;
      }
      vec[Math.abs(hash) % dims] += 1;
    }
    // Normalisation L2
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map(v => v / norm);
  }

  _cosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot; // vecteurs déjà normalisés → produit scalaire = cosine
  }
}
