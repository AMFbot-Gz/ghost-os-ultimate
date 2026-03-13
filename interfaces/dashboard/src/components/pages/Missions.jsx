/**
 * Missions.jsx — Gestion complète des missions
 */
import React, { useState, useEffect, useCallback } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

// Skeleton
function Skeleton({ w="100%", h=16, radius=6 }) {
  return <div style={{ width:w, height:h, borderRadius:radius,
    background:"linear-gradient(90deg,var(--surface-2) 25%,var(--surface-3) 50%,var(--surface-2) 75%)",
    backgroundSize:"400px 100%", animation:"shimmer 1.5s infinite" }} />;
}

// Badge statut coloré
function StatusBadge({ status }) {
  const cfg = {
    success:   { color: "#4ADE80", bg: "rgba(74,222,128,0.12)",   label: "Succès" },
    error:     { color: "#F87171", bg: "rgba(248,113,113,0.12)",  label: "Erreur" },
    running:   { color: "#60A5FA", bg: "rgba(96,165,250,0.12)",   label: "En cours" },
    pending:   { color: "#FBB24C", bg: "rgba(251,178,76,0.12)",   label: "En attente" },
    cancelled: { color: "#6B6760", bg: "rgba(107,103,96,0.12)",   label: "Annulée" },
  }[status] || { color: "#A09C94", bg: "rgba(160,156,148,0.12)", label: status };
  return (
    <span style={{ background:cfg.bg, color:cfg.color, border:`1px solid ${cfg.color}40`,
      borderRadius:20, padding:"2px 10px", fontSize:11, fontWeight:600, whiteSpace:"nowrap" }}>
      {cfg.label}
    </span>
  );
}

// Format durée
function fmtDuration(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms/1000).toFixed(1)}s`;
  return `${Math.floor(ms/60000)}m ${Math.round((ms%60000)/1000)}s`;
}

// Format date relative
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60000) return "à l'instant";
  if (diff < 3600000) return `il y a ${Math.floor(diff/60000)}m`;
  if (diff < 86400000) return `il y a ${Math.floor(diff/3600000)}h`;
  return d.toLocaleDateString("fr-FR");
}

export default function Missions({ status, onNavigate }) {
  const [missions, setMissions]           = useState([]);
  const [total, setTotal]                 = useState(0);
  const [page, setPage]                   = useState(1);
  const [filter, setFilter]               = useState("all");
  const [search, setSearch]               = useState("");
  const [selected, setSelected]           = useState(null);
  const [loading, setLoading]             = useState(true);
  const [showCompose, setShowCompose]     = useState(false);
  const [command, setCommand]             = useState("");
  const [submitting, setSubmitting]       = useState(false);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${QUEEN_API}/api/missions?limit=${LIMIT}&page=${page}`);
      if (r.ok) { const d = await r.json(); setMissions(d.missions||[]); setTotal(d.total||0); }
    } catch {} finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); const t = setInterval(load, 5000); return ()=>clearInterval(t); }, [load]);

  // Filtre local
  const visible = missions.filter(m => {
    if (filter !== "all" && m.status !== filter) return false;
    if (search && !m.command?.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  // Soumettre mission
  const submit = async () => {
    if (!command.trim() || submitting) return;
    setSubmitting(true);
    try {
      const r = await fetch(`${QUEEN_API}/api/mission`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ command: command.trim() }),
      });
      if (r.ok) { setCommand(""); setShowCompose(false); setTimeout(load, 1000); }
    } catch {} finally { setSubmitting(false); }
  };

  // Retry mission
  const retry = async (cmd) => {
    const r = await fetch(`${QUEEN_API}/api/mission`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ command: cmd }),
    });
    if (r.ok) setTimeout(load, 1000);
  };

  const FILTERS = [
    { id:"all",     label:"Toutes",   count: total },
    { id:"success", label:"Succès",   count: missions.filter(m=>m.status==="success").length },
    { id:"error",   label:"Erreurs",  count: missions.filter(m=>m.status==="error").length },
    { id:"running", label:"En cours", count: missions.filter(m=>m.status==="running"||m.status==="pending").length },
  ];

  return (
    <div style={{ padding:32, maxWidth:1100, margin:"0 auto" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:"var(--text)", letterSpacing:"-0.02em" }}>Missions</h1>
          <p style={{ fontSize:13, color:"var(--text-3)", marginTop:2 }}>{total} missions au total</p>
        </div>
        <button onClick={()=>setShowCompose(true)} style={{
          background:"var(--primary)", color:"white", border:"none",
          borderRadius:"var(--radius)", padding:"9px 18px", fontSize:13,
          fontWeight:600, cursor:"pointer",
        }}>+ Nouvelle mission</button>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div style={{
          position:"fixed", inset:0, background:"rgba(0,0,0,0.6)", zIndex:1000,
          display:"flex", alignItems:"center", justifyContent:"center",
        }} onClick={e=>e.target===e.currentTarget&&setShowCompose(false)}>
          <div style={{ background:"var(--surface-2)", border:"1px solid var(--border-2)",
            borderRadius:"var(--radius-xl)", padding:32, width:560, maxWidth:"90vw" }}>
            <h2 style={{ fontSize:17, fontWeight:600, color:"var(--text)", marginBottom:16 }}>Nouvelle mission</h2>
            <textarea
              value={command} onChange={e=>setCommand(e.target.value)}
              placeholder="Décris la mission à accomplir..."
              autoFocus
              onKeyDown={e=>{if(e.key==="Enter"&&(e.metaKey||e.ctrlKey))submit();}}
              style={{
                width:"100%", minHeight:120, background:"var(--surface-3)",
                border:"1px solid var(--border-2)", borderRadius:"var(--radius)",
                color:"var(--text)", padding:14, fontSize:14, resize:"vertical",
                outline:"none", boxSizing:"border-box", fontFamily:"inherit",
              }} />
            <div style={{ display:"flex", gap:10, marginTop:16, justifyContent:"flex-end" }}>
              <button onClick={()=>setShowCompose(false)} style={{
                background:"transparent", border:"1px solid var(--border-2)",
                color:"var(--text-2)", borderRadius:"var(--radius)", padding:"8px 16px",
                fontSize:13, cursor:"pointer",
              }}>Annuler</button>
              <button onClick={submit} disabled={submitting||!command.trim()} style={{
                background: submitting ? "var(--surface-3)" : "var(--primary)",
                color: submitting ? "var(--text-3)" : "white",
                border:"none", borderRadius:"var(--radius)", padding:"8px 20px",
                fontSize:13, fontWeight:600, cursor: submitting?"not-allowed":"pointer",
              }}>{submitting ? "Envoi..." : "Envoyer ⌘↵"}</button>
            </div>
          </div>
        </div>
      )}

      {/* Filtres + recherche */}
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap" }}>
        <input
          value={search} onChange={e=>setSearch(e.target.value)}
          placeholder="Rechercher une mission..."
          style={{
            background:"var(--surface-2)", border:"1px solid var(--border-2)",
            borderRadius:"var(--radius)", padding:"8px 14px", fontSize:13,
            color:"var(--text)", outline:"none", minWidth:240,
          }} />
        {FILTERS.map(f => (
          <button key={f.id} onClick={()=>setFilter(f.id)} style={{
            background: filter===f.id ? "var(--primary-dim)" : "var(--surface-2)",
            border: filter===f.id ? "1px solid var(--primary)" : "1px solid var(--border-2)",
            color: filter===f.id ? "var(--primary)" : "var(--text-2)",
            borderRadius:20, padding:"6px 14px", fontSize:12, fontWeight:500, cursor:"pointer",
          }}>{f.label} {f.count > 0 && <span style={{ opacity:0.6 }}>({f.count})</span>}</button>
        ))}
      </div>

      {/* Layout table + détail */}
      <div style={{ display:"flex", gap:20 }}>
        {/* Liste */}
        <div style={{ flex:1, minWidth:0 }}>
          {loading && !missions.length ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[...Array(8)].map((_,i)=><Skeleton key={i} h={60} radius={10} />)}
            </div>
          ) : visible.length === 0 ? (
            <div style={{ textAlign:"center", padding:60, color:"var(--text-3)" }}>
              Aucune mission trouvée
            </div>
          ) : (
            <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
              {visible.map(m => (
                <div key={m.id} onClick={()=>setSelected(selected?.id===m.id?null:m)}
                  style={{
                    background: selected?.id===m.id ? "var(--surface-3)" : "var(--surface-2)",
                    border: selected?.id===m.id ? "1px solid var(--border-3)" : "1px solid var(--border)",
                    borderRadius:"var(--radius)", padding:"14px 16px", cursor:"pointer",
                    transition:"all 0.12s",
                  }}>
                  <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                    <StatusBadge status={m.status} />
                    <span style={{ flex:1, fontSize:13, color:"var(--text)", overflow:"hidden",
                      textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                      {m.command || "—"}
                    </span>
                    <span style={{ fontSize:11, color:"var(--text-3)", flexShrink:0 }}>
                      {fmtDuration(m.duration)}
                    </span>
                    <span style={{ fontSize:11, color:"var(--text-3)", flexShrink:0, minWidth:80, textAlign:"right" }}>
                      {fmtDate(m.startedAt || m.ts)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {total > LIMIT && (
            <div style={{ display:"flex", gap:8, marginTop:16, justifyContent:"center" }}>
              <button onClick={()=>setPage(p=>Math.max(1,p-1))} disabled={page===1} style={{
                background:"var(--surface-2)", border:"1px solid var(--border-2)",
                color: page===1 ? "var(--text-3)" : "var(--text-2)",
                borderRadius:6, padding:"6px 14px", fontSize:12, cursor: page===1?"not-allowed":"pointer",
              }}>← Précédent</button>
              <span style={{ padding:"6px 12px", fontSize:12, color:"var(--text-3)" }}>
                Page {page} / {Math.ceil(total/LIMIT)}
              </span>
              <button onClick={()=>setPage(p=>p+1)} disabled={page*LIMIT>=total} style={{
                background:"var(--surface-2)", border:"1px solid var(--border-2)",
                color: page*LIMIT>=total ? "var(--text-3)" : "var(--text-2)",
                borderRadius:6, padding:"6px 14px", fontSize:12, cursor: page*LIMIT>=total?"not-allowed":"pointer",
              }}>Suivant →</button>
            </div>
          )}
        </div>

        {/* Panneau détail */}
        {selected && (
          <div style={{
            width:380, flexShrink:0, background:"var(--surface-2)",
            border:"1px solid var(--border-2)", borderRadius:"var(--radius-lg)", padding:20,
            alignSelf:"flex-start", position:"sticky", top:0,
          }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:16 }}>
              <StatusBadge status={selected.status} />
              <button onClick={()=>setSelected(null)} style={{
                background:"none", border:"none", color:"var(--text-3)", cursor:"pointer", fontSize:18,
              }}>×</button>
            </div>
            <div style={{ fontSize:13, color:"var(--text)", marginBottom:16, lineHeight:1.6 }}>
              {selected.command}
            </div>
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginBottom:16, fontSize:12, color:"var(--text-3)" }}>
              <div>ID : <span style={{ color:"var(--text-2)", fontFamily:"monospace" }}>{selected.id}</span></div>
              <div>Durée : <span style={{ color:"var(--text-2)" }}>{fmtDuration(selected.duration)}</span></div>
              <div>Date : <span style={{ color:"var(--text-2)" }}>{(selected.startedAt || selected.ts) ? new Date(selected.startedAt || selected.ts).toLocaleString("fr-FR") : "—"}</span></div>
              {selected.models?.length > 0 && (
                <div>Modèles : <span style={{ color:"var(--text-2)" }}>{selected.models.join(", ")}</span></div>
              )}
            </div>
            {selected.result && (
              <div style={{ background:"var(--surface-3)", borderRadius:"var(--radius)", padding:12, marginBottom:12 }}>
                <div style={{ fontSize:11, color:"var(--text-3)", marginBottom:6, fontWeight:600, textTransform:"uppercase", letterSpacing:"0.05em" }}>Résultat</div>
                <div style={{ fontSize:12, color:"var(--text-2)", lineHeight:1.6, maxHeight:200, overflowY:"auto", whiteSpace:"pre-wrap" }}>
                  {selected.result}
                </div>
              </div>
            )}
            {selected.error && (
              <div style={{ background:"rgba(248,113,113,0.08)", border:"1px solid rgba(248,113,113,0.2)", borderRadius:"var(--radius)", padding:12, marginBottom:12 }}>
                <div style={{ fontSize:11, color:"var(--red)", marginBottom:4, fontWeight:600 }}>Erreur</div>
                <div style={{ fontSize:12, color:"#f87171", lineHeight:1.6 }}>{selected.error}</div>
              </div>
            )}
            {selected.status === "error" && (
              <button onClick={()=>retry(selected.command)} style={{
                width:"100%", background:"var(--primary)", color:"white", border:"none",
                borderRadius:"var(--radius)", padding:"9px", fontSize:13, fontWeight:600, cursor:"pointer",
              }}>↺ Réessayer</button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
