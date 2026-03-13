/**
 * ChatFeed.jsx — Affichage conversation-style des missions
 * Chaque mission = bulle utilisateur + activité agents + résultat
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

// ─── Typing indicator (trois points) ─────────────────────────────────────────
function ThinkingDots() {
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "2px 0" }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: "50%",
          background: "var(--primary)",
          display: "inline-block",
          animation: `dotBounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ─── Événement de mission (plan, tâche...) ────────────────────────────────────
function EventChip({ event }) {
  const map = {
    thinking:   { icon: "🧠", label: "Stratège réfléchit...", color: "var(--text-3)" },
    plan_ready: { icon: "📋", label: "Plan établi",           color: "var(--yellow)" },
    task_start: { icon: "⚡", label: "Tâche démarrée",        color: "var(--text-3)" },
    task_done:  { icon: "✓",  label: "Tâche terminée",        color: "var(--green)" },
  };
  const s = map[event.type] || { icon: "·", label: event.type, color: "var(--text-3)" };
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      fontSize: 11,
      color: s.color,
      padding: "2px 0",
    }}>
      <span style={{ fontSize: 10 }}>{s.icon}</span>
      <span>{s.label}</span>
      {event.model && <span style={{ color: "var(--text-3)", fontSize: 10 }}>· {event.model}</span>}
      {event.task && (
        <span style={{ color: "var(--text-3)", fontSize: 10 }}>
          · {String(event.task).substring(0, 40)}
        </span>
      )}
    </div>
  );
}

// ─── Bulle utilisateur ────────────────────────────────────────────────────────
function UserBubble({ command }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 20 }}>
      <div style={{
        maxWidth: "72%",
        background: "var(--surface-3)",
        border: "1px solid var(--border-2)",
        borderRadius: "var(--radius-lg) var(--radius-lg) 4px var(--radius-lg)",
        padding: "12px 16px",
        fontSize: 14,
        color: "var(--text)",
        lineHeight: 1.55,
        boxShadow: "var(--shadow-sm)",
      }}>
        {command}
      </div>
    </div>
  );
}

// ─── Bulle LaRuche (résultat) ─────────────────────────────────────────────────
function LaRucheBubble({ mission }) {
  const isRunning = mission.status === "pending" || mission.status === "running";
  const isSuccess = mission.status === "success";
  const isError   = mission.status === "error";

  return (
    <div style={{ display: "flex", gap: 10, marginBottom: 28, animation: "slideUp 0.2s ease" }}>
      {/* Avatar */}
      <div style={{
        width: 30, height: 30, borderRadius: "50%",
        background: "var(--primary-dim)",
        border: "1px solid var(--primary-glow)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 14, flexShrink: 0, marginTop: 2,
      }}>
        🐝
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Nom + durée */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>LaRuche</span>
          {isRunning && (
            <span style={{
              fontSize: 10, color: "var(--primary)",
              background: "var(--primary-dim)",
              padding: "1px 7px", borderRadius: 20,
              fontWeight: 500,
            }}>
              En cours
            </span>
          )}
          {isSuccess && mission.duration && (
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              {(mission.duration / 1000).toFixed(1)}s
            </span>
          )}
          {isError && (
            <span style={{
              fontSize: 10, color: "var(--red)",
              background: "rgba(248,113,113,0.1)",
              padding: "1px 7px", borderRadius: 20,
              fontWeight: 500,
            }}>
              Erreur
            </span>
          )}
        </div>

        {/* Activité agents (événements) */}
        {isRunning && (
          <div style={{ marginBottom: 10 }}>
            {(mission.events || []).map((ev, i) => (
              <EventChip key={i} event={ev} />
            ))}
            {(mission.events || []).length === 0 && (
              <div style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 6 }}>Démarrage...</div>
            )}
            <div style={{ marginTop: 8 }}>
              <ThinkingDots />
            </div>
          </div>
        )}

        {/* Résultat */}
        {isSuccess && mission.result && (
          <div style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
            borderRadius: "4px var(--radius-lg) var(--radius-lg) var(--radius-lg)",
            padding: "14px 16px",
            fontSize: 13.5,
            color: "var(--text)",
            lineHeight: 1.7,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            boxShadow: "var(--shadow-sm)",
          }}>
            {mission.result}
          </div>
        )}

        {/* Erreur */}
        {isError && (
          <div style={{
            background: "rgba(248,113,113,0.06)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "4px var(--radius-lg) var(--radius-lg) var(--radius-lg)",
            padding: "12px 14px",
            fontSize: 12,
            color: "var(--red)",
            fontFamily: "monospace",
          }}>
            {mission.error || "Une erreur est survenue."}
          </div>
        )}

        {/* Timeline d'événements (après succès) */}
        {isSuccess && (mission.events || []).length > 0 && (
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(mission.events || []).map((ev, i) => (
              <EventChip key={i} event={ev} />
            ))}
          </div>
        )}

        {/* Meta: modèles */}
        {isSuccess && mission.models?.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 10, color: "var(--text-3)", display: "flex", gap: 6, flexWrap: "wrap" }}>
            {mission.models.map(m => (
              <span key={m} style={{
                background: "var(--surface-3)",
                padding: "1px 7px",
                borderRadius: 20,
                border: "1px solid var(--border)",
              }}>
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Thread = une mission complète ────────────────────────────────────────────
function MissionThread({ mission }) {
  return (
    <div>
      <UserBubble command={mission.command} />
      <LaRucheBubble mission={mission} />
    </div>
  );
}

// ─── État vide ────────────────────────────────────────────────────────────────
function EmptyState({ onSuggest }) {
  const suggestions = [
    "Analyse l'architecture de ce projet et propose des améliorations",
    "Liste les 5 fichiers les plus gros et explique leur rôle",
    "Génère des tests unitaires pour butterflyLoop",
    "Crée un résumé de la documentation du projet",
  ];
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", flex: 1, padding: 40, textAlign: "center",
    }}>
      <div style={{ fontSize: 48, marginBottom: 20 }}>🐝</div>
      <div style={{ fontSize: 22, fontWeight: 600, color: "var(--text)", marginBottom: 8, letterSpacing: "-0.02em" }}>
        LaRuche HQ
      </div>
      <div style={{ fontSize: 14, color: "var(--text-2)", maxWidth: 400, marginBottom: 36 }}>
        Envoyez une mission à l'essaim d'agents IA. Ils décomposeront, exécuteront et synthétiseront les résultats.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, maxWidth: 520, width: "100%" }}>
        {suggestions.map((s, i) => (
          <button
            key={i}
            style={{
              background: "var(--surface-2)",
              border: "1px solid var(--border-2)",
              borderRadius: "var(--radius)",
              padding: "12px 14px",
              color: "var(--text-2)",
              fontSize: 12,
              cursor: "pointer",
              textAlign: "left",
              lineHeight: 1.4,
              transition: "all 0.15s",
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = "var(--surface-3)";
              e.currentTarget.style.color = "var(--text)";
              e.currentTarget.style.borderColor = "var(--border-3)";
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = "var(--surface-2)";
              e.currentTarget.style.color = "var(--text-2)";
              e.currentTarget.style.borderColor = "var(--border-2)";
            }}
            onClick={() => onSuggest?.(s)}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── ChatFeed principal ───────────────────────────────────────────────────────
export default function ChatFeed({ missions, activeMissionId, wsEvents, onRefresh, onSuggest }) {
  const [activeMission, setActiveMission] = useState(null);
  const bottomRef = useRef(null);
  const pollRef   = useRef(null);

  // Scroll automatique vers le bas
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [missions, activeMission]);

  // Polling mission active
  useEffect(() => {
    clearInterval(pollRef.current);
    if (!activeMissionId) {
      setActiveMission(null);
      return;
    }

    setActiveMission(prev => prev?.id === activeMissionId ? prev : { id: activeMissionId, status: "pending", events: [], command: "…" });

    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(`${QUEEN_API}/api/missions/${activeMissionId}`);
        if (!r.ok) return;
        const m = await r.json();
        setActiveMission(m);
        if (m.status === "success" || m.status === "error") {
          clearInterval(pollRef.current);
          onRefresh?.();
        }
      } catch {}
    }, 700);

    return () => clearInterval(pollRef.current);
  }, [activeMissionId]);

  // Intégration events WebSocket
  useEffect(() => {
    if (!wsEvents?.length || !activeMissionId) return;
    const last = wsEvents[wsEvents.length - 1];
    if (!last || last.missionId !== activeMissionId) return;

    setActiveMission(prev => {
      if (!prev) return prev;
      const already = (prev.events || []).some(e => e.type === last.type && e.ts === last.ts);
      if (already) return prev;
      return { ...prev, events: [...(prev.events || []), { ...last, ts: new Date().toISOString() }] };
    });
  }, [wsEvents, activeMissionId]);

  // Fusion missions pour l'affichage
  const displayMissions = activeMission
    ? [activeMission, ...missions.filter(m => m.id !== activeMission.id).slice(0, 12)]
    : missions.slice(0, 12);

  const isEmpty = displayMissions.length === 0;

  return (
    <div style={{
      flex: 1,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
    }}>
      {isEmpty ? (
        <EmptyState onSuggest={onSuggest} />
      ) : (
        <div style={{
          maxWidth: 760,
          width: "100%",
          margin: "0 auto",
          padding: "32px 24px 16px",
          flex: 1,
        }}>
          {/* Missions les plus anciennes en premier */}
          {[...displayMissions].reverse().map(m => (
            <MissionThread key={m.id || m.ts} mission={m} />
          ))}
          <div ref={bottomRef} />
        </div>
      )}
    </div>
  );
}
