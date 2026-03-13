/**
 * Agents.jsx — Monitoring des agents IA
 */
import React, { useState, useEffect } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

function Skeleton({ w="100%", h=16, radius=6 }) {
  return <div style={{ width:w, height:h, borderRadius:radius,
    background:"linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%)",
    backgroundSize:"400px 100%", animation:"shimmer 1.5s infinite" }} />;
}

// Sparkline SVG inline (données aléatoires animées)
function Sparkline({ color = "#4ADE80", width = 80, height = 30 }) {
  const pts = Array.from({length:10}, (_,i) => Math.random()*0.7+0.15);
  const path = pts.map((v,i) => `${(i/(pts.length-1))*width},${height-(v*height)}`).join(" L ");
  return (
    <svg width={width} height={height} style={{ display:"block" }}>
      <polyline points={path.replace(/L /g," ")} fill="none" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
    </svg>
  );
}

// Card agent
function AgentCard({ agent }) {
  const STATUS_COLOR = { idle:"var(--green)", running:"var(--blue)", unavailable:"var(--text-3)" };
  const color = STATUS_COLOR[agent.status] || "var(--text-3)";
  const isCloud = agent.model?.includes("cloud") || agent.model?.includes("glm") || agent.model?.includes("gpt");

  return (
    <div style={{
      background:"var(--surface-2)", border:"1px solid var(--border-2)",
      borderRadius:"var(--radius-lg)", padding:"20px 22px",
      display:"flex", flexDirection:"column", gap:14,
    }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", gap:12 }}>
        <div style={{
          width:42, height:42, borderRadius:12,
          background:`${agent.color}20`, border:`1px solid ${agent.color}40`,
          display:"flex", alignItems:"center", justifyContent:"center",
          fontSize:20, flexShrink:0,
        }}>{agent.icon}</div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:14, fontWeight:600, color:"var(--text)" }}>{agent.name}</div>
          <div style={{ fontSize:11, color:"var(--text-3)", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {agent.model || "Non configuré"}
          </div>
        </div>
        <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:4 }}>
          <div style={{ display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:color, display:"inline-block",
              boxShadow: agent.status==="running" ? `0 0 6px ${color}` : "none" }} />
            <span style={{ fontSize:11, color, fontWeight:500, textTransform:"capitalize" }}>{agent.status}</span>
          </div>
          <span style={{
            fontSize:10, padding:"1px 6px", borderRadius:10,
            background: isCloud ? "rgba(99,102,241,0.15)" : "rgba(74,222,128,0.15)",
            color: isCloud ? "var(--violet)" : "var(--green)",
            fontWeight:500, border: `1px solid ${isCloud ? "#6366f130":"#4ade8030"}`,
          }}>{isCloud ? "☁ Cloud" : "⚡ Local"}</span>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-end" }}>
        <div>
          <div style={{ fontSize:11, color:"var(--text-3)", marginBottom:4 }}>Dernière tâche</div>
          <div style={{ fontSize:12, color:"var(--text-2)", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
            {agent.lastTask || "Aucune"}
          </div>
        </div>
        <Sparkline color={agent.color || "#60A5FA"} />
      </div>
    </div>
  );
}

export default function Agents({ status }) {
  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ollama, setOllama] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [ar, sr] = await Promise.all([
          fetch(`${QUEEN_API}/api/agents`),
          fetch(`${QUEEN_API}/api/status`),
        ]);
        if (ar.ok) { const d = await ar.json(); setAgents(d.agents || []); }
        if (sr.ok) { const d = await sr.json(); setOllama(d.ollama); }
      } catch {} finally { setLoading(false); }
    };
    load();
    const t = setInterval(load, 6000);
    return () => clearInterval(t);
  }, []);

  return (
    <div style={{ padding:32, maxWidth:1100, margin:"0 auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:"var(--text)", letterSpacing:"-0.02em" }}>Agents IA</h1>
          <p style={{ fontSize:13, color:"var(--text-3)", marginTop:2 }}>
            {ollama?.ok ? `Ollama connecté · ${ollama.latencyMs}ms` : "Ollama déconnecté"}
          </p>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ width:8, height:8, borderRadius:"50%", background: ollama?.ok ? "var(--green)" : "var(--red)", display:"inline-block" }} />
          <span style={{ fontSize:12, color: ollama?.ok ? "var(--green)" : "var(--red)" }}>
            {ollama?.ok ? "Ollama online" : "Ollama offline"}
          </span>
        </div>
      </div>

      {loading ? (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:16 }}>
          {[...Array(6)].map((_,i)=><Skeleton key={i} h={160} radius={14} />)}
        </div>
      ) : (
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:16 }}>
          {agents.map(a => <AgentCard key={a.id} agent={a} />)}
        </div>
      )}

      {/* Modèles depuis status */}
      {status?.models && (
        <div style={{ marginTop:32, padding:20, background:"var(--surface-2)", border:"1px solid var(--border)", borderRadius:"var(--radius-lg)" }}>
          <div style={{ fontSize:13, fontWeight:600, color:"var(--text)", marginBottom:12 }}>Configuration des modèles</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))", gap:8 }}>
            {Object.entries(status.models).map(([role, model]) => (
              <div key={role} style={{ display:"flex", justifyContent:"space-between", padding:"8px 12px", background:"var(--surface-3)", borderRadius:8 }}>
                <span style={{ fontSize:12, color:"var(--text-3)", textTransform:"capitalize" }}>{role}</span>
                <span style={{ fontSize:12, color:"var(--text-2)", fontFamily:"monospace", maxWidth:160, overflow:"hidden", textOverflow:"ellipsis" }}>{model || "auto"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
