/**
 * OptimizerPage.jsx — Phase 21 : Self-Optimization Engine
 * Dashboard du moteur d'auto-optimisation (Miner → Evolution → Validator)
 */
import React, { useState, useEffect, useCallback } from "react";

const OPTIMIZER_URL = "http://localhost:8003";  // via brain proxy /optimizer/*

const STATUS_COLORS = {
  deployed:    { color: "#a6e3a1", bg: "rgba(166,227,161,0.15)", emoji: "✅" },
  quarantined: { color: "#f38ba8", bg: "rgba(243,139,168,0.12)", emoji: "🔒" },
  gen_failed:  { color: "#f38ba8", bg: "rgba(243,139,168,0.12)", emoji: "❌" },
  failed:      { color: "#f38ba8", bg: "rgba(243,139,168,0.12)", emoji: "❌" },
  skipped:     { color: "#6c7086", bg: "rgba(108,112,134,0.12)", emoji: "⏭️" },
  running:     { color: "#89b4fa", bg: "rgba(137,180,250,0.12)", emoji: "⚡" },
  done:        { color: "#a6e3a1", bg: "rgba(166,227,161,0.12)", emoji: "✅" },
  error:       { color: "#f38ba8", bg: "rgba(243,139,168,0.12)", emoji: "❌" },
};

const TIER_META = {
  gold:       { label: "GOLD",       color: "#f9e2af", emoji: "🥇" },
  silver:     { label: "SILVER",     color: "#cdd6f4", emoji: "🥈" },
  bronze:     { label: "BRONZE",     color: "#fab387", emoji: "🥉" },
  quarantine: { label: "QUARANTAINE",color: "#f38ba8", emoji: "🔒" },
  error:      { label: "ERROR",      color: "#585b70", emoji: "⚠️" },
};

const DOMAIN_COLORS = {
  ui:     "#cba6f7",
  code:   "#89b4fa",
  file:   "#a6e3a1",
  web:    "#f9e2af",
  system: "#fab387",
};

// ── helpers ─────────────────────────────────────────────────────────────────

function fmtConf(v) {
  if (v == null) return "—";
  return (v * 100).toFixed(1) + "%";
}

function fmtDuration(start, end) {
  if (!start || !end) return "—";
  const ms = new Date(end) - new Date(start);
  if (ms < 1000) return ms + "ms";
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
  return Math.round(ms / 60000) + "min";
}

function fmtTs(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  return d.toLocaleTimeString("fr-FR");
}

async function apiFetch(path, opts = {}) {
  const r = await fetch(`${OPTIMIZER_URL}/optimizer${path}`, opts);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// ── Sub-components ───────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color = "#cdd6f4" }) {
  return (
    <div style={{
      background: "var(--surface-1,#1e1e2e)",
      border: "1px solid var(--border,#313244)",
      borderRadius: 10,
      padding: "14px 18px",
      minWidth: 130,
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: "#6c7086", marginTop: 2 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: "#585b70", marginTop: 1 }}>{sub}</div>}
    </div>
  );
}

function StatusBadge({ status }) {
  const m = STATUS_COLORS[status] || STATUS_COLORS.error;
  return (
    <span style={{
      background: m.bg,
      color: m.color,
      border: `1px solid ${m.color}30`,
      borderRadius: 6,
      padding: "2px 8px",
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: "nowrap",
    }}>
      {m.emoji} {status}
    </span>
  );
}

function TierBadge({ tier }) {
  if (!tier) return <span style={{ color: "#6c7086", fontSize: 11 }}>—</span>;
  const m = TIER_META[tier] || TIER_META.error;
  return (
    <span style={{
      color: m.color,
      background: `${m.color}18`,
      border: `1px solid ${m.color}40`,
      borderRadius: 5,
      padding: "1px 7px",
      fontSize: 11,
      fontWeight: 700,
    }}>
      {m.emoji} {m.label}
    </span>
  );
}

function DomainDot({ domain }) {
  const color = DOMAIN_COLORS[domain] || "#6c7086";
  return (
    <span style={{
      display: "inline-block",
      width: 8, height: 8,
      borderRadius: "50%",
      background: color,
      marginRight: 5,
      verticalAlign: "middle",
    }} />
  );
}

function ConfBar({ value }) {
  if (value == null) return null;
  const pct = Math.round(value * 100);
  const color = value >= 0.85 ? "#a6e3a1" : value >= 0.65 ? "#cdd6f4" : value >= 0.40 ? "#fab387" : "#f38ba8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ width: 60, height: 6, borderRadius: 3, background: "#313244", overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 3 }} />
      </div>
      <span style={{ fontSize: 11, color }}>{pct}%</span>
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────

function OverviewTab({ stats, status, onTrigger, triggering }) {
  if (!stats) return <div style={{ color: "#6c7086", padding: 20 }}>Chargement…</div>;
  const { cycles = {}, actions = {}, avg_confidence, loop_interval_s } = stats;
  const lc = status?.last_cycle;

  const deployRate = actions.total > 0
    ? ((actions.deployed / actions.total) * 100).toFixed(1)
    : "0";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Status banner */}
      <div style={{
        background: status?.running
          ? "rgba(137,180,250,0.10)"
          : "rgba(166,227,161,0.08)",
        border: `1px solid ${status?.running ? "#89b4fa" : "#a6e3a1"}40`,
        borderRadius: 10,
        padding: "12px 18px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 18 }}>{status?.running ? "⚡" : "💤"}</span>
          <div>
            <div style={{ fontWeight: 600, color: status?.running ? "#89b4fa" : "#a6e3a1", fontSize: 14 }}>
              {status?.running
                ? `Cycle en cours : ${status.current_cycle}`
                : `En attente — prochain cycle dans ~${Math.round(loop_interval_s / 60)}min`
              }
            </div>
            {lc && (
              <div style={{ fontSize: 11, color: "#6c7086" }}>
                Dernier cycle : {lc.id} · {fmtTs(lc.started_at)}
                &nbsp;({fmtDuration(lc.started_at, lc.ended_at)})
              </div>
            )}
          </div>
        </div>
        <button
          onClick={onTrigger}
          disabled={triggering || status?.running}
          style={{
            background: "#89b4fa",
            color: "#1e1e2e",
            border: "none",
            borderRadius: 7,
            padding: "7px 16px",
            fontWeight: 700,
            fontSize: 12,
            cursor: triggering || status?.running ? "not-allowed" : "pointer",
            opacity: triggering || status?.running ? 0.5 : 1,
          }}
        >
          {triggering ? "⏳ Lancement…" : "⚡ Optimiser maintenant"}
        </button>
      </div>

      {/* KPIs */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <KpiCard label="Cycles terminés"    value={cycles.done || 0}       color="#a6e3a1" />
        <KpiCard label="Actions totales"    value={actions.total || 0}      color="#cdd6f4" />
        <KpiCard label="Skills déployés"    value={actions.deployed || 0}   color="#a6e3a1" />
        <KpiCard label="Mis en quarantaine" value={actions.quarantined || 0} color="#f38ba8" />
        <KpiCard label="Échecs génération"  value={actions.gen_failed || 0}  color="#fab387" />
        <KpiCard
          label="Confiance moy."
          value={fmtConf(avg_confidence)}
          color="#cba6f7"
          sub="skills validés"
        />
        <KpiCard
          label="Taux déploiement"
          value={`${deployRate}%`}
          color="#89b4fa"
          sub="actions déployées"
        />
      </div>

      {/* Dernier cycle détail */}
      {lc && (
        <div style={{
          background: "var(--surface-1,#1e1e2e)",
          border: "1px solid var(--border,#313244)",
          borderRadius: 10,
          padding: "14px 18px",
        }}>
          <div style={{ fontWeight: 600, marginBottom: 10, color: "#cdd6f4", fontSize: 13 }}>
            Dernier cycle : {lc.id}
          </div>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
            {[
              ["Gaps trouvés",      lc.gaps_found,  "#f9e2af"],
              ["Skills générés",    lc.skills_gen,  "#cdd6f4"],
              ["Skills déployés",   lc.skills_pass, "#a6e3a1"],
              ["Échecs",            lc.skills_fail, "#f38ba8"],
            ].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: c }}>{v ?? 0}</div>
                <div style={{ fontSize: 11, color: "#6c7086" }}>{l}</div>
              </div>
            ))}
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#cdd6f4" }}>
                {fmtDuration(lc.started_at, lc.ended_at)}
              </div>
              <div style={{ fontSize: 11, color: "#6c7086" }}>Durée</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CyclesTab({ cycles }) {
  if (!cycles?.length) return (
    <div style={{ color: "#6c7086", textAlign: "center", padding: 40 }}>
      Aucun cycle enregistré
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {cycles.map(cycle => (
        <div key={cycle.id} style={{
          background: "var(--surface-1,#1e1e2e)",
          border: "1px solid var(--border,#313244)",
          borderRadius: 10,
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: 16,
        }}>
          <code style={{ fontSize: 12, color: "#89b4fa", minWidth: 70 }}>
            #{cycle.id}
          </code>
          <StatusBadge status={cycle.status} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 11, color: "#6c7086" }}>
              {fmtTs(cycle.started_at)} · {fmtDuration(cycle.started_at, cycle.ended_at)}
            </div>
          </div>
          {[
            [cycle.gaps_found,  "gaps",   "#f9e2af"],
            [cycle.skills_gen,  "générés","#cdd6f4"],
            [cycle.skills_pass, "✅",     "#a6e3a1"],
            [cycle.skills_fail, "❌",     "#f38ba8"],
          ].map(([v, l, c]) => (
            <div key={l} style={{ textAlign: "center", minWidth: 40 }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: c }}>{v ?? 0}</div>
              <div style={{ fontSize: 10, color: "#585b70" }}>{l}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ActionsTab({ actions }) {
  if (!actions?.length) return (
    <div style={{ color: "#6c7086", textAlign: "center", padding: 40 }}>
      Aucune action enregistrée
    </div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ color: "#6c7086", textAlign: "left" }}>
            {["Cycle","Pattern","Domaine","Skill","Tier","Conf","Statut","Heure"].map(h => (
              <th key={h} style={{ padding: "6px 10px", borderBottom: "1px solid #313244", fontWeight: 600 }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {actions.map(a => (
            <tr key={a.id} style={{ borderBottom: "1px solid #1e1e2e" }}>
              <td style={{ padding: "7px 10px" }}>
                <code style={{ color: "#89b4fa", fontSize: 11 }}>#{a.cycle_id}</code>
              </td>
              <td style={{ padding: "7px 10px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                <span title={a.gap_pattern} style={{ color: "#cdd6f4" }}>{a.gap_pattern}</span>
                <span style={{ marginLeft: 5, color: "#6c7086", fontSize: 10 }}>
                  ({a.gap_score?.toFixed(2)})
                </span>
              </td>
              <td style={{ padding: "7px 10px" }}>
                <DomainDot domain={a.domain} />
                <span style={{ color: "#9399b2" }}>{a.domain}</span>
              </td>
              <td style={{ padding: "7px 10px", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis" }}>
                <code style={{ color: "#cba6f7", fontSize: 11 }}>{a.skill_name || "—"}</code>
              </td>
              <td style={{ padding: "7px 10px" }}>
                <TierBadge tier={a.tier} />
              </td>
              <td style={{ padding: "7px 10px" }}>
                <ConfBar value={a.confidence} />
              </td>
              <td style={{ padding: "7px 10px" }}>
                <StatusBadge status={a.status} />
              </td>
              <td style={{ padding: "7px 10px", color: "#6c7086", fontSize: 11 }}>
                {fmtTs(a.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function OptimizerPage() {
  const [tab, setTab]         = useState("overview");
  const [stats, setStats]     = useState(null);
  const [status, setStatus]   = useState(null);
  const [cycles, setCycles]   = useState([]);
  const [actions, setActions] = useState([]);
  const [triggering, setTriggering] = useState(false);
  const [error, setError]     = useState(null);

  const loadAll = useCallback(async () => {
    try {
      const [s, st, cy, ac] = await Promise.all([
        apiFetch("/stats"),
        apiFetch("/status"),
        apiFetch("/cycles?limit=20"),
        apiFetch("/actions?limit=50"),
      ]);
      setStats(s);
      setStatus(st);
      setCycles(cy.cycles || []);
      setActions(ac.actions || []);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    loadAll();
    const id = setInterval(loadAll, 8000);
    return () => clearInterval(id);
  }, [loadAll]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await apiFetch("/optimize", { method: "POST" });
      setTimeout(loadAll, 1500);
    } catch (e) {
      setError(e.message);
    } finally {
      setTriggering(false);
    }
  };

  const TABS = [
    { id: "overview", label: "⚡ Vue d'ensemble" },
    { id: "cycles",   label: `🔄 Cycles (${cycles.length})` },
    { id: "actions",  label: `🎯 Actions (${actions.length})` },
  ];

  return (
    <div style={{ padding: 24, fontFamily: "var(--font-mono, monospace)", maxWidth: 1100 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 style={{ margin: 0, color: "#cdd6f4", fontSize: 20 }}>
            ⚡ Self-Optimization Engine
          </h2>
          <p style={{ margin: "4px 0 0", color: "#6c7086", fontSize: 12 }}>
            Phase 21 — Miner → Evolution → Validator → Deploy
          </p>
        </div>
        <button
          onClick={loadAll}
          style={{
            background: "transparent",
            border: "1px solid #313244",
            borderRadius: 7,
            padding: "5px 12px",
            color: "#6c7086",
            fontSize: 11,
            cursor: "pointer",
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: "rgba(243,139,168,0.1)",
          border: "1px solid #f38ba840",
          borderRadius: 8,
          padding: "8px 14px",
          color: "#f38ba8",
          fontSize: 12,
          marginBottom: 16,
        }}>
          ⚠️ Optimizer inaccessible : {error}
          <span style={{ color: "#6c7086" }}> — couche démarrée ? port 8017</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, borderBottom: "1px solid #313244" }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              background: tab === t.id ? "rgba(137,180,250,0.1)" : "transparent",
              color:      tab === t.id ? "#89b4fa" : "#6c7086",
              border: "none",
              borderBottom: tab === t.id ? "2px solid #89b4fa" : "2px solid transparent",
              padding: "8px 16px",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: tab === t.id ? 600 : 400,
              borderRadius: "6px 6px 0 0",
              transition: "all 0.12s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && (
        <OverviewTab
          stats={stats}
          status={status}
          onTrigger={handleTrigger}
          triggering={triggering}
        />
      )}
      {tab === "cycles"   && <CyclesTab  cycles={cycles} />}
      {tab === "actions"  && <ActionsTab actions={actions} />}
    </div>
  );
}
