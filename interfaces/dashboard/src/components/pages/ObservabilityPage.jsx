/**
 * ObservabilityPage.jsx — Observabilité temps réel
 * SSE /brain/metrics/stream · 7 couches Python · CPU/RAM/Disk sparklines · alertes · events live
 */
import React, { useState, useEffect, useRef, useCallback } from "react";

const BRAIN_URL = "/brain";

// ─── Constantes ───────────────────────────────────────────────────────────────

const LAYER_META = {
  queen:      { label: "Queen",      icon: "👑", port: 8001 },
  perception: { label: "Perception", icon: "👁",  port: 8002 },
  brain:      { label: "Brain",      icon: "🧠", port: 8003 },
  executor:   { label: "Executor",   icon: "⚙️",  port: 8004 },
  evolution:  { label: "Évolution",  icon: "🧬", port: 8005 },
  memory:     { label: "Mémoire",    icon: "💾", port: 8006 },
  mcp_bridge: { label: "MCP Bridge", icon: "🔌", port: 8007 },
};

const EVENT_ICONS = {
  mission_start:    { icon: "🚀", color: "var(--blue)" },
  mission_complete: { icon: "✅", color: "var(--green)" },
  mission_error:    { icon: "❌", color: "var(--red)" },
  mission_timeout:  { icon: "⏰", color: "var(--yellow)" },
  plan_ready:       { icon: "📋", color: "var(--text-3)" },
  task_start:       { icon: "▶",  color: "var(--text-3)" },
  task_done:        { icon: "✓",  color: "var(--text-3)" },
  thinking:         { icon: "💭", color: "var(--violet)" },
};

const ALERT_COLORS = {
  critical: { bg: "rgba(239,68,68,0.08)",    border: "var(--red)",    text: "var(--red)",    icon: "🔴" },
  warn:     { bg: "rgba(234,179,8,0.08)",     border: "var(--yellow)", text: "var(--yellow)", icon: "🟡" },
  info:     { bg: "rgba(59,130,246,0.08)",    border: "var(--blue)",   text: "var(--blue)",   icon: "🔵" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const pct_color = (v) =>
  v > 85 ? "var(--red)" : v > 65 ? "var(--yellow)" : "var(--green)";

function fmt_ms(ms) {
  if (!ms && ms !== 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmt_time(ts) {
  if (!ts) return "";
  const d = new Date(typeof ts === "number" ? ts * 1000 : ts);
  return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function pct_bar(value, h = 6) {
  const v = Math.min(100, Math.max(0, value || 0));
  return (
    <div style={{ flex: 1, height: h, background: "var(--surface-4)", borderRadius: 3 }}>
      <div style={{
        width: `${v}%`, height: "100%", borderRadius: 3,
        background: pct_color(v),
        transition: "width 0.6s ease, background 0.3s",
      }} />
    </div>
  );
}

// ─── Sparkline SVG ────────────────────────────────────────────────────────────

function Sparkline({ data = [], color = "var(--primary)", w = 110, h = 28, fill = true }) {
  if (data.length < 2) {
    return <div style={{ width: w, height: h, background: "var(--surface-3)", borderRadius: 4 }} />;
  }
  const max = 100, min = 0;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * (h - 2) - 1;
    return [x, y];
  });
  const polyline = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  // Area fill path
  const area = `M${pts[0][0].toFixed(1)},${h} ` +
    pts.map(([x, y]) => `L${x.toFixed(1)},${y.toFixed(1)}`).join(" ") +
    ` L${pts[pts.length - 1][0].toFixed(1)},${h} Z`;

  return (
    <svg width={w} height={h} style={{ overflow: "visible", display: "block" }}>
      {fill && (
        <path d={area} fill={color} fillOpacity={0.12} />
      )}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Dernier point */}
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.5} fill={color} />
    </svg>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, sub, color, sparkData }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "14px 16px", flex: 1, minWidth: 140,
      display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ fontSize: 11, color: "var(--text-3)", display: "flex", gap: 5, alignItems: "center" }}>
            <span>{icon}</span>{label}
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: color || "var(--text)", letterSpacing: "-0.02em", marginTop: 2 }}>
            {value}
          </div>
          {sub && <div style={{ fontSize: 11, color: "var(--text-3)" }}>{sub}</div>}
        </div>
        {sparkData && (
          <Sparkline data={sparkData} color={color || "var(--primary)"} w={70} h={28} />
        )}
      </div>
    </div>
  );
}

// ─── Layer row ────────────────────────────────────────────────────────────────

function LayerRow({ name, data = {} }) {
  const meta = LAYER_META[name] || { label: name, icon: "●", port: "?" };
  const ok   = data.ok !== false;

  // Extrait 1–2 métriques clés selon la couche
  const extras = [];
  if (name === "memory")    { extras.push(data.chroma_ready ? "ChromaDB ✓" : "ChromaDB ✗"); if (data.episode_count != null) extras.push(`${data.episode_count} ep.`); }
  if (name === "brain")     { if (data.active_provider) extras.push(data.active_provider); }
  if (name === "evolution") { if (data.node_skills != null) extras.push(`${data.node_skills} skills`); }
  if (name === "executor")  { if (data.failsafe != null) extras.push(data.failsafe ? "failsafe ✓" : "failsafe ✗"); }
  if (name === "queen")     { if (data.hitl_pending != null && data.hitl_pending > 0) extras.push(`HITL: ${data.hitl_pending}`); }
  if (name === "mcp_bridge"){ if (data.mcp_endpoints_active != null) extras.push(`${data.mcp_endpoints_active} routes MCP`); }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "9px 14px",
      borderBottom: "1px solid var(--border)",
      background: ok ? "transparent" : "rgba(239,68,68,0.04)",
    }}>
      {/* Status dot */}
      <div style={{
        width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
        background: ok ? "var(--green)" : "var(--red)",
        boxShadow: ok ? "0 0 6px var(--green)" : "none",
        transition: "background 0.3s",
      }} />

      {/* Icon + label */}
      <span style={{ fontSize: 14, flexShrink: 0 }}>{meta.icon}</span>
      <div style={{ minWidth: 80, flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: ok ? 500 : 700, color: ok ? "var(--text)" : "var(--red)" }}>
          {meta.label}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-3)" }}>:{meta.port}</div>
      </div>

      {/* Status + latency */}
      <div style={{ flex: 1, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{
          fontSize: 11, fontWeight: 600, color: ok ? "var(--green)" : "var(--red)",
          background: ok ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
          borderRadius: 5, padding: "1px 7px",
        }}>{ok ? "OK" : "DOWN"}</span>

        {data.latency_ms != null && (
          <span style={{
            fontSize: 11, color: data.latency_ms > 500 ? "var(--yellow)" : "var(--text-3)",
          }}>{data.latency_ms}ms</span>
        )}

        {extras.map((e, i) => (
          <span key={i} style={{ fontSize: 11, color: "var(--text-3)" }}>{e}</span>
        ))}

        {!ok && data.error && (
          <span style={{ fontSize: 11, color: "var(--red)", fontStyle: "italic" }}>
            {data.error.slice(0, 50)}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Panel alertes ────────────────────────────────────────────────────────────

function AlertsPanel({ alerts = [] }) {
  if (alerts.length === 0) {
    return (
      <div style={{
        padding: "16px 14px", textAlign: "center",
        color: "var(--green)", fontSize: 12, fontWeight: 500,
      }}>
        ✓ Tous les systèmes nominaux
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "10px 14px" }}>
      {alerts.map((a, i) => {
        const style = ALERT_COLORS[a.level] || ALERT_COLORS.info;
        return (
          <div key={i} style={{
            background: style.bg, border: `1px solid ${style.border}`,
            borderRadius: 7, padding: "7px 10px",
            display: "flex", gap: 8, alignItems: "flex-start",
          }}>
            <span style={{ fontSize: 12, flexShrink: 0 }}>{style.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: style.text, fontWeight: 500 }}>{a.message}</div>
              <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 1 }}>source: {a.source}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Feed événements WS ───────────────────────────────────────────────────────

function EventFeed({ wsEvents = [] }) {
  const recent = wsEvents.slice(-40).reverse();
  if (recent.length === 0) {
    return (
      <div style={{ padding: "16px 14px", color: "var(--text-3)", fontSize: 12, textAlign: "center" }}>
        En attente d'événements WebSocket…
      </div>
    );
  }
  return (
    <div style={{ overflowY: "auto", maxHeight: 300 }}>
      {recent.map((ev, i) => {
        const meta = EVENT_ICONS[ev.type] || { icon: "•", color: "var(--text-3)" };
        const text = ev.mission?.command || ev.mission || ev.task || ev.thought || ev.error || ev.type;
        const dur  = ev.mission?.duration_ms || ev.duration_ms;
        return (
          <div key={i} style={{
            display: "flex", gap: 8, padding: "6px 14px", alignItems: "flex-start",
            borderBottom: i < recent.length - 1 ? "1px solid var(--border)" : "none",
          }}>
            <span style={{ fontSize: 13, flexShrink: 0, color: meta.color }}>{meta.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {typeof text === "string" ? text.slice(0, 90) : ev.type}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-3)", display: "flex", gap: 8 }}>
                <span style={{ color: meta.color }}>{ev.type}</span>
                {dur && <span>{fmt_ms(dur)}</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Metric row (CPU/RAM/Disk) ────────────────────────────────────────────────

function MetricRow({ label, value, history, unit = "%" }) {
  const v = value ?? 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0" }}>
      <div style={{ width: 34, fontSize: 11, color: "var(--text-3)", flexShrink: 0 }}>{label}</div>
      <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
        {pct_bar(v, 6)}
        <span style={{ fontSize: 12, fontWeight: 600, color: pct_color(v), width: 38, flexShrink: 0, textAlign: "right" }}>
          {v.toFixed(0)}{unit}
        </span>
      </div>
      <Sparkline data={history} color={pct_color(v)} w={80} h={22} fill />
    </div>
  );
}

// ─── Panel titre ─────────────────────────────────────────────────────────────

function PanelTitle({ children, right }) {
  return (
    <div style={{
      padding: "10px 14px 8px",
      borderBottom: "1px solid var(--border)",
      display: "flex", justifyContent: "space-between", alignItems: "center",
    }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-2)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {children}
      </span>
      {right}
    </div>
  );
}

function Panel({ title, right, children, style = {} }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, overflow: "hidden", ...style,
    }}>
      <PanelTitle right={right}>{title}</PanelTitle>
      {children}
    </div>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export default function ObservabilityPage({ wsEvents = [] }) {
  const [snapshot, setSnapshot]   = useState(null);
  const [history,  setHistory]    = useState([]);  // array of slim snapshots
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const esRef = useRef(null);

  // Charge l'historique initial
  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`${BRAIN_URL}/metrics/history?n=60`);
      const d = await r.json();
      setHistory(d.history || []);
    } catch {}
  }, []);

  // Connexion SSE au stream métriques
  useEffect(() => {
    loadHistory();

    const es = new EventSource(`${BRAIN_URL}/metrics/stream`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onmessage = (e) => {
      try {
        const snap = JSON.parse(e.data);
        setSnapshot(snap);
        setLastUpdate(new Date());
        // Ajoute aux sparklines en gardant max 60 points
        setHistory(prev => {
          const slim = {
            timestamp:       snap.timestamp,
            cpu_percent:     snap.system?.cpu_percent  ?? 0,
            ram_percent:     snap.system?.ram_percent  ?? 0,
            disk_percent:    snap.system?.disk_percent ?? 0,
            layers_ok:       snap.layers_ok            ?? 0,
            alerts_count:    snap.alerts_count         ?? 0,
            missions_active: snap.missions?.active     ?? 0,
          };
          const next = [...prev, slim];
          return next.slice(-60);
        });
      } catch {}
    };
    es.onerror = () => setConnected(false);

    return () => { es.close(); };
  }, [loadHistory]);

  // Force un snapshot frais
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(`${BRAIN_URL}/metrics/snapshot`);
      const d = await r.json();
      setSnapshot(d);
      setLastUpdate(new Date());
    } catch {}
  }, []);

  // Extraire les séries temporelles
  const cpu_series  = history.map(s => s.cpu_percent);
  const ram_series  = history.map(s => s.ram_percent);
  const disk_series = history.map(s => s.disk_percent);
  const miss_series = history.map(s => (s.missions_active || 0) * 10); // scale x10 pour visibilité

  const sys      = snapshot?.system   || {};
  const layers   = snapshot?.layers   || {};
  const missions = snapshot?.missions || {};
  const ollama   = snapshot?.ollama   || {};
  const alerts   = snapshot?.alerts   || [];

  const layers_ok    = snapshot?.layers_ok    ?? 0;
  const layers_total = snapshot?.layers_total ?? 7;

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100, margin: "0 auto" }}>
      {/* ── Header ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "var(--text)", margin: 0 }}>
            🔭 Observabilité Temps Réel
          </h1>
          <p style={{ fontSize: 12, color: "var(--text-3)", margin: "4px 0 0" }}>
            Refresh 10s · 7 couches Python · CPU/RAM/Disk · Alertes · Events WS
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
            <div style={{
              width: 7, height: 7, borderRadius: "50%",
              background: connected ? "var(--green)" : "var(--yellow)",
              boxShadow: connected ? "0 0 6px var(--green)" : "none",
            }} />
            <span style={{ color: connected ? "var(--green)" : "var(--yellow)" }}>
              {connected ? "Live" : "Reconnexion…"}
            </span>
            {lastUpdate && (
              <span style={{ color: "var(--text-3)" }}>· {lastUpdate.toLocaleTimeString("fr-FR")}</span>
            )}
          </div>
          <button
            onClick={refresh}
            style={{
              background: "var(--surface-3)", border: "1px solid var(--border-2)",
              borderRadius: 6, padding: "5px 12px", fontSize: 12, cursor: "pointer", color: "var(--text-2)",
            }}
          >↻ Snapshot</button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard
          icon="🟢" label="Couches actives"
          value={snapshot ? `${layers_ok}/${layers_total}` : "…"}
          color={layers_ok === layers_total ? "var(--green)" : "var(--red)"}
          sub={layers_ok === layers_total ? "Tous les services OK" : `${layers_total - layers_ok} hors ligne`}
        />
        <StatCard
          icon="⚡" label="Missions actives"
          value={snapshot ? (missions.active ?? 0) : "…"}
          color="var(--blue)"
          sub={`${missions.total ?? 0} total · ${missions.success ?? 0} succès`}
          sparkData={miss_series.map(v => Math.min(100, v))}
        />
        <StatCard
          icon="🔔" label="Alertes"
          value={snapshot ? alerts.length : "…"}
          color={alerts.length === 0 ? "var(--green)" : alerts.some(a => a.level === "critical") ? "var(--red)" : "var(--yellow)"}
          sub={alerts.length === 0 ? "Aucune anomalie" : alerts[0]?.message?.slice(0, 30)}
        />
        <StatCard
          icon="🤖" label="Ollama"
          value={snapshot ? (ollama.ok ? "Online" : "Offline") : "…"}
          color={ollama.ok ? "var(--green)" : "var(--red)"}
          sub={ollama.latency_ms != null ? `${ollama.latency_ms}ms · ${ollama.model || "—"}` : "—"}
        />
        <StatCard
          icon="⏱" label="Collecte"
          value={snapshot?.collect_ms != null ? `${snapshot.collect_ms}ms` : "…"}
          color="var(--text-3)"
          sub={`${history.length} snapshots`}
        />
      </div>

      {/* ── Layout principal ── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>

        {/* ── Colonne gauche : couches + alertes ── */}
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel title="Couches Python" right={
            <span style={{ fontSize: 11, color: layers_ok === layers_total ? "var(--green)" : "var(--red)" }}>
              {layers_ok}/{layers_total} actives
            </span>
          }>
            {Object.keys(LAYER_META).map(name => (
              <LayerRow key={name} name={name} data={layers[name] || {}} />
            ))}
          </Panel>

          <Panel title="Alertes" right={
            alerts.length > 0 && (
              <span style={{
                fontSize: 10, fontWeight: 700, color: "white",
                background: alerts.some(a => a.level === "critical") ? "var(--red)" : "var(--yellow)",
                borderRadius: 8, padding: "1px 7px",
              }}>{alerts.length}</span>
            )
          }>
            <AlertsPanel alerts={alerts} />
          </Panel>
        </div>

        {/* ── Colonne droite : métriques + events ── */}
        <div style={{ flex: "1 1 320px", display: "flex", flexDirection: "column", gap: 14 }}>
          <Panel title="Système" right={
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>
              RAM {sys.ram_gb_used ?? "?"}Go / {sys.ram_gb_total ?? "?"}Go
            </span>
          }>
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 2 }}>
              <MetricRow label="CPU"  value={sys.cpu_percent}  history={cpu_series}  />
              <MetricRow label="RAM"  value={sys.ram_percent}  history={ram_series}  />
              <MetricRow label="Disk" value={sys.disk_percent} history={disk_series} />
            </div>
          </Panel>

          {/* Latences des couches */}
          <Panel title="Latences (ms)">
            <div style={{ padding: "10px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              {Object.entries(LAYER_META).map(([name, meta]) => {
                const lat = layers[name]?.latency_ms;
                const ok  = layers[name]?.ok !== false;
                return (
                  <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, width: 74, color: "var(--text-2)", flexShrink: 0 }}>{meta.label}</span>
                    <div style={{ flex: 1, height: 4, background: "var(--surface-3)", borderRadius: 2 }}>
                      <div style={{
                        width: ok && lat != null ? `${Math.min(100, lat / 30)}%` : "0%",
                        height: "100%", borderRadius: 2,
                        background: !ok ? "var(--red)" : lat > 500 ? "var(--yellow)" : "var(--green)",
                        transition: "width 0.4s",
                      }} />
                    </div>
                    <span style={{
                      fontSize: 11, width: 38, textAlign: "right", flexShrink: 0,
                      color: !ok ? "var(--red)" : lat > 500 ? "var(--yellow)" : "var(--text-3)",
                    }}>
                      {!ok ? "DOWN" : lat != null ? `${lat}ms` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel title="Événements Live" right={
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>{wsEvents.length} reçus</span>
          }>
            <EventFeed wsEvents={wsEvents} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
