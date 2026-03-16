/**
 * HITLPage.jsx — Human-in-the-Loop Real-time Dashboard
 * File d'attente, historique des décisions, statistiques
 */
import React, { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "../Toast.jsx";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";
const QUEEN_DIRECT = "http://localhost:8001";

const RISK_COLOR = {
  high:    { bg: "rgba(239,68,68,0.12)",  text: "#ef4444", label: "HIGH" },
  medium:  { bg: "rgba(245,158,11,0.12)", text: "#f59e0b", label: "MED"  },
  low:     { bg: "rgba(34,197,94,0.12)",  text: "#22c55e", label: "LOW"  },
};

const DECISION_COLOR = {
  approved: { bg: "rgba(34,197,94,0.12)",   text: "#22c55e",  label: "APPROUVÉ" },
  rejected: { bg: "rgba(239,68,68,0.12)",   text: "#ef4444",  label: "REJETÉ"   },
  timeout:  { bg: "rgba(148,163,184,0.12)", text: "#94a3b8",  label: "TIMEOUT"  },
};

function Badge({ cfg, text }) {
  return (
    <span style={{
      background: cfg.bg, color: cfg.text,
      borderRadius: 4, padding: "2px 7px",
      fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
    }}>{text || cfg.label}</span>
  );
}

function Card({ title, value, sub, color }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "18px 22px", flex: 1, minWidth: 140,
    }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: color || "var(--text)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function CountdownBar({ remaining, total }) {
  const pct = Math.max(0, Math.min(100, (remaining / total) * 100));
  const color = pct > 50 ? "#22c55e" : pct > 20 ? "#f59e0b" : "#ef4444";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 4, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, transition: "width 1s linear" }} />
      </div>
      <span style={{ fontSize: 11, color, fontWeight: 600, width: 32, textAlign: "right" }}>{remaining}s</span>
    </div>
  );
}

// ─── Queue Tab ─────────────────────────────────────────────────────────────

function QueueTab({ queue, onApprove, onReject, loading }) {
  if (queue.items?.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--text-3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✅</div>
        <div style={{ fontSize: 14 }}>Aucune action en attente</div>
        <div style={{ fontSize: 12, marginTop: 6 }}>L'agent tourne sans supervision humaine requise</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {queue.items?.map(item => {
        const risk = RISK_COLOR[item.subtask?.risk || "high"];
        return (
          <div key={item.hitl_id} style={{
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 10, padding: 20,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <Badge cfg={risk} />
                  <span style={{ fontSize: 11, color: "var(--text-3)", fontFamily: "monospace" }}>{item.hitl_id}</span>
                  {item.mission_id && (
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>· mission {item.mission_id.slice(0, 8)}</span>
                  )}
                </div>
                <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>
                  {item.action}
                </div>
                {item.input_text && (
                  <div style={{
                    fontSize: 12, color: "var(--text-2)", background: "var(--surface-2)",
                    borderRadius: 6, padding: "8px 12px", fontFamily: "monospace",
                    maxHeight: 80, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all",
                  }}>{item.input_text}</div>
                )}
              </div>
            </div>

            <CountdownBar remaining={item.timeout_in_seconds} total={queue.timeout_seconds || 120} />

            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                onClick={() => onApprove(item.hitl_id)}
                disabled={loading}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 7, border: "none",
                  background: "#22c55e", color: "white", fontSize: 13, fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
                }}
              >✅ Approuver</button>
              <button
                onClick={() => onReject(item.hitl_id)}
                disabled={loading}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 7, border: "none",
                  background: "#ef4444", color: "white", fontSize: 13, fontWeight: 600,
                  cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1,
                }}
              >🛑 Rejeter</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── History Tab ────────────────────────────────────────────────────────────

function HistoryTab({ history }) {
  if (!history.length) {
    return (
      <div style={{ textAlign: "center", padding: 60, color: "var(--text-3)" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
        <div style={{ fontSize: 14 }}>Aucune décision enregistrée</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {history.map((item, i) => {
        const dec = DECISION_COLOR[item.decision] || DECISION_COLOR.timeout;
        const risk = RISK_COLOR[item.risk] || RISK_COLOR.high;
        const decided = new Date(item.decided_at).toLocaleTimeString("fr-FR");
        return (
          <div key={item.hitl_id + i} style={{
            display: "flex", alignItems: "center", gap: 12,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "12px 16px",
          }}>
            <Badge cfg={dec} />
            <Badge cfg={risk} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {item.action}
              </div>
              {item.mission_id && (
                <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2 }}>
                  mission {item.mission_id.slice(0, 8)} · {item.hitl_id}
                </div>
              )}
            </div>
            <span style={{ fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{decided}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Stats Tab ───────────────────────────────────────────────────────────────

function StatsTab({ stats }) {
  const total = stats?.total || 0;
  const approved = stats?.approved || 0;
  const rejected = stats?.rejected || 0;
  const timeout  = stats?.timeout  || 0;
  const bars = [
    { label: "Approuvés", value: approved, color: "#22c55e" },
    { label: "Rejetés",   value: rejected, color: "#ef4444" },
    { label: "Timeout",   value: timeout,  color: "#94a3b8" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Card title="Total décisions" value={total} color="var(--text)" />
        <Card title="Taux approbation" value={`${stats?.approval_rate ?? 0}%`} color="#22c55e" />
        <Card title="Temps moyen" value={`${Math.round((stats?.avg_response_ms || 0) / 1000)}s`} sub="réponse humaine" color="var(--primary, #E07B54)" />
        <Card title="En attente" value={stats?.pending || 0} color="#f59e0b" sub="dans la file" />
      </div>

      {total > 0 && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "20px 24px",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 16 }}>Répartition des décisions</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {bars.map(b => {
              const pct = total > 0 ? (b.value / total) * 100 : 0;
              return (
                <div key={b.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 12, color: "var(--text-2)" }}>{b.label}</span>
                    <span style={{ fontSize: 12, color: b.color, fontWeight: 600 }}>{b.value} ({pct.toFixed(0)}%)</span>
                  </div>
                  <div style={{ height: 8, background: "var(--border)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ width: `${pct}%`, height: "100%", background: b.color, borderRadius: 4, transition: "width 0.4s ease" }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

const TABS = [
  { id: "queue",   label: "File d'attente" },
  { id: "history", label: "Historique" },
  { id: "stats",   label: "Statistiques" },
];

export default function HITLPage() {
  const [tab, setTab]       = useState("queue");
  const [queue, setQueue]   = useState({ count: 0, timeout_seconds: 120, items: [] });
  const [history, setHistory] = useState([]);
  const [stats, setStats]   = useState({});
  const [loading, setLoading] = useState(false);
  const intervalRef = useRef(null);
  const { toast } = useToast() || {};

  const fetchAll = useCallback(async () => {
    try {
      const [qRes, hRes, sRes] = await Promise.all([
        fetch(`${QUEEN_DIRECT}/hitl/queue`),
        fetch(`${QUEEN_DIRECT}/hitl/history?limit=100`),
        fetch(`${QUEEN_DIRECT}/hitl/stats`),
      ]);
      if (qRes.ok) setQueue(await qRes.json());
      if (hRes.ok) { const d = await hRes.json(); setHistory(d.items || []); }
      if (sRes.ok) setStats(await sRes.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchAll();
    intervalRef.current = setInterval(fetchAll, 3000);
    return () => clearInterval(intervalRef.current);
  }, [fetchAll]);

  const handleApprove = async (hitl_id) => {
    setLoading(true);
    try {
      const r = await fetch(`${QUEEN_DIRECT}/hitl/approve/${hitl_id}`, { method: "POST" });
      if (r.ok) {
        toast?.("Action approuvée ✅", "success");
        fetchAll();
      } else {
        toast?.("Erreur lors de l'approbation", "error");
      }
    } catch { toast?.("Serveur inaccessible", "error"); }
    setLoading(false);
  };

  const handleReject = async (hitl_id) => {
    setLoading(true);
    try {
      const r = await fetch(`${QUEEN_DIRECT}/hitl/reject/${hitl_id}`, { method: "POST" });
      if (r.ok) {
        toast?.("Action rejetée 🛑", "warn");
        fetchAll();
      } else {
        toast?.("Erreur lors du rejet", "error");
      }
    } catch { toast?.("Serveur inaccessible", "error"); }
    setLoading(false);
  };

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: "var(--text)" }}>
            Human-in-the-Loop
          </h1>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--text-3)" }}>
            Validation en temps réel des actions à haut risque
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {queue.count > 0 && (
            <div style={{
              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.4)",
              borderRadius: 20, padding: "5px 14px",
              fontSize: 13, fontWeight: 700, color: "#ef4444",
              animation: "pulse 2s infinite",
            }}>
              ⚠️ {queue.count} en attente
            </div>
          )}
          <button
            onClick={fetchAll}
            style={{
              background: "var(--surface-2)", border: "1px solid var(--border-2)",
              borderRadius: 7, padding: "7px 14px", color: "var(--text-2)",
              fontSize: 12, cursor: "pointer",
            }}
          >↺ Actualiser</button>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, background: "var(--surface)",
        borderRadius: 8, padding: 4, border: "1px solid var(--border)",
        marginBottom: 24, width: "fit-content",
      }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "7px 18px", borderRadius: 6, border: "none",
              background: tab === t.id ? "var(--primary, #E07B54)" : "transparent",
              color: tab === t.id ? "white" : "var(--text-2)",
              fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
              cursor: "pointer", transition: "all 0.12s",
              position: "relative",
            }}
          >
            {t.label}
            {t.id === "queue" && queue.count > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#ef4444", color: "white",
                borderRadius: 10, padding: "0 5px", fontSize: 9, fontWeight: 700, lineHeight: "16px",
                minWidth: 16, textAlign: "center",
              }}>{queue.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "queue"   && <QueueTab queue={queue} onApprove={handleApprove} onReject={handleReject} loading={loading} />}
      {tab === "history" && <HistoryTab history={history} />}
      {tab === "stats"   && <StatsTab stats={stats} />}
    </div>
  );
}
