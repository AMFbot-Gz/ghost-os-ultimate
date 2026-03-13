/**
 * Settings.jsx — Configuration LaRuche
 */
import React, { useState, useEffect } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

function Skeleton({ w="100%", h=16, radius=6 }) {
  return <div style={{ width:w, height:h, borderRadius:radius,
    background:"linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%)",
    backgroundSize:"400px 100%", animation:"shimmer 1.5s infinite" }} />;
}

function Section({ title, children }) {
  return (
    <div style={{ background:"var(--surface-2)", border:"1px solid var(--border-2)",
      borderRadius:"var(--radius-lg)", overflow:"hidden", marginBottom:16 }}>
      <div style={{ padding:"14px 20px", borderBottom:"1px solid var(--border)",
        fontSize:13, fontWeight:600, color:"var(--text)" }}>{title}</div>
      <div style={{ padding:"16px 20px", display:"flex", flexDirection:"column", gap:12 }}>
        {children}
      </div>
    </div>
  );
}

function ConfigRow({ label, value, desc, secret }) {
  const display = secret && value && value !== "" ? "••••••••" : (value || "—");
  return (
    <div style={{ display:"flex", alignItems:"center", gap:16 }}>
      <div style={{ flex:1 }}>
        <div style={{ fontSize:13, color:"var(--text)", fontWeight:500 }}>{label}</div>
        {desc && <div style={{ fontSize:11, color:"var(--text-3)", marginTop:2 }}>{desc}</div>}
      </div>
      <div style={{ fontFamily:"monospace", fontSize:12, color: value ? "var(--text-2)" : "var(--text-3)",
        background:"var(--surface-3)", padding:"5px 10px", borderRadius:6,
        border:"1px solid var(--border)", maxWidth:280, overflow:"hidden",
        textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
        {display}
      </div>
    </div>
  );
}

export default function Settings() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${QUEEN_API}/api/config`);
      if (r.ok) setConfig(await r.json());
    } catch {} finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  if (loading) return (
    <div style={{ padding:32, maxWidth:800, margin:"0 auto" }}>
      <Skeleton h={32} w={200} radius={8} />
      <div style={{ marginTop:24, display:"flex", flexDirection:"column", gap:16 }}>
        {[...Array(3)].map((_,i)=><Skeleton key={i} h={140} radius={14} />)}
      </div>
    </div>
  );

  const env = config?.env || {};
  const cfg = config?.config || {};

  return (
    <div style={{ padding:32, maxWidth:800, margin:"0 auto" }}>
      <div style={{ marginBottom:24 }}>
        <h1 style={{ fontSize:22, fontWeight:700, color:"var(--text)", letterSpacing:"-0.02em" }}>Réglages</h1>
        <p style={{ fontSize:13, color:"var(--text-3)", marginTop:2 }}>
          Configuration actuelle — modifiez <code style={{ fontFamily:"monospace", color:"var(--amber)" }}>.env</code> pour les clés sensibles
        </p>
      </div>

      <div style={{ background:"rgba(251,178,76,0.08)", border:"1px solid rgba(251,178,76,0.2)",
        borderRadius:"var(--radius)", padding:"12px 16px", marginBottom:20,
        fontSize:13, color:"var(--yellow)", display:"flex", gap:8 }}>
        ⚠️ Les tokens et clés API sont masqués. Éditez directement le fichier <code style={{fontFamily:"monospace"}}>.env</code> pour les modifier.
      </div>

      <Section title="🌐 Réseau & Ports">
        <ConfigRow label="Port API" value={env.API_PORT || "3000"} desc="Port du serveur REST (queen_oss)" />
        <ConfigRow label="Port HUD" value={env.HUD_PORT || "9001"} desc="WebSocket temps réel" />
        <ConfigRow label="Port Dashboard" value={env.DASHBOARD_PORT || "8080"} desc="Serveur dashboard" />
        <ConfigRow label="Ollama Host" value={env.OLLAMA_HOST || "http://localhost:11434"} desc="Endpoint Ollama local" />
      </Section>

      <Section title="🤖 Modèles IA">
        {cfg.models && Object.entries(cfg.models).filter(([k])=>!k.startsWith("_")).map(([role, model]) => (
          <ConfigRow key={role} label={role.charAt(0).toUpperCase()+role.slice(1)}
            value={model || "Auto-détecté"} desc={`Modèle Ollama pour le rôle ${role}`} />
        ))}
        {!cfg.models && (
          <ConfigRow label="Modèles" value="Auto-détectés depuis Ollama" desc="Définis dans .laruche/config.json" />
        )}
      </Section>

      <Section title="📱 Telegram">
        <ConfigRow label="Bot Token" value={env.TELEGRAM_BOT_TOKEN || env.TELEGRAM_TOKEN} desc="Token d'authentification du bot" secret />
        <ConfigRow label="Chat ID" value={env.ADMIN_TELEGRAM_ID || env.TELEGRAM_CHAT_ID} desc="ID du chat administrateur" />
        <ConfigRow label="Mode" value={env.STANDALONE_MODE === "true" ? "Standalone (sans Telegram)" : "Complet (avec Telegram)"} />
      </Section>

      <Section title="⚙️ LaRuche">
        <ConfigRow label="Mode" value={env.LARUCHE_MODE || "balanced"} desc="low / balanced / full" />
        <ConfigRow label="Version" value={cfg.version || "4.1.0"} />
        <ConfigRow label="RAM Limit" value={cfg.ramLimitMB ? `${cfg.ramLimitMB} MB` : "500 MB"} />
        <ConfigRow label="Idle Timeout" value={cfg.idleTimeoutSec ? `${cfg.idleTimeoutSec}s` : "5s"} />
      </Section>

      <div style={{ marginTop:24, display:"flex", gap:10, justifyContent:"flex-end" }}>
        <button onClick={load} style={{
          background:"var(--surface-2)", border:"1px solid var(--border-2)",
          color:"var(--text-2)", borderRadius:"var(--radius)", padding:"9px 18px",
          fontSize:13, cursor:"pointer",
        }}>↺ Recharger</button>
        <button onClick={()=>window.open("vscode://file//Users/wiaamhadara/LaRuche/.env")} style={{
          background:"var(--primary-dim)", border:"1px solid rgba(224,123,84,0.3)",
          color:"var(--primary)", borderRadius:"var(--radius)", padding:"9px 18px",
          fontSize:13, fontWeight:600, cursor:"pointer",
        }}>✏️ Éditer .env dans VSCode</button>
      </div>
    </div>
  );
}
