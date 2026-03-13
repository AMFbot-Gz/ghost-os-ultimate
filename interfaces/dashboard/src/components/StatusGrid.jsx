/**
 * StatusGrid.jsx — Grille 2x2 des agents IA actifs
 * Affiche l'état en temps réel de chaque agent Ollama
 */

import React, { useState, useEffect } from "react";

// ─── Mock data par défaut ─────────────────────────────────────────────────────
const MOCK_AGENTS = [
  {
    id: "strategist",
    name: "Stratège",
    icon: "🧠",
    color: "#6366f1",
    model: "llama3.2",
    status: "idle",
    tokensPerSec: 0,
    lastTask: "En attente...",
  },
  {
    id: "architect",
    name: "Architecte",
    icon: "⚡",
    color: "#3b82f6",
    model: "codellama",
    status: "running",
    tokensPerSec: 42.7,
    lastTask: "Analyse architecture...",
  },
  {
    id: "worker",
    name: "Worker",
    icon: "🔧",
    color: "#f59e0b",
    model: "mistral",
    status: "idle",
    tokensPerSec: 0,
    lastTask: "En attente...",
  },
  {
    id: "vision",
    name: "Vision",
    icon: "👁",
    color: "#10b981",
    model: "llava",
    status: "idle",
    tokensPerSec: 0,
    lastTask: "En attente...",
  },
];

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  container: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "12px",
    padding: "16px",
  },
  card: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "var(--radius)",
    padding: "16px",
    cursor: "default",
    transition: "all 0.2s ease",
    position: "relative",
    overflow: "hidden",
  },
  cardActive: {
    borderColor: "#f59e0b",
    boxShadow: "0 0 16px rgba(245, 158, 11, 0.2)",
  },
  cardHeader: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "10px",
  },
  iconWrapper: {
    width: "36px",
    height: "36px",
    borderRadius: "8px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "18px",
    flexShrink: 0,
  },
  agentName: {
    fontSize: "13px",
    fontWeight: 600,
    color: "var(--text)",
    marginBottom: "2px",
  },
  modelBadge: {
    fontSize: "11px",
    color: "var(--text-3)",
    fontFamily: "JetBrains Mono, monospace",
  },
  statusRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "8px",
  },
  statusBadge: {
    display: "flex",
    alignItems: "center",
    gap: "5px",
    fontSize: "11px",
    fontWeight: 500,
  },
  dot: {
    width: "6px",
    height: "6px",
    borderRadius: "50%",
  },
  tokensPerSec: {
    fontSize: "11px",
    fontFamily: "JetBrains Mono, monospace",
    color: "var(--text-3)",
  },
  lastTask: {
    fontSize: "11px",
    color: "var(--text-2)",
    marginTop: "8px",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  sectionTitle: {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--text-3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    padding: "16px 16px 0",
  },
  // Pulse animation pour les agents actifs
  pulseRing: {
    position: "absolute",
    top: "8px",
    right: "8px",
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    background: "#f59e0b",
    animation: "pulse 2s ease-in-out infinite",
  },
};

// ─── Composant AgentCard ──────────────────────────────────────────────────────
function AgentCard({ agent }) {
  const isRunning = agent.status === "running";
  const statusColor = isRunning ? "#f59e0b" : agent.status === "error" ? "#f87171" : "#4ade80";
  const statusLabel = isRunning ? "actif" : agent.status === "error" ? "erreur" : "inactif";

  return (
    <div
      style={{
        ...styles.card,
        ...(isRunning ? styles.cardActive : {}),
      }}
    >
      {/* Indicateur pulse sur carte active */}
      {isRunning && <div style={styles.pulseRing} />}

      <div style={styles.cardHeader}>
        {/* Icône agent */}
        <div
          style={{
            ...styles.iconWrapper,
            background: `${agent.color}22`,
            border: `1px solid ${agent.color}44`,
          }}
        >
          {agent.icon}
        </div>
        <div>
          <div style={{ ...styles.agentName, color: isRunning ? agent.color : "var(--text)" }}>
            {agent.name}
          </div>
          <div style={styles.modelBadge}>{agent.model}</div>
        </div>
      </div>

      {/* Statut + tokens/sec */}
      <div style={styles.statusRow}>
        <div style={{ ...styles.statusBadge, color: statusColor }}>
          <div style={{ ...styles.dot, background: statusColor }} />
          {statusLabel}
        </div>
        {isRunning && agent.tokensPerSec > 0 && (
          <div style={styles.tokensPerSec}>{agent.tokensPerSec.toFixed(1)} tok/s</div>
        )}
      </div>

      {/* Dernière tâche */}
      <div style={styles.lastTask}>{agent.lastTask}</div>
    </div>
  );
}

// ─── Composant principal StatusGrid ──────────────────────────────────────────
/**
 * @param {{ agents?: Array }} props
 *   agents — tableau d'agents (optionnel, fallback sur mock + /api/agents)
 */
export default function StatusGrid({ agents: agentsProp }) {
  const [agents, setAgents] = useState(MOCK_AGENTS);
  const [loading, setLoading] = useState(!agentsProp);
  const [error, setError] = useState(null);

  useEffect(() => {
    // Si les agents sont fournis en prop, on les utilise directement
    if (agentsProp) {
      setAgents(agentsProp);
      setLoading(false);
      return;
    }

    // Sinon, on tente de fetch depuis l'API
    const fetchAgents = async () => {
      try {
        const res = await fetch("/api/agents", { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setAgents(data.agents || data);
      } catch {
        // Fallback silencieux sur mock data
        setAgents(MOCK_AGENTS);
      } finally {
        setLoading(false);
      }
    };

    fetchAgents();
    // Rafraîchissement toutes les 5s
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [agentsProp]);

  if (loading) {
    return (
      <div style={{ padding: "16px" }}>
        <div style={styles.sectionTitle}>Agents IA</div>
        <div style={{ ...styles.container, opacity: 0.5 }}>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                ...styles.card,
                height: "100px",
                background: "linear-gradient(90deg, var(--surface-2) 25%, var(--surface-3) 50%, var(--surface-2) 75%)",
                backgroundSize: "400px 100%",
                animation: "shimmer 1.5s infinite",
              }}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={styles.sectionTitle}>
        Agents IA
        {error && (
          <span style={{ color: "var(--red)", fontSize: "10px", marginLeft: "8px", textTransform: "none" }}>
            (mode local)
          </span>
        )}
      </div>
      <div style={styles.container}>
        {agents.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  );
}
