/**
 * MissionResults.jsx — Affichage des résultats de missions en temps réel
 * Écoute les événements WebSocket + polling API pour mise à jour live
 */

import React, { useState, useEffect, useRef } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

const colors = {
  bg: "#0D0D1A",
  surface: "#1A1A2E",
  surfaceDeep: "#12122A",
  border: "rgba(124, 58, 237, 0.3)",
  gold: "#F5A623",
  purple: "#7C3AED",
  green: "#22C55E",
  red: "#EF4444",
  yellow: "#EAB308",
  text: "#E0E0E0",
  muted: "#64748B",
};

// ─── Indicateur de statut ────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const map = {
    pending:  { color: colors.muted,  icon: "⏳", label: "En attente" },
    running:  { color: colors.yellow, icon: "⚡", label: "En cours..." },
    success:  { color: colors.green,  icon: "✅", label: "Terminée" },
    error:    { color: colors.red,    icon: "❌", label: "Erreur" },
    partial:  { color: colors.yellow, icon: "⚠️", label: "Partielle" },
  };
  const s = map[status] || map.pending;
  return (
    <span style={{
      background: `${s.color}20`,
      border: `1px solid ${s.color}40`,
      borderRadius: 4,
      padding: "2px 6px",
      fontSize: 10,
      color: s.color,
      fontWeight: "bold",
    }}>
      {s.icon} {s.label}
    </span>
  );
}

// ─── Timeline d'événements ───────────────────────────────────────────────────
function EventTimeline({ events }) {
  if (!events?.length) return null;
  return (
    <div style={{ marginTop: 8, fontSize: 10, fontFamily: "monospace" }}>
      {events.slice(0, 10).map((ev, i) => (
        <div key={i} style={{
          display: "flex",
          gap: 8,
          padding: "2px 0",
          color: colors.muted,
          borderLeft: `2px solid rgba(124,58,237,0.3)`,
          paddingLeft: 8,
          marginBottom: 2,
        }}>
          <span style={{ color: colors.purple, minWidth: 60 }}>
            {new Date(ev.ts).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span>{ev.type}</span>
          {ev.model && <span style={{ color: colors.gold }}>→ {ev.model}</span>}
        </div>
      ))}
    </div>
  );
}

// ─── Carte d'une mission ──────────────────────────────────────────────────────
function MissionCard({ mission, expanded, onToggle }) {
  return (
    <div style={{
      background: expanded ? colors.surfaceDeep : "transparent",
      border: `1px solid ${expanded ? colors.border : "rgba(255,255,255,0.05)"}`,
      borderRadius: 10,
      padding: "10px 12px",
      cursor: "pointer",
      transition: "all 0.2s",
      marginBottom: 6,
    }}
    onClick={onToggle}
    >
      {/* En-tête */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            color: colors.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            marginBottom: 4,
          }}>
            {mission.command}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <StatusBadge status={mission.status} />
            {mission.duration && (
              <span style={{ fontSize: 10, color: colors.muted }}>
                ⏱ {(mission.duration / 1000).toFixed(1)}s
              </span>
            )}
            {mission.models?.length > 0 && (
              <span style={{ fontSize: 10, color: colors.muted }}>
                🤖 {mission.models.join(", ")}
              </span>
            )}
            <span style={{ fontSize: 10, color: colors.muted, marginLeft: "auto" }}>
              {expanded ? "▲" : "▼"}
            </span>
          </div>
        </div>
      </div>

      {/* Détail expandé */}
      {expanded && (
        <div style={{ marginTop: 12 }}>
          {/* Résultat */}
          {mission.result && (
            <div style={{
              background: "rgba(34,197,94,0.05)",
              border: "1px solid rgba(34,197,94,0.2)",
              borderRadius: 8,
              padding: "10px 12px",
              fontSize: 12,
              color: colors.text,
              lineHeight: 1.6,
              whiteSpace: "pre-wrap",
              maxHeight: 300,
              overflowY: "auto",
            }}>
              {mission.result}
            </div>
          )}
          {/* Erreur */}
          {mission.error && (
            <div style={{
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 8,
              padding: "8px 12px",
              fontSize: 11,
              color: colors.red,
              fontFamily: "monospace",
            }}>
              ❌ {mission.error}
            </div>
          )}
          {/* Timeline */}
          <EventTimeline events={mission.events} />
          {/* ID debug */}
          {mission.id && (
            <div style={{ marginTop: 6, fontSize: 9, color: colors.muted, fontFamily: "monospace" }}>
              ID: {mission.id}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Composant principal ──────────────────────────────────────────────────────
export default function MissionResults({ activeMissionId, wsEvents }) {
  const [missions, setMissions] = useState([]);
  const [activeMission, setActiveMission] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef(null);

  // Chargement initial de l'historique
  const loadHistory = async () => {
    try {
      const r = await fetch(`${QUEEN_API}/api/missions?limit=10`);
      if (!r.ok) return;
      const data = await r.json();
      setMissions(data.missions || []);
    } catch {}
  };

  useEffect(() => {
    loadHistory();
  }, []);

  // Suivi de la mission active (polling)
  useEffect(() => {
    if (!activeMissionId) {
      setActiveMission(null);
      return;
    }

    setActiveMission({ id: activeMissionId, status: "pending", events: [] });
    setExpandedId(activeMissionId);
    setLoading(true);

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${QUEEN_API}/api/missions/${activeMissionId}`);
        if (!r.ok) return;
        const mission = await r.json();
        setActiveMission(mission);

        if (mission.status === "success" || mission.status === "error") {
          clearInterval(pollRef.current);
          setLoading(false);
          // Recharger l'historique
          loadHistory();
        }
      } catch {}
    }, 800);

    return () => clearInterval(pollRef.current);
  }, [activeMissionId]);

  // Mise à jour depuis les événements WebSocket
  useEffect(() => {
    if (!wsEvents || !activeMissionId) return;
    const lastEvent = wsEvents[wsEvents.length - 1];
    if (!lastEvent || lastEvent.missionId !== activeMissionId) return;

    setActiveMission((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        events: [...(prev.events || []), { type: lastEvent.type, ts: new Date().toISOString(), ...lastEvent }],
      };
    });
  }, [wsEvents, activeMissionId]);

  // Combinaison mission active + historique (dédupliqué)
  const allMissions = activeMission
    ? [activeMission, ...missions.filter((m) => m.id !== activeMission.id)]
    : missions;

  return (
    <div style={{
      background: colors.surface,
      border: "1px solid rgba(124,58,237,0.3)",
      borderRadius: 12,
      padding: 16,
      flex: 1,
      minHeight: 200,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <div style={{ color: colors.gold, fontSize: 12, fontWeight: "bold" }}>
          📋 RÉSULTATS DES MISSIONS
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {loading && (
            <div style={{ fontSize: 10, color: colors.yellow, display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ animation: "pulse 1.5s infinite" }}>⚡</span>
              En cours...
            </div>
          )}
          <button
            onClick={loadHistory}
            style={{
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: 6,
              color: colors.muted,
              padding: "3px 8px",
              cursor: "pointer",
              fontSize: 10,
            }}
          >
            ↻ Actualiser
          </button>
        </div>
      </div>

      {/* Liste des missions */}
      {allMissions.length === 0 ? (
        <div style={{
          textAlign: "center",
          color: colors.muted,
          fontSize: 12,
          padding: "30px 0",
        }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🐝</div>
          <div>Aucune mission pour l'instant.</div>
          <div style={{ fontSize: 10, marginTop: 4 }}>Envoyez votre première mission ci-dessus !</div>
        </div>
      ) : (
        <div style={{ maxHeight: 400, overflowY: "auto" }}>
          {allMissions.map((m) => (
            <MissionCard
              key={m.id || m.ts}
              mission={m}
              expanded={expandedId === (m.id || m.ts)}
              onToggle={() => setExpandedId((prev) => (prev === (m.id || m.ts) ? null : (m.id || m.ts)))}
            />
          ))}
        </div>
      )}

      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>
    </div>
  );
}
