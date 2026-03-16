/**
 * SwarmPage.jsx — Phase 16 : Bee Specialization
 * 5 abeilles spécialisées + routage automatique + log des décisions + dispatch manuel
 */
import { useEffect, useState, useRef } from "react";

const SWARM_API = "http://localhost:8013";
const BRAIN_API = "http://localhost:8003";

// Couches Python complètes (13 couches)
const PYTHON_LAYERS = [
  { id: "queen-py",     port: 8001, role: "Queen Orchestrateur",  emoji: "👑" },
  { id: "brain",        port: 8003, role: "Brain / LLM Router",   emoji: "🧠" },
  { id: "perception",   port: 8002, role: "Perception",           emoji: "👁️" },
  { id: "executor",     port: 8004, role: "Exécuteur Shell",      emoji: "⚙️" },
  { id: "evolution",    port: 8005, role: "Évolution Skills",     emoji: "🧬" },
  { id: "memory",       port: 8006, role: "Mémoire",              emoji: "💾" },
  { id: "mcp-bridge",   port: 8007, role: "MCP Bridge",           emoji: "🌉" },
  { id: "planner",      port: 8008, role: "Planner HTN",          emoji: "🗺️" },
  { id: "learner",      port: 8009, role: "Apprentissage",        emoji: "🎓" },
  { id: "goals",        port: 8010, role: "Objectifs Autonomes",  emoji: "🏆" },
  { id: "pipeline",     port: 8011, role: "Pipeline Composer",    emoji: "🔗" },
  { id: "miner",        port: 8012, role: "Behavior Mining",      emoji: "⛏" },
  { id: "swarm-router", port: 8013, role: "Swarm Router (Ruche)", emoji: "🐝" },
];

const DOMAIN_COLORS = {
  ui:     { bg: "rgba(203,166,247,0.15)", text: "#cba6f7" },
  file:   { bg: "rgba(249,226,175,0.15)", text: "#f9e2af" },
  code:   { bg: "rgba(137,220,235,0.15)", text: "#89dceb" },
  web:    { bg: "rgba(166,227,161,0.15)", text: "#a6e3a1" },
  system: { bg: "rgba(243,139,168,0.15)", text: "#f38ba8" },
};

function ConfBar({ value, domain }) {
  const c = DOMAIN_COLORS[domain] || { bg: "rgba(150,150,150,0.15)", text: "#cdd6f4" };
  const pct = Math.round((value || 0) * 100);
  return (
    <div style={{ height: 5, borderRadius: 3, background: "var(--surface)", overflow: "hidden", marginTop: 3 }}>
      <div style={{
        height: "100%", borderRadius: 3,
        width: `${pct}%`, background: c.text, transition: "width 0.4s ease",
      }} />
    </div>
  );
}

function DomainBadge({ domain }) {
  const c = DOMAIN_COLORS[domain] || { bg: "rgba(150,150,150,0.12)", text: "#cdd6f4" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 10,
      background: c.bg, color: c.text, letterSpacing: "0.05em",
      textTransform: "uppercase",
    }}>{domain}</span>
  );
}

function BeeCard({ bee, stats }) {
  const s = stats || {};
  const total   = s.routed_count || 0;
  const succRate = s.success_rate || 0;
  const avgMs   = s.avg_ms || 0;
  const c = DOMAIN_COLORS[bee.domain] || { bg: "rgba(150,150,150,0.12)", text: "#cdd6f4" };

  return (
    <div style={{
      background: "var(--surface-2)", borderRadius: 12, padding: "16px 18px",
      border: `1px solid ${c.text}33`, display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 26 }}>{bee.emoji}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{bee.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>{bee.desc}</div>
        </div>
        <DomainBadge domain={bee.domain} />
      </div>

      {/* Métriques */}
      <div style={{ display: "flex", gap: 10 }}>
        <div style={{ flex: 1, textAlign: "center", background: "var(--surface)", borderRadius: 8, padding: "8px 4px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>{total}</div>
          <div style={{ fontSize: 10, color: "var(--text-3)" }}>routées</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", background: "var(--surface)", borderRadius: 8, padding: "8px 4px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: succRate >= 0.7 ? "var(--green)" : succRate >= 0.4 ? "var(--primary)" : "var(--red)" }}>
            {total > 0 ? `${Math.round(succRate * 100)}%` : "—"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)" }}>succès</div>
        </div>
        <div style={{ flex: 1, textAlign: "center", background: "var(--surface)", borderRadius: 8, padding: "8px 4px" }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            {total > 0 ? `${avgMs < 1000 ? avgMs : (avgMs / 1000).toFixed(1) + "k"}` : "—"}
          </div>
          <div style={{ fontSize: 10, color: "var(--text-3)" }}>ms moy</div>
        </div>
      </div>

      {/* Taux succès barre */}
      {total > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 3 }}>Taux de succès</div>
          <div style={{ height: 5, borderRadius: 3, background: "var(--surface)", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${Math.round(succRate * 100)}%`,
              background: succRate >= 0.7 ? "var(--green)" : succRate >= 0.4 ? "var(--primary)" : "var(--red)",
              borderRadius: 3, transition: "width 0.4s ease",
            }} />
          </div>
        </div>
      )}

      {s.last_used_at && (
        <div style={{ fontSize: 10, color: "var(--text-3)" }}>
          Dernière utilisation : {new Date(s.last_used_at + "Z").toLocaleTimeString("fr-FR")}
        </div>
      )}
    </div>
  );
}

function LogRow({ item }) {
  const c = DOMAIN_COLORS[item.domain] || { text: "#cdd6f4" };
  const ok = item.success === 1;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 12px", borderRadius: 8, background: "var(--surface-2)",
      marginBottom: 4,
    }}>
      <span style={{ fontSize: 13, minWidth: 18 }}>{ok ? "✅" : "❌"}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.4 }}
             title={item.mission}>{item.mission?.substring(0, 90)}{item.mission?.length > 90 ? "…" : ""}</div>
        {item.result_preview && (
          <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>
            → {item.result_preview?.substring(0, 80)}{item.result_preview?.length > 80 ? "…" : ""}
          </div>
        )}
        {item.error && <div style={{ fontSize: 11, color: "var(--red)", marginTop: 3 }}>{item.error?.substring(0, 80)}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0 }}>
        <DomainBadge domain={item.domain} />
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>
          {item.duration_ms ? `${item.duration_ms < 1000 ? item.duration_ms + "ms" : (item.duration_ms / 1000).toFixed(1) + "s"}` : ""}
        </span>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>
          {item.created_at ? new Date(item.created_at + "Z").toLocaleTimeString("fr-FR") : ""}
        </span>
      </div>
    </div>
  );
}

function LayerStatus({ layer, healthy }) {
  const ok = healthy;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 12px", borderRadius: 8, background: "var(--surface-2)",
    }}>
      <span style={{ fontSize: 16, width: 22, textAlign: "center" }}>{layer.emoji}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{layer.role}</div>
        <div style={{ fontSize: 10, color: "var(--text-3)" }}>:{layer.port}</div>
      </div>
      <div style={{
        width: 8, height: 8, borderRadius: "50%",
        background: ok ? "var(--green)" : "var(--red)",
        boxShadow: ok ? "0 0 6px var(--green)" : "none",
        flexShrink: 0,
      }} />
    </div>
  );
}

export default function SwarmPage() {
  const [tab, setTab]           = useState("bees");
  const [bees, setBees]         = useState([]);
  const [globalStats, setGlobalStats] = useState(null);
  const [log, setLog]           = useState([]);
  const [layerHealth, setLayerHealth] = useState({});
  const [dispatch, setDispatch] = useState({ mission: "", domain: "", dry_run: false });
  const [dispatchResult, setDispatchResult] = useState(null);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [classifyResult, setClassifyResult]   = useState(null);
  const [classifyLoading, setClassifyLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async () => {
    try {
      const [beesR, statsR, logR] = await Promise.all([
        fetch(`${SWARM_API}/bees`).then(r => r.ok ? r.json() : null),
        fetch(`${SWARM_API}/stats`).then(r => r.ok ? r.json() : null),
        fetch(`${SWARM_API}/log?limit=40`).then(r => r.ok ? r.json() : null),
      ]);
      if (beesR?.bees) setBees(beesR.bees);
      if (statsR)       setGlobalStats(statsR);
      if (logR?.items)  setLog(logR.items);
      setLastUpdate(new Date().toLocaleTimeString("fr-FR"));
    } catch {}

    // Health check des 13 couches
    const health = {};
    await Promise.all(PYTHON_LAYERS.map(async l => {
      try {
        const r = await fetch(`http://localhost:${l.port}/health`, { signal: AbortSignal.timeout(2500) });
        health[l.port] = r.ok;
      } catch { health[l.port] = false; }
    }));
    setLayerHealth(health);
  };

  useEffect(() => {
    fetchData();
    const iv = setInterval(fetchData, 8000);
    return () => clearInterval(iv);
  }, []);

  const handleClassify = async () => {
    if (!dispatch.mission.trim()) return;
    setClassifyLoading(true);
    setClassifyResult(null);
    try {
      const r = await fetch(`${SWARM_API}/classify?mission=${encodeURIComponent(dispatch.mission)}`);
      if (r.ok) setClassifyResult(await r.json());
    } catch {}
    setClassifyLoading(false);
  };

  const handleDispatch = async () => {
    if (!dispatch.mission.trim()) return;
    setDispatchLoading(true);
    setDispatchResult(null);
    setClassifyResult(null);
    try {
      const body = { mission: dispatch.mission, dry_run: dispatch.dry_run };
      if (dispatch.domain) body.domain = dispatch.domain;
      const r = await fetch(`${SWARM_API}/dispatch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (r.ok) setDispatchResult(await r.json());
    } catch (e) {
      setDispatchResult({ error: e.message });
    }
    setDispatchLoading(false);
    setTimeout(fetchData, 1000);
  };

  const TABS = [
    { id: "bees",     label: "🐝 Abeilles" },
    { id: "dispatch", label: "🚀 Dispatch" },
    { id: "log",      label: "📋 Historique" },
    { id: "layers",   label: "🔌 Couches" },
  ];

  const statsMap = {};
  (globalStats?.by_domain || []).forEach(s => { statsMap[s.domain] = s; });

  return (
    <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            🐝 Ruche Spécialisée — Phase 16
          </h2>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 3 }}>
            5 abeilles spécialisées · routage par domaine · Brain mission_type
            {lastUpdate && <> · MAJ {lastUpdate}</>}
          </div>
        </div>
        <button onClick={fetchData} style={{
          background: "var(--surface-2)", border: "1px solid var(--border)",
          borderRadius: 8, padding: "6px 14px", color: "var(--text-2)",
          fontSize: 12, cursor: "pointer",
        }}>↺ Actualiser</button>
      </div>

      {/* KPIs globaux */}
      {globalStats && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {[
            { label: "Missions routées",   value: globalStats.total_routed,  color: "var(--primary)" },
            { label: "Succès total",        value: globalStats.total_success, color: "var(--green)" },
            { label: "Taux succès global",  value: `${Math.round((globalStats.global_success_rate || 0) * 100)}%`, color: "var(--violet)" },
            { label: "Abeilles actives",    value: globalStats.bees_count,    color: "var(--primary)" },
          ].map(k => (
            <div key={k.label} style={{ background: "var(--surface-2)", borderRadius: 10, padding: "14px 16px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: k.color }}>{k.value}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>{k.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: "flex", gap: 6, borderBottom: "1px solid var(--border)", paddingBottom: 0 }}>
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

      {/* ── Tab Abeilles ── */}
      {tab === "bees" && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
          {bees.map(bee => (
            <BeeCard key={bee.domain} bee={bee} stats={statsMap[bee.domain]} />
          ))}
        </div>
      )}

      {/* ── Tab Dispatch ── */}
      {tab === "dispatch" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 700 }}>
          <div style={{ background: "var(--surface-2)", borderRadius: 12, padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Dispatch une mission vers une abeille</div>

            <div>
              <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>Mission</label>
              <textarea
                value={dispatch.mission}
                onChange={e => setDispatch(p => ({ ...p, mission: e.target.value }))}
                placeholder="Décris la mission... l'abeille sera choisie automatiquement ou force un domaine"
                rows={3}
                style={{
                  width: "100%", padding: "10px 12px", borderRadius: 8,
                  background: "var(--surface)", border: "1px solid var(--border)",
                  color: "var(--text)", fontSize: 13, resize: "vertical",
                  fontFamily: "inherit", boxSizing: "border-box",
                }}
              />
            </div>

            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <label style={{ fontSize: 12, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                  Forcer un domaine <span style={{ color: "var(--text-3)" }}>(optionnel)</span>
                </label>
                <select
                  value={dispatch.domain}
                  onChange={e => setDispatch(p => ({ ...p, domain: e.target.value }))}
                  style={{
                    width: "100%", padding: "8px 10px", borderRadius: 8,
                    background: "var(--surface)", border: "1px solid var(--border)",
                    color: "var(--text)", fontSize: 13, cursor: "pointer",
                  }}
                >
                  <option value="">Auto (routage intelligent)</option>
                  {bees.map(b => <option key={b.domain} value={b.domain}>{b.emoji} {b.name} ({b.domain})</option>)}
                </select>
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: "var(--text-2)" }}>
                  <input
                    type="checkbox"
                    checked={dispatch.dry_run}
                    onChange={e => setDispatch(p => ({ ...p, dry_run: e.target.checked }))}
                    style={{ accentColor: "var(--primary)" }}
                  />
                  Dry run
                </label>
              </div>
            </div>

            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={handleClassify}
                disabled={classifyLoading || !dispatch.mission.trim()}
                style={{
                  padding: "8px 16px", borderRadius: 8, border: "1px solid var(--border)",
                  background: "var(--surface)", color: "var(--text-2)",
                  fontSize: 13, cursor: "pointer", fontWeight: 500,
                  opacity: classifyLoading || !dispatch.mission.trim() ? 0.5 : 1,
                }}
              >{classifyLoading ? "…" : "🔍 Classifier seulement"}</button>
              <button
                onClick={handleDispatch}
                disabled={dispatchLoading || !dispatch.mission.trim()}
                style={{
                  flex: 1, padding: "8px 20px", borderRadius: 8, border: "none",
                  background: "var(--primary)", color: "white",
                  fontSize: 13, cursor: "pointer", fontWeight: 600,
                  opacity: dispatchLoading || !dispatch.mission.trim() ? 0.6 : 1,
                }}
              >{dispatchLoading ? "Exécution en cours…" : "🚀 Dispatcher la mission"}</button>
            </div>
          </div>

          {/* Résultat classification */}
          {classifyResult && (
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>Classification</div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <span style={{ fontSize: 22 }}>{bees.find(b => b.domain === classifyResult.domain)?.emoji || "🐝"}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>{classifyResult.bee?.name}</div>
                  <div style={{ fontSize: 11, color: "var(--text-3)" }}>
                    Confiance : {Math.round((classifyResult.confidence || 0) * 100)}%
                    {classifyResult.routable ? " ✅ routable" : " ⚠️ confiance faible"}
                  </div>
                </div>
                <DomainBadge domain={classifyResult.domain} />
              </div>
              {classifyResult.all_scores && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {Object.entries(classifyResult.all_scores)
                    .sort((a, b) => b[1] - a[1])
                    .map(([domain, score]) => (
                      <div key={domain}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-2)", marginBottom: 2 }}>
                          <span>{bees.find(b => b.domain === domain)?.emoji} {domain}</span>
                          <span>{score.toFixed(2)}</span>
                        </div>
                        <ConfBar value={score / (Math.max(...Object.values(classifyResult.all_scores)) || 1)} domain={domain} />
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}

          {/* Résultat dispatch */}
          {dispatchResult && (
            <div style={{ background: "var(--surface-2)", borderRadius: 10, padding: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 16 }}>{dispatchResult.success ? "✅" : dispatchResult.dry_run ? "🔍" : "❌"}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                  {dispatchResult.dry_run ? "Résultat Dry Run" : dispatchResult.success ? "Mission réussie" : "Mission échouée"}
                </span>
                {dispatchResult.domain && <DomainBadge domain={dispatchResult.domain} />}
                {dispatchResult.duration_ms && (
                  <span style={{ fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
                    {(dispatchResult.duration_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              {dispatchResult.error && (
                <div style={{ fontSize: 12, color: "var(--red)", marginBottom: 8 }}>{dispatchResult.error}</div>
              )}
              {dispatchResult.result?.final_answer && (
                <pre style={{
                  background: "var(--surface)", borderRadius: 8, padding: 12,
                  fontSize: 11, color: "var(--text-2)", overflowX: "auto",
                  whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 300,
                  margin: 0,
                }}>{dispatchResult.result.final_answer}</pre>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Historique ── */}
      {tab === "log" && (
        <div>
          {log.length === 0 ? (
            <div style={{ textAlign: "center", color: "var(--text-3)", padding: 40, fontSize: 13 }}>
              Aucun routage effectué pour l'instant.
            </div>
          ) : (
            <div>
              {log.map(item => <LogRow key={item.id} item={item} />)}
            </div>
          )}
        </div>
      )}

      {/* ── Tab Couches ── */}
      {tab === "layers" && (
        <div>
          <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
            {Object.values(layerHealth).filter(Boolean).length} / {PYTHON_LAYERS.length} couches en ligne
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
            {PYTHON_LAYERS.map(l => (
              <LayerStatus key={l.id} layer={l} healthy={layerHealth[l.port]} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
