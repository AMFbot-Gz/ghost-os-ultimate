/**
 * MemoryPage.jsx — Mémoire Vectorielle Persistante
 * Visualise, recherche et gère les épisodes ChromaDB via /brain/memory/*
 */
import React, { useState, useEffect, useCallback, useRef } from "react";

const BRAIN_URL = "/brain";

// ─── Helpers ────────────────────────────────────────────────────────────────

function fmt_date(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso + (iso.endsWith("Z") ? "" : "Z"));
    return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })
      + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  } catch { return iso.slice(0, 16); }
}

function fmt_ms(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`;
}

function episode_id_from(ep) {
  // Reconstitue l'ID SHA256 depuis mission + timestamp (même algo que memory.py)
  return ep._id || ep.id || null;
}

// ─── Stat card ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, color }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 130,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--primary)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--text-2)", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

// ─── Episode card ────────────────────────────────────────────────────────────

function EpisodeCard({ ep, similarity, onForget, epId }) {
  const [open, setOpen] = useState(false);
  const success = ep.success || ep.success === "true" || ep.success === true;
  const loopType = ep.learned?.startsWith("[ToT]") ? "ToT" : ep.learned?.startsWith("[ReAct]") ? "ReAct" : "—";
  const loopColor = loopType === "ToT" ? "var(--violet)" : loopType === "ReAct" ? "var(--blue)" : "var(--text-3)";

  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden",
      borderLeft: `3px solid ${success ? "var(--green)" : "var(--red)"}`,
      transition: "border-color 0.15s",
    }}>
      {/* Header cliquable */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "flex-start", gap: 10, padding: "12px 14px",
          cursor: "pointer",
        }}
        onMouseEnter={e => e.currentTarget.style.background = "var(--surface-2)"}
        onMouseLeave={e => e.currentTarget.style.background = "transparent"}
      >
        {/* Success badge */}
        <span style={{
          fontSize: 13, marginTop: 1, flexShrink: 0,
          color: success ? "var(--green)" : "var(--red)",
        }}>{success ? "✓" : "✗"}</span>

        {/* Mission */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 13, color: "var(--text)", fontWeight: 500,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
          }}>
            {ep.mission || "(mission inconnue)"}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3, display: "flex", gap: 10 }}>
            <span>{fmt_date(ep.timestamp)}</span>
            {ep.duration_ms > 0 && <span>{fmt_ms(ep.duration_ms)}</span>}
            {ep.model_used && <span>{ep.model_used.split("/").pop()}</span>}
          </div>
        </div>

        {/* Badges droite */}
        <div style={{ display: "flex", gap: 6, flexShrink: 0, alignItems: "center" }}>
          {loopType !== "—" && (
            <span style={{
              background: loopColor, color: "white",
              borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700,
            }}>{loopType}</span>
          )}
          {similarity != null && (
            <span style={{
              background: "var(--primary-dim, rgba(224,123,84,0.15))",
              color: "var(--primary)", borderRadius: 6, padding: "2px 7px",
              fontSize: 10, fontWeight: 700,
            }}>{Math.round(similarity * 100)}%</span>
          )}
          <span style={{ color: "var(--text-3)", fontSize: 14, marginLeft: 4 }}>
            {open ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Contenu expansible */}
      {open && (
        <div style={{ borderTop: "1px solid var(--border)", padding: "12px 14px", fontSize: 12 }}>
          {ep.result && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Résultat</div>
              <div style={{
                background: "var(--surface-3)", borderRadius: 6, padding: "8px 10px",
                color: "var(--text-2)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>{ep.result}</div>
            </div>
          )}
          {ep.learned && (
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Appris</div>
              <div style={{ color: "var(--text-3)" }}>{ep.learned}</div>
            </div>
          )}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 4, color: "var(--text-3)", fontSize: 11 }}>
            {ep.model_used && <span>Modèle : {ep.model_used}</span>}
            {ep.duration_ms > 0 && <span>Durée : {fmt_ms(ep.duration_ms)}</span>}
            {ep.skills_used?.length > 0 && <span>Skills : {ep.skills_used.join(", ")}</span>}
            {epId && <span style={{ fontFamily: "monospace", color: "var(--text-4)" }}>ID : {epId}</span>}
          </div>
          {epId && onForget && (
            <button
              onClick={() => onForget(epId, ep.mission)}
              style={{
                marginTop: 10, background: "transparent", border: "1px solid var(--red)",
                borderRadius: 6, padding: "4px 12px", color: "var(--red)",
                fontSize: 11, cursor: "pointer",
              }}
              onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,0.1)"; }}
              onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
            >
              🗑 Oublier cet épisode
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export default function MemoryPage() {
  const [stats, setStats] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  const [searchResults, setSearchResults] = useState(null); // null = pas de recherche active
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reindexing, setReindexing] = useState(false);
  const [episodeIds, setEpisodeIds] = useState({}); // { idx: id } pour les épisodes listés
  const debounceRef = useRef(null);

  // Chargement initial : stats + épisodes récents
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statsRes, epsRes] = await Promise.all([
        fetch(`${BRAIN_URL}/memory/stats`).then(r => r.json()),
        fetch(`${BRAIN_URL}/memory/episodes?limit=30`).then(r => r.json()),
      ]);
      setStats(statsRes);
      setEpisodes(epsRes.episodes || []);
    } catch (e) {
      console.error("MemoryPage load error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Recherche sémantique (debounce 600ms)
  const doSearch = useCallback(async (q) => {
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(`${BRAIN_URL}/memory/search?q=${encodeURIComponent(q.trim())}&n=10`);
      const data = await r.json();
      setSearchResults(data);
    } catch (e) {
      setSearchResults({ results: [], error: String(e) });
    } finally {
      setSearching(false);
    }
  }, []);

  const onSearchChange = useCallback((e) => {
    const v = e.target.value;
    setSearchQuery(v);
    clearTimeout(debounceRef.current);
    if (!v.trim()) { setSearchResults(null); return; }
    debounceRef.current = setTimeout(() => doSearch(v), 600);
  }, [doSearch]);

  // Oublier un épisode
  const onForget = useCallback(async (epId, mission) => {
    if (!confirm(`Oublier cet épisode ?\n\n"${mission?.slice(0, 80)}"`)) return;
    try {
      const r = await fetch(`${BRAIN_URL}/memory/${epId}`, { method: "DELETE" });
      const data = await r.json();
      if (data.deleted) {
        // Rafraîchir
        loadAll();
        if (searchQuery.trim()) doSearch(searchQuery);
      } else {
        alert("Impossible de supprimer : " + (data.error || "erreur inconnue"));
      }
    } catch (e) {
      alert("Erreur : " + e.message);
    }
  }, [loadAll, doSearch, searchQuery]);

  // Ré-indexation ChromaDB
  const onReindex = useCallback(async () => {
    if (!confirm("Relancer la ré-indexation ChromaDB de tous les épisodes ?")) return;
    setReindexing(true);
    try {
      await fetch(`${BRAIN_URL}/memory/reindex`, { method: "POST" });
      setTimeout(() => { loadAll(); setReindexing(false); }, 2000);
    } catch { setReindexing(false); }
  }, [loadAll]);

  const chromaOk = stats?.chroma_ready;
  const displayEpisodes = searchResults
    ? (searchResults.results || [])
    : episodes.map(ep => ({ episode: ep, similarity: null }));

  return (
    <div style={{ padding: 24, maxWidth: 960, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0 }}>
          💾 Mémoire Vectorielle
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-3)", margin: "6px 0 0" }}>
          Épisodes persistants • ChromaDB + JSONL • Recherche sémantique nomic-embed-text
        </p>
      </div>

      {/* ── Stats ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
        <StatCard
          label="Épisodes total"
          value={loading ? "…" : (stats?.total_episodes ?? "—")}
          sub="JSONL persistant"
        />
        <StatCard
          label="Indexés ChromaDB"
          value={loading ? "…" : (stats?.chroma_indexed ?? "—")}
          sub={chromaOk ? "vectoriel actif" : "ChromaDB inactif"}
          color={chromaOk ? "var(--green)" : "var(--red)"}
        />
        <StatCard
          label="État vectoriel"
          value={loading ? "…" : (chromaOk ? "Actif" : "Dégradé")}
          sub={chromaOk ? "nomic-embed-text" : "fallback mots-clés"}
          color={chromaOk ? "var(--green)" : "var(--yellow)"}
        />
        <div style={{
          display: "flex", alignItems: "center", gap: 8,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "14px 16px", flexShrink: 0,
        }}>
          <button
            onClick={loadAll}
            disabled={loading}
            style={{
              background: "var(--surface-3)", border: "1px solid var(--border-2)",
              borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer",
              color: "var(--text-2)",
            }}
          >{loading ? "…" : "↻ Refresh"}</button>
          <button
            onClick={onReindex}
            disabled={reindexing || !chromaOk}
            style={{
              background: "var(--surface-3)", border: "1px solid var(--border-2)",
              borderRadius: 6, padding: "6px 14px", fontSize: 12, cursor: "pointer",
              color: reindexing ? "var(--text-3)" : "var(--text-2)",
            }}
          >{reindexing ? "Indexation…" : "⚡ Ré-indexer"}</button>
        </div>
      </div>

      {/* ── Barre de recherche sémantique ── */}
      <div style={{ position: "relative", marginBottom: 20 }}>
        <input
          type="text"
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Recherche sémantique dans les épisodes…"
          style={{
            width: "100%", boxSizing: "border-box",
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: "11px 42px 11px 14px",
            fontSize: 14, color: "var(--text)", outline: "none",
          }}
          onFocus={e => { e.target.style.borderColor = "var(--primary)"; }}
          onBlur={e => { e.target.style.borderColor = "var(--border)"; }}
        />
        <span style={{
          position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)",
          fontSize: 16, color: "var(--text-3)", pointerEvents: "none",
        }}>
          {searching ? "⟳" : "🔍"}
        </span>
      </div>

      {/* ── Info recherche ── */}
      {searchResults && (
        <div style={{
          fontSize: 12, color: "var(--text-3)", marginBottom: 12,
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span>
            {searchResults.total_found ?? (searchResults.results?.length ?? 0)} résultat(s)
            pour « {searchQuery} »
            {searchResults.chroma_ready === false && " (mode mots-clés)"}
          </span>
          <button
            onClick={() => { setSearchQuery(""); setSearchResults(null); }}
            style={{
              background: "transparent", border: "none", color: "var(--primary)",
              cursor: "pointer", fontSize: 12, padding: 0,
            }}
          >× Effacer</button>
          {searchResults.error && (
            <span style={{ color: "var(--red)" }}>Erreur: {searchResults.error}</span>
          )}
        </div>
      )}

      {/* ── Liste des épisodes ── */}
      {!searchResults && (
        <div style={{
          fontSize: 12, color: "var(--text-3)", marginBottom: 12,
          display: "flex", justifyContent: "space-between",
        }}>
          <span>{episodes.length} épisode(s) récents</span>
          {!chromaOk && (
            <span style={{ color: "var(--yellow)" }}>
              ⚠ ChromaDB inactif — lancez Ollama avec nomic-embed-text
            </span>
          )}
        </div>
      )}

      {loading && (
        <div style={{ textAlign: "center", color: "var(--text-3)", padding: 40, fontSize: 13 }}>
          Chargement…
        </div>
      )}

      {!loading && displayEpisodes.length === 0 && (
        <div style={{
          textAlign: "center", color: "var(--text-3)", padding: 48,
          background: "var(--surface)", borderRadius: 12, border: "1px solid var(--border)",
          fontSize: 13,
        }}>
          {searchResults
            ? "Aucun épisode similaire trouvé. Essayez des termes différents."
            : "Aucun épisode en mémoire. Lancez des missions ReAct ou ToT pour remplir la mémoire."}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {!loading && displayEpisodes.map((item, i) => {
          // Normalise selon que c'est un résultat de recherche ou un épisode brut
          const ep = item.episode || item;
          const sim = item.similarity ?? null;
          // _id injecté par memory.py dans /episodes et /semantic_search
          const epId = ep?._id || item.id || null;

          return (
            <EpisodeCard
              key={i}
              ep={ep}
              similarity={sim}
              epId={epId}
              onForget={epId ? onForget : null}
            />
          );
        })}
      </div>

      {/* ── Footer info ── */}
      {!loading && (
        <div style={{ marginTop: 16, fontSize: 11, color: "var(--text-3)", textAlign: "center" }}>
          Auto-sauvegarde activée · Les missions ReAct et ToT sont indexées à la fin de chaque exécution
        </div>
      )}
    </div>
  );
}
