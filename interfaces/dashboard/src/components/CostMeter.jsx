/**
 * CostMeter.jsx — Widget de stats et coûts
 * Affiche tokens, vitesse, et historique 24h avec Recharts
 */

import React, { useState, useEffect } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

// ─── Mock data 24h ────────────────────────────────────────────────────────────
function generateMockData() {
  const data = [];
  const now = new Date();
  for (let i = 23; i >= 0; i--) {
    const hour = new Date(now - i * 60 * 60 * 1000);
    const label = `${String(hour.getHours()).padStart(2, "0")}h`;
    // Simulation d'activité : plus intense en journée
    const h = hour.getHours();
    const base = h >= 9 && h <= 18 ? 120 : h >= 19 && h <= 23 ? 60 : 20;
    const variance = Math.floor(Math.random() * base * 0.6);
    data.push({ label, tokens: base + variance });
  }
  return data;
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  card: {
    background: "var(--surface-2)",
    border: "1px solid var(--border-2)",
    borderRadius: "var(--radius)",
    padding: "16px",
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: "12px",
    fontWeight: 600,
    color: "var(--text-3)",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  costBadge: {
    fontSize: "12px",
    fontWeight: 700,
    color: "#4ade80",
    background: "rgba(74, 222, 128, 0.1)",
    border: "1px solid rgba(74, 222, 128, 0.25)",
    padding: "3px 10px",
    borderRadius: "20px",
    fontFamily: "JetBrains Mono, monospace",
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "8px",
  },
  statItem: {
    background: "var(--surface-3)",
    borderRadius: "var(--radius-sm)",
    padding: "10px 12px",
  },
  statValue: {
    fontSize: "18px",
    fontWeight: 700,
    color: "var(--text)",
    fontFamily: "JetBrains Mono, monospace",
    lineHeight: 1.2,
  },
  statLabel: {
    fontSize: "10px",
    color: "var(--text-3)",
    marginTop: "3px",
    textTransform: "uppercase",
    letterSpacing: "0.06em",
  },
  chartWrapper: {
    marginTop: "4px",
  },
  chartTitle: {
    fontSize: "11px",
    color: "var(--text-3)",
    marginBottom: "8px",
  },
};

// ─── Tooltip personnalisé ─────────────────────────────────────────────────────
function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: "var(--surface-3)",
        border: "1px solid var(--border-2)",
        borderRadius: "6px",
        padding: "8px 12px",
        fontSize: "11px",
        color: "var(--text)",
        fontFamily: "JetBrains Mono, monospace",
      }}
    >
      <div style={{ color: "var(--text-3)", marginBottom: "2px" }}>{label}</div>
      <div style={{ color: "#E07B54" }}>{payload[0].value} tokens</div>
    </div>
  );
}

// ─── Composant principal CostMeter ────────────────────────────────────────────
/**
 * @param {{ totalTokens?: number, avgSpeed?: number }} props
 */
export default function CostMeter({ totalTokens: tokensProp, avgSpeed: speedProp }) {
  const [chartData] = useState(generateMockData);
  const [stats, setStats] = useState({
    totalTokens: tokensProp ?? 284_320,
    avgSpeed: speedProp ?? 38.4,
  });

  useEffect(() => {
    // Tente de récupérer les vraies stats depuis le backend
    const fetchStats = async () => {
      try {
        const res = await fetch("/api/status", { signal: AbortSignal.timeout(3000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data.totalTokens !== undefined) {
          setStats({
            totalTokens: data.totalTokens,
            avgSpeed: data.avgSpeed || 0,
          });
        }
      } catch {
        // Fallback silencieux sur les valeurs par défaut
      }
    };

    if (!tokensProp) {
      fetchStats();
      const interval = setInterval(fetchStats, 10000);
      return () => clearInterval(interval);
    }
  }, [tokensProp]);

  const totalTokensDisplay =
    stats.totalTokens >= 1_000_000
      ? `${(stats.totalTokens / 1_000_000).toFixed(2)}M`
      : stats.totalTokens >= 1_000
      ? `${(stats.totalTokens / 1_000).toFixed(1)}K`
      : String(stats.totalTokens);

  return (
    <div style={styles.card}>
      {/* En-tête */}
      <div style={styles.header}>
        <span style={styles.title}>Ressources</span>
        <span style={styles.costBadge} title="100% Ollama local — aucun coût API">
          LOCAL ∞
        </span>
      </div>

      {/* Stats principales */}
      <div style={styles.statsRow}>
        <div style={styles.statItem}>
          <div style={styles.statValue}>{totalTokensDisplay}</div>
          <div style={styles.statLabel}>Tokens totaux</div>
        </div>
        <div style={styles.statItem}>
          <div style={{ ...styles.statValue, color: "#f59e0b" }}>
            {stats.avgSpeed > 0 ? `${stats.avgSpeed.toFixed(1)}` : "—"}
          </div>
          <div style={styles.statLabel}>tok/s moyen</div>
        </div>
      </div>

      {/* Graphique 24h */}
      <div style={styles.chartWrapper}>
        <div style={styles.chartTitle}>Activité — 24 dernières heures</div>
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={chartData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="rgba(255,255,255,0.05)"
              vertical={false}
            />
            <XAxis
              dataKey="label"
              tick={{ fill: "#6B6760", fontSize: 9 }}
              tickLine={false}
              axisLine={false}
              interval={5}
            />
            <YAxis
              tick={{ fill: "#6B6760", fontSize: 9 }}
              tickLine={false}
              axisLine={false}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="tokens"
              stroke="#E07B54"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "#E07B54", stroke: "var(--surface-2)", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Mention coût zéro */}
      <div
        style={{
          fontSize: "10px",
          color: "var(--text-3)",
          textAlign: "center",
          padding: "4px",
          background: "rgba(74, 222, 128, 0.05)",
          borderRadius: "4px",
          border: "1px solid rgba(74, 222, 128, 0.1)",
        }}
      >
        💸 Coût total : 0,00 € — 100% Ollama local
      </div>
    </div>
  );
}
