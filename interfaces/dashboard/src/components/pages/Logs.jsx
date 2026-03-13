/**
 * Logs.jsx — Logs temps réel de LaRuche
 */
import React, { useState, useEffect, useRef } from "react";

const QUEEN_API = import.meta.env.VITE_QUEEN_API || "http://localhost:3000";

// Strip ANSI escape codes (ex: \u001b[32minfo\u001b[39m → info)
function stripAnsi(line) {
  return line.replace(/\x1b\[[0-9;]*m/g, "");
}

function colorLine(line) {
  if (/\[error\]|\[err\]/i.test(line)) return "var(--red)";
  if (/\[warn\]/i.test(line)) return "var(--yellow)";
  if (/\[info\]/i.test(line)) return "var(--green)";
  if (/^\d{4}-\d{2}-\d{2}/.test(line)) return "var(--text-3)";
  return "var(--text-2)";
}

function LogLine({ line }) {
  const clean = stripAnsi(line);
  return (
    <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, lineHeight:1.7, color:colorLine(clean), wordBreak:"break-all" }}>
      {clean}
    </div>
  );
}

export default function Logs() {
  const [lines, setLines]   = useState([]);
  const [filter, setFilter] = useState("all");
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`${QUEEN_API}/api/logs?lines=300`);
        if (r.ok) { const d = await r.json(); setLines(d.lines || []); }
      } catch {}
    };
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (autoScroll) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines, autoScroll]);

  const filtered = filter === "all" ? lines : lines.filter(l => {
    const clean = stripAnsi(l);
    if (filter === "error") return /\[error\]/i.test(clean);
    if (filter === "warn")  return /\[warn\]/i.test(clean);
    if (filter === "info")  return /\[info\]/i.test(clean);
    return true;
  });

  return (
    <div style={{ padding:32, maxWidth:1100, margin:"0 auto", display:"flex", flexDirection:"column", height:"calc(100vh - 120px)" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:16, flexShrink:0 }}>
        <div>
          <h1 style={{ fontSize:22, fontWeight:700, color:"var(--text)", letterSpacing:"-0.02em" }}>Logs</h1>
          <p style={{ fontSize:13, color:"var(--text-3)", marginTop:2 }}>{lines.length} lignes · refresh 3s</p>
        </div>
        <div style={{ display:"flex", gap:8 }}>
          {["all","info","warn","error"].map(f=>(
            <button key={f} onClick={()=>setFilter(f)} style={{
              background: filter===f ? "var(--primary-dim)" : "var(--surface-2)",
              border: filter===f ? "1px solid var(--primary)" : "1px solid var(--border-2)",
              color: filter===f ? "var(--primary)" : "var(--text-2)",
              borderRadius:20, padding:"5px 12px", fontSize:11, fontWeight:500, cursor:"pointer",
            }}>{f.charAt(0).toUpperCase()+f.slice(1)}</button>
          ))}
          <button onClick={()=>setLines([])} style={{
            background:"var(--surface-2)", border:"1px solid var(--border-2)",
            color:"var(--text-3)", borderRadius:20, padding:"5px 12px", fontSize:11, cursor:"pointer",
          }}>Clear</button>
          <button onClick={()=>navigator.clipboard?.writeText(filtered.join("\n"))} style={{
            background:"var(--surface-2)", border:"1px solid var(--border-2)",
            color:"var(--text-3)", borderRadius:20, padding:"5px 12px", fontSize:11, cursor:"pointer",
          }}>Copier</button>
          <button onClick={()=>setAutoScroll(a=>!a)} style={{
            background: autoScroll ? "var(--primary-dim)" : "var(--surface-2)",
            border: autoScroll ? "1px solid var(--primary)" : "1px solid var(--border-2)",
            color: autoScroll ? "var(--primary)" : "var(--text-3)",
            borderRadius:20, padding:"5px 12px", fontSize:11, cursor:"pointer",
          }}>↓ Auto-scroll</button>
        </div>
      </div>

      {/* Log viewer */}
      <div ref={containerRef} style={{
        flex:1, overflowY:"auto", background:"var(--surface-2)",
        border:"1px solid var(--border)", borderRadius:"var(--radius-lg)",
        padding:"14px 18px",
      }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign:"center", padding:40, color:"var(--text-3)" }}>Aucun log disponible</div>
        ) : (
          filtered.map((line, i) => <LogLine key={i} line={line} />)
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
