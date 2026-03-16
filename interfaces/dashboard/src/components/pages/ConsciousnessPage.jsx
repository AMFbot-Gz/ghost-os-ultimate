/**
 * ConsciousnessPage.jsx — Phase 19 : Consciousness Bridge
 * NeuralEventBus · 16 couches Python · signaux phéromone · heartbeat
 */
import { useEffect, useRef, useState } from "react";

const BRIDGE_API = "http://localhost:8016";
const WS_URL     = "ws://localhost:8016/ws";

// ─── Couleurs par type d'événement ────────────────────────────────────────────
const EVENT_COLORS = {
  "consciousness.heartbeat": "#cba6f7",
  "pheromone_signal":        "#89dceb",
  "layers_health":           "#a6e3a1",
  "self.aware":              "#f9e2af",
  "goals.established":       "#fab387",
  "modalities.integrated":   "#b4befe",
  "snapshot":                "#74c7ec",
  "consciousness.error":     "#f38ba8",
};

function eventColor(type) {
  return EVENT_COLORS[type] || "var(--text-3)";
}

// ─── Composants ───────────────────────────────────────────────────────────────

function StateBubble({ label, active }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      padding: "12px 14px", borderRadius: 10,
      background: active ? "rgba(166,227,161,0.08)" : "var(--surface-2)",
      border: `1px solid ${active ? "rgba(166,227,161,0.3)" : "var(--border)"}`,
      minWidth: 110,
    }}>
      <div style={{
        width: 12, height: 12, borderRadius: "50%",
        background: active ? "#a6e3a1" : "var(--surface)",
        border: `2px solid ${active ? "#a6e3a1" : "var(--border)"}`,
        boxShadow: active ? "0 0 8px #a6e3a1" : "none",
      }} />
      <span style={{ fontSize: 11, color: active ? "#a6e3a1" : "var(--text-3)", fontWeight: active ? 600 : 400, textAlign: "center" }}>
        {label}
      </span>
    </div>
  );
}

function LayerGrid({ layers }) {
  if (!layers || layers.length === 0) {
    return <div style={{ color: "var(--text-3)", fontSize: 12, padding: 20, textAlign: "center" }}>
      Aucune donnée — Bridge :8016 non connecté
    </div>;
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
      {layers.map(layer => (
        <div key={layer.name} style={{
          background: "var(--surface-2)", borderRadius: 8,
          border: `1px solid ${layer.ok ? "rgba(166,227,161,0.2)" : "rgba(243,139,168,0.15)"}`,
          padding: "10px 12px", display: "flex", alignItems: "center", gap: 8,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{layer.emoji || "⚙️"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {layer.name}
              </span>
              <span style={{
                width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
                background: layer.ok ? "#a6e3a1" : "#f38ba8",
                boxShadow: layer.ok ? "0 0 6px #a6e3a1" : "none",
              }} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 2 }}>
              :{layer.port} · {layer.ok ? `${layer.latency_ms}ms` : "offline"}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function EventRow({ event }) {
  const [expanded, setExpanded] = useState(false);
  const color = eventColor(event.type);
  const ts = event.timestamp
    ? new Date(event.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";

  const data = event.data || event;
  const summary = (() => {
    if (event.type === "consciousness.heartbeat") {
      return `cycle ${data.cycle || data.data?.cycle || "?"} · ${data.online_layers ?? data.data?.online_layers ?? "?"}/15 couches`;
    }
    if (event.type === "layers_health") {
      return `${data.online_count ?? data.data?.online_count ?? "?"}/${data.total_count ?? 15} couches`;
    }
    if (event.type === "pheromone_signal") {
      const s = data.data || data;
      return `${s.type || s.source || "signal"} · ${s.data?.skill || s.data?.source || ""}`;
    }
    return event.source || "";
  })();

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        padding: "7px 10px", borderRadius: 6,
        background: expanded ? "var(--surface-2)" : "transparent",
        cursor: "pointer", borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 200 }}>{event.type}</span>
        <span style={{ fontSize: 10, color: "var(--text-3)", flex: 1 }}>{summary}</span>
        <span style={{ fontSize: 10, color: "var(--text-3)", flexShrink: 0 }}>{ts}</span>
      </div>
      {expanded && (
        <pre style={{
          marginTop: 8, padding: "6px 8px", borderRadius: 6,
          background: "var(--surface)", color: "var(--text-3)",
          fontSize: 10, overflowX: "auto", whiteSpace: "pre-wrap",
          wordBreak: "break-all", maxHeight: 160,
        }}>{JSON.stringify(data, null, 2)}</pre>
      )}
    </div>
  );
}

function SignalRow({ signal }) {
  const [expanded, setExpanded] = useState(false);
  const ts = signal.timestamp
    ? new Date(signal.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : "";
  const color = signal.type?.includes("quarantine") ? "#f38ba8"
    : signal.type?.includes("validated") ? "#a6e3a1"
    : signal.type?.includes("mission") ? "#fab387"
    : "#89dceb";

  return (
    <div
      onClick={() => setExpanded(e => !e)}
      style={{
        padding: "6px 10px", borderRadius: 6, cursor: "pointer",
        background: expanded ? "var(--surface-2)" : "transparent",
        borderBottom: "1px solid var(--border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
          background: `${color}22`, color, letterSpacing: "0.04em" }}>
          {signal.type || "signal"}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-3)", flex: 1 }}>
          {signal.source || ""}{signal.data?.skill ? ` · ${signal.data.skill}` : ""}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>{ts}</span>
      </div>
      {expanded && (
        <pre style={{
          marginTop: 6, padding: "5px 8px", borderRadius: 6,
          background: "var(--surface)", color: "var(--text-3)",
          fontSize: 10, overflowX: "auto", whiteSpace: "pre-wrap",
          wordBreak: "break-all", maxHeight: 120,
        }}>{JSON.stringify(signal, null, 2)}</pre>
      )}
    </div>
  );
}

// ─── Page principale ──────────────────────────────────────────────────────────

export default function ConsciousnessPage() {
  const [tab, setTab]       = useState("overview");
  const [state, setState]   = useState(null);
  const [layers, setLayers] = useState([]);
  const [events, setEvents] = useState([]);
  const [signals, setSignals] = useState([]);
  const [stats, setStats]   = useState(null);
  const [wsStatus, setWsStatus] = useState("disconnected");
  const [lastUpdate, setLastUpdate] = useState(null);
  const wsRef = useRef(null);

  // ── Polling REST ────────────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [stateR, layersR, eventsR, signalsR, statsR] = await Promise.allSettled([
        fetch(`${BRIDGE_API}/state`).then(r => r.ok ? r.json() : null),
        fetch(`${BRIDGE_API}/layers`).then(r => r.ok ? r.json() : null),
        fetch(`${BRIDGE_API}/events?limit=80`).then(r => r.ok ? r.json() : null),
        fetch(`${BRIDGE_API}/signals?limit=60`).then(r => r.ok ? r.json() : null),
        fetch(`${BRIDGE_API}/stats`).then(r => r.ok ? r.json() : null),
      ]);
      if (stateR.status === "fulfilled" && stateR.value)   setState(stateR.value);
      if (layersR.status === "fulfilled" && layersR.value) setLayers(layersR.value.layers || []);
      if (eventsR.status === "fulfilled" && eventsR.value) setEvents(eventsR.value.events || []);
      if (signalsR.status === "fulfilled" && signalsR.value) setSignals(signalsR.value.signals || []);
      if (statsR.status === "fulfilled" && statsR.value)   setStats(statsR.value);
      setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
    } catch {}
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 10000);
    return () => clearInterval(iv);
  }, []);

  // ── WebSocket temps réel ────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    let reconnTimer = null;

    const connect = () => {
      if (!alive) return;
      try {
        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;
        setWsStatus("connecting");

        ws.onopen = () => { setWsStatus("connected"); };

        ws.onmessage = e => {
          try {
            const msg = JSON.parse(e.data);

            // Snapshot initial — initialise tout
            if (msg.type === "snapshot") {
              if (msg.data?.state)   setState(msg.data.state);
              if (msg.data?.layers)  {
                // Convertit l'objet layers en tableau
                const arr = Object.entries(msg.data.layers).map(([name, v]) => ({ name, ...v }));
                setLayers(prev => {
                  // Merge avec les metadata (emoji, desc, port)
                  return prev.map(l => ({ ...l, ...(msg.data.layers[l.name] || {}) }));
                });
              }
              if (msg.data?.recent_events)  setEvents(prev => [...(msg.data.recent_events || []).reverse(), ...prev].slice(0, 150));
              if (msg.data?.recent_signals) setSignals(prev => [...(msg.data.recent_signals || []).reverse(), ...prev].slice(0, 100));
              return;
            }

            // Événement live — prepend
            setEvents(prev => [msg, ...prev].slice(0, 150));

            // Heartbeat → met à jour l'état
            if (msg.type === "consciousness.heartbeat") {
              setState(prev => ({
                ...prev,
                ...(msg.data?.state || {}),
                last_heartbeat: msg.timestamp,
              }));
            }

            // Layers health update
            if (msg.type === "layers_health" && msg.data?.layers) {
              setLayers(prev => prev.map(l => ({
                ...l,
                ok:         msg.data.layers[l.name]?.ok ?? l.ok,
                latency_ms: msg.data.layers[l.name]?.latency_ms ?? l.latency_ms,
              })));
            }

            // Signal phéromone
            if (msg.type === "pheromone_signal") {
              setSignals(prev => [msg.data || msg, ...prev].slice(0, 100));
            }
          } catch {}
        };

        ws.onclose = () => {
          setWsStatus("disconnected");
          if (alive) reconnTimer = setTimeout(connect, 4000);
        };
        ws.onerror = () => ws.close();
      } catch {
        setWsStatus("disconnected");
        if (alive) reconnTimer = setTimeout(connect, 4000);
      }
    };

    connect();
    return () => {
      alive = false;
      clearTimeout(reconnTimer);
      wsRef.current?.close();
    };
  }, []);

  const TABS = [
    { id: "overview",  label: "🧠 Conscience" },
    { id: "layers",    label: `🔌 Couches (${layers.filter(l => l.ok).length}/${layers.length})` },
    { id: "events",    label: `📡 Événements (${events.length})` },
    { id: "signals",   label: `🧬 Signaux (${signals.length})` },
  ];

  const onlineLayers = layers.filter(l => l.ok).length;

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            🧠 Consciousness Bridge — Phase 19
          </h2>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
            NeuralEventBus Node.js ↔ 16 couches Python · signaux phéromone · heartbeat 30s
            {lastUpdate && <> · MAJ {lastUpdate}</>}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{
            fontSize: 10, fontWeight: 700, padding: "3px 10px", borderRadius: 10,
            background: wsStatus === "connected" ? "rgba(166,227,161,0.12)" : "rgba(243,139,168,0.12)",
            color: wsStatus === "connected" ? "#a6e3a1" : "#f38ba8",
            letterSpacing: "0.04em",
          }}>
            WS {wsStatus === "connected" ? "🔴 LIVE" : wsStatus === "connecting" ? "⏳" : "⚫ OFF"}
          </span>
          <button onClick={fetchData} style={{
            background: "var(--surface-2)", border: "1px solid var(--border)",
            borderRadius: 8, padding: "6px 14px", color: "var(--text-2)",
            fontSize: 12, cursor: "pointer",
          }}>↺ Actualiser</button>
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10 }}>
        {[
          { label: "Cycle",       value: state?.cycle ?? "—",       color: "#cba6f7" },
          { label: "Couches ON",  value: `${onlineLayers}/${layers.length || 16}`, color: "#a6e3a1" },
          { label: "Impulsions",  value: stats?.impulses ?? "—",    color: "#89dceb" },
          { label: "Latence moy", value: stats?.avg_latency_ms != null ? `${stats.avg_latency_ms}ms` : "—", color: "#fab387" },
          { label: "Mode",        value: state?.learning_mode ?? "—", color: "#f9e2af" },
        ].map(k => (
          <div key={k.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "12px 14px" }}>
            <div style={{ fontSize: 20, fontWeight: 700, color: k.color }}>{k.value}</div>
            <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 3 }}>{k.label}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--border)" }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "8px 16px", border: "none", borderRadius: "8px 8px 0 0",
            background: tab === t.id ? "var(--surface-2)" : "transparent",
            color: tab === t.id ? "var(--primary)" : "var(--text-2)",
            fontWeight: tab === t.id ? 600 : 400, fontSize: 13, cursor: "pointer",
            borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Tab Conscience ── */}
      {tab === "overview" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* 5 états */}
          <div>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
              États de conscience (UniversalConsciousness)
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              {[
                { label: "Auto-perception",    key: "self_awareness" },
                { label: "Environnement",      key: "environmental_awareness" },
                { label: "Objectifs",          key: "goal_awareness" },
                { label: "Multi-modal",        key: "multimodal_integration" },
                { label: "Boucle active",      key: "consciousness_loop" },
              ].map(s => (
                <StateBubble key={s.key} label={s.label} active={state?.[s.key]} />
              ))}
            </div>
          </div>

          {/* Infos heartbeat */}
          {state && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>État Bridge Python</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {[
                    ["Cycle",         state.cycle],
                    ["Learning mode", state.learning_mode],
                    ["Démarré",       state.started_at ? new Date(state.started_at).toLocaleString("fr-FR") : "—"],
                    ["Dernier HB",    state.last_heartbeat ? new Date(state.last_heartbeat).toLocaleString("fr-FR") : "—"],
                    ["Erreurs",       state.errors || 0],
                    ["Clients WS",    state.ws_clients ?? stats?.ws_clients ?? 0],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--text-3)" }}>{k}</span>
                      <span style={{ color: "var(--text)", fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 8 }}>NeuralEventBus — métriques</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {[
                    ["Impulsions",     stats?.impulses ?? 0],
                    ["Latence moy",    stats?.avg_latency_ms != null ? `${stats.avg_latency_ms}ms` : "—"],
                    ["Erreurs bus",    stats?.errors ?? 0],
                    ["Événements",     stats?.events_buffered ?? events.length],
                    ["Signaux",        stats?.signals_buffered ?? signals.length],
                    ["Types d'events", stats?.registered_events ?? "—"],
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                      <span style={{ color: "var(--text-3)" }}>{k}</span>
                      <span style={{ color: "var(--text)", fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Couches résumé */}
          <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 10 }}>
              Couches Python — vue rapide ({onlineLayers}/{layers.length || 16})
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "var(--surface)", overflow: "hidden", marginBottom: 10 }}>
              <div style={{
                height: "100%", borderRadius: 4,
                width: `${layers.length ? Math.round(onlineLayers / layers.length * 100) : 0}%`,
                background: onlineLayers === layers.length ? "#a6e3a1" : onlineLayers > layers.length / 2 ? "var(--primary)" : "#f38ba8",
                transition: "width 0.5s ease",
              }} />
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {layers.map(l => (
                <span key={l.name} title={`${l.name} :${l.port} — ${l.ok ? l.latency_ms + "ms" : "offline"}`} style={{
                  fontSize: 10, padding: "2px 7px", borderRadius: 8,
                  background: l.ok ? "rgba(166,227,161,0.1)" : "rgba(243,139,168,0.1)",
                  color: l.ok ? "#a6e3a1" : "#f38ba8",
                  border: `1px solid ${l.ok ? "rgba(166,227,161,0.25)" : "rgba(243,139,168,0.2)"}`,
                }}>
                  {l.emoji || "⚙️"} {l.name}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Tab Couches ── */}
      {tab === "layers" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--text-3)" }}>
            Health check toutes les 30s · {onlineLayers}/{layers.length || 16} couches actives
          </div>
          <LayerGrid layers={layers} />
        </div>
      )}

      {/* ── Tab Événements ── */}
      {tab === "events" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>
            Flux NeuralEventBus — heartbeats, layers_health, pheromone_signals… cliquez pour détail
          </div>
          {events.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-3)", padding: 40, fontSize: 13 }}>
              Aucun événement encore. Le bridge émet un heartbeat toutes les 30s.
            </div>
          ) : events.map((ev, i) => (
            <EventRow key={ev.id || i} event={ev} />
          ))}
        </div>
      )}

      {/* ── Tab Signaux phéromone ── */}
      {tab === "signals" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>
            Signaux depuis agent/signals.jsonl — tail-follow 500ms · émis par toutes les couches
          </div>
          {signals.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-3)", padding: 40, fontSize: 13 }}>
              Aucun signal phéromone encore. Lancez des missions pour générer des signaux.
            </div>
          ) : signals.map((s, i) => (
            <SignalRow key={i} signal={s} />
          ))}
        </div>
      )}

    </div>
  );
}
