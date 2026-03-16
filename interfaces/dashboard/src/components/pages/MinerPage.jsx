/**
 * MinerPage.jsx — Behavior Mining Engine (Phase 15)
 * Patterns comportementaux · Profil utilisateur · Skill Gaps · Signaux phéromone
 */
import React, { useState, useEffect, useCallback } from "react";
import { useToast } from "../Toast.jsx";

const MINER_API = "http://localhost:8012";

const DOMAIN_META = {
  ui:      { color: "#89b4fa", icon: "🖥" },
  file:    { color: "#a6e3a1", icon: "📁" },
  code:    { color: "#cba6f7", icon: "💻" },
  web:     { color: "#74c7ec", icon: "🌐" },
  system:  { color: "#f9e2af", icon: "⚙️" },
  data:    { color: "#fab387", icon: "📊" },
  media:   { color: "#f38ba8", icon: "🎬" },
  general: { color: "#6c7086", icon: "🔷" },
};

const SIGNAL_META = {
  mining_complete: { icon: "⛏",  color: "#a6e3a1" },
  skill_generated: { icon: "🔨", color: "#cba6f7" },
  model_warmed:    { icon: "🔥", color: "#f9e2af" },
  pattern_found:   { icon: "📡", color: "#89b4fa" },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function DomainBadge({ domain }) {
  const m = DOMAIN_META[domain] || DOMAIN_META.general;
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 12,
      background: m.color + "22", color: m.color, letterSpacing: "0.04em",
    }}>{m.icon} {domain.toUpperCase()}</span>
  );
}

function ScoreBar({ value, max, color }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 5, background: "var(--surface-3,#1a1a1a)", borderRadius: 3, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color || "var(--primary,#E07B54)", borderRadius: 3, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 10, color: "var(--text-3)", width: 34, textAlign: "right" }}>{value.toFixed(1)}</span>
    </div>
  );
}

function CoverageBar({ pct }) {
  const color = pct >= 0.7 ? "#a6e3a1" : pct >= 0.4 ? "#f9e2af" : "#f38ba8";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{ flex: 1, height: 4, background: "var(--surface-3,#1a1a1a)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct * 100}%`, height: "100%", background: color, transition: "width 0.4s" }} />
      </div>
      <span style={{ fontSize: 9, color, width: 28, textAlign: "right" }}>{Math.round(pct * 100)}%</span>
    </div>
  );
}

function StatCard({ icon, label, value, sub, color }) {
  return (
    <div style={{
      background: "var(--surface)", border: "1px solid var(--border)",
      borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 120,
    }}>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>{icon} {label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || "var(--text)", lineHeight: 1.1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--text-3)", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

// ─── Patterns Tab ─────────────────────────────────────────────────────────────

function PatternsTab({ patterns, maxScore }) {
  const [domain, setDomain] = useState("all");
  const domains = ["all", ...Object.keys(DOMAIN_META)];
  const filtered = domain === "all" ? patterns : patterns.filter(p => p.domain === domain);

  return (
    <div>
      {/* Domain filter */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {domains.map(d => (
          <button key={d} onClick={() => setDomain(d)} style={{
            fontSize: 11, padding: "4px 11px", borderRadius: 20, border: "none", cursor: "pointer",
            background: domain === d ? "var(--primary,#E07B54)" : "var(--surface-2)",
            color: domain === d ? "white" : "var(--text-3)",
            fontWeight: domain === d ? 600 : 400,
          }}>{d === "all" ? "Tous" : (DOMAIN_META[d]?.icon + " " + d)}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ textAlign: "center", padding: 50, color: "var(--text-3)", fontSize: 13 }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>⛏</div>
          Aucun pattern — lance un cycle de minage
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {filtered.map((p, i) => (
            <div key={p.id} style={{
              background: "var(--surface)", border: "1px solid var(--border)",
              borderRadius: 9, padding: "12px 16px",
            }}>
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span style={{
                  fontSize: 11, color: "var(--text-3)", width: 20, flexShrink: 0,
                  fontFamily: "monospace", marginTop: 2,
                }}>#{i + 1}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 5, flexWrap: "wrap" }}>
                    <DomainBadge domain={p.domain} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{p.label}</span>
                  </div>

                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                      📈 <strong>{p.episode_count}</strong> épisodes
                    </span>
                    <span style={{ fontSize: 11, color: p.success_rate > 0.7 ? "#a6e3a1" : "#f9e2af" }}>
                      ✓ {Math.round(p.success_rate * 100)}% succès
                    </span>
                    <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                      ⏱ {(p.avg_duration_ms / 1000).toFixed(1)}s moy.
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 5 }}>
                    <span style={{ fontSize: 10, color: "var(--text-3)", width: 56, flexShrink: 0 }}>Score</span>
                    <ScoreBar value={p.pattern_score} max={maxScore || 10} color="var(--primary,#E07B54)" />
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 10, color: "var(--text-3)", width: 56, flexShrink: 0 }}>Coverage</span>
                    <CoverageBar pct={p.skill_coverage} />
                  </div>

                  {p.matching_skills?.length > 0 && (
                    <div style={{ marginTop: 5, display: "flex", gap: 5, flexWrap: "wrap" }}>
                      {p.matching_skills.map(s => (
                        <code key={s} style={{ fontSize: 10, color: "#a6e3a1", background: "rgba(166,227,161,0.08)", borderRadius: 4, padding: "1px 6px" }}>{s}</code>
                      ))}
                    </div>
                  )}

                  {p.generated_skill && (
                    <div style={{ marginTop: 4, fontSize: 10, color: "#cba6f7" }}>
                      🔨 Skill généré: <code style={{ fontFamily: "monospace" }}>{p.generated_skill}</code>
                    </div>
                  )}

                  {p.keywords?.length > 0 && (
                    <div style={{ marginTop: 5, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      {p.keywords.map(k => (
                        <span key={k} style={{ fontSize: 9, color: "var(--text-3)", background: "var(--surface-2)", borderRadius: 4, padding: "1px 5px" }}>{k}</span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profile Tab ──────────────────────────────────────────────────────────────

function ProfileTab({ profile }) {
  if (!profile || profile.error) {
    return (
      <div style={{ textAlign: "center", padding: 50, color: "var(--text-3)", fontSize: 13 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>👤</div>
        {profile?.error || "Profil non disponible — déclenche un minage"}
      </div>
    );
  }

  const maxDomain = Math.max(...(profile.top_domains || []).map(d => d.count), 1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* KPI row */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard icon="🎯" label="Missions totales" value={profile.total_missions} color="var(--text)" />
        <StatCard icon="✅" label="Taux de succès" value={`${profile.success_rate}%`} color="#a6e3a1" />
        <StatCard icon="⏱" label="Durée moyenne" value={`${(profile.avg_duration_ms / 1000).toFixed(1)}s`} color="var(--primary,#E07B54)" />
        <StatCard icon="🧬" label="Patterns détectés" value={profile.top_patterns} color="#cba6f7" />
        <StatCard icon="⚡" label="Skill gaps" value={profile.skill_gaps} color={profile.skill_gaps > 5 ? "#f38ba8" : "#f9e2af"} />
      </div>

      {/* Domain distribution */}
      <div style={{
        background: "var(--surface)", border: "1px solid var(--border)",
        borderRadius: 10, padding: "18px 22px",
      }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 14 }}>
          Distribution des domaines
        </div>
        {(profile.top_domains || []).map(d => {
          const meta = DOMAIN_META[d.domain] || DOMAIN_META.general;
          return (
            <div key={d.domain} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 14, width: 22 }}>{meta.icon}</span>
              <span style={{ fontSize: 12, color: "var(--text-2)", width: 70 }}>{d.domain}</span>
              <div style={{ flex: 1, height: 7, background: "var(--surface-3,#1a1a1a)", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ width: `${(d.count / maxDomain) * 100}%`, height: "100%", background: meta.color, borderRadius: 3, transition: "width 0.5s" }} />
              </div>
              <span style={{ fontSize: 11, color: meta.color, width: 38, textAlign: "right" }}>{d.pct}%</span>
            </div>
          );
        })}
      </div>

      {/* Peak hours */}
      {profile.peak_hours?.length > 0 && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "16px 20px",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
            Heures de pointe (UTC)
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {profile.peak_hours.map(h => (
              <div key={h} style={{
                background: "rgba(137,180,250,0.12)", border: "1px solid rgba(137,180,250,0.3)",
                borderRadius: 8, padding: "8px 16px", textAlign: "center",
              }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: "#89b4fa" }}>{String(h).padStart(2, "0")}h</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skills needed */}
      {profile.top_skills_needed?.length > 0 && (
        <div style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 10, padding: "16px 20px",
        }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 10 }}>
            Skills prioritaires à créer
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {profile.top_skills_needed.map(s => (
              <span key={s} style={{
                background: "rgba(203,166,247,0.12)", border: "1px solid rgba(203,166,247,0.3)",
                borderRadius: 6, padding: "5px 12px", fontSize: 12, color: "#cba6f7", fontFamily: "monospace",
              }}>{s}</span>
            ))}
          </div>
        </div>
      )}

      {/* Model preference */}
      <div style={{ fontSize: 12, color: "var(--text-3)" }}>
        Modèle préféré : <strong style={{ color: "var(--text-2)" }}>{profile.model_preference}</strong>
        · Dernière MàJ : {profile.last_updated ? new Date(profile.last_updated).toLocaleString("fr-FR") : "—"}
      </div>
    </div>
  );
}

// ─── Gaps Tab ─────────────────────────────────────────────────────────────────

function GapsTab({ gaps, onGenerate, generating }) {
  if (!gaps.length) {
    return (
      <div style={{ textAlign: "center", padding: 50, color: "var(--text-3)", fontSize: 13 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>✅</div>
        Aucun gap critique — tous les patterns sont couverts par des skills !
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 4 }}>
        {gaps.length} patterns sans skill couvrant — triés par urgence (gap_score)
      </div>
      {gaps.map(gap => (
        <div key={gap.id} style={{
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 9, padding: "14px 16px",
          borderLeft: `3px solid ${gap.gap_score > 3 ? "#f38ba8" : gap.gap_score > 1.5 ? "#f9e2af" : "var(--border)"}`,
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, flexWrap: "wrap" }}>
                <DomainBadge domain={gap.domain} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{gap.label}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10,
                  background: "rgba(243,139,168,0.12)", color: "#f38ba8",
                }}>GAP {gap.gap_score.toFixed(1)}</span>
              </div>

              <div style={{ display: "flex", gap: 16, marginBottom: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>📈 {gap.episode_count} épisodes</span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>
                  Coverage: <span style={{ color: "#f38ba8" }}>{Math.round(gap.skill_coverage * 100)}%</span>
                </span>
                <span style={{ fontSize: 11, color: "var(--text-3)" }}>Score: {gap.pattern_score.toFixed(2)}</span>
              </div>

              {gap.keywords?.length > 0 && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 8 }}>
                  {gap.keywords.map(k => (
                    <span key={k} style={{ fontSize: 9, color: "var(--text-3)", background: "var(--surface-2)", borderRadius: 4, padding: "1px 5px" }}>{k}</span>
                  ))}
                </div>
              )}

              {gap.generated_skill ? (
                <div style={{ fontSize: 11, color: "#a6e3a1" }}>
                  ✅ Skill généré: <code style={{ fontFamily: "monospace" }}>{gap.generated_skill}</code>
                </div>
              ) : (
                <button
                  onClick={() => onGenerate(gap.id)}
                  disabled={generating === gap.id}
                  style={{
                    background: "rgba(203,166,247,0.12)", border: "1px solid rgba(203,166,247,0.3)",
                    borderRadius: 6, padding: "6px 14px", color: "#cba6f7",
                    fontSize: 11, fontWeight: 600, cursor: generating === gap.id ? "not-allowed" : "pointer",
                    opacity: generating === gap.id ? 0.6 : 1,
                  }}
                >{generating === gap.id ? "⏳ Génération…" : "🔨 Générer le skill"}</button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Signals Tab ──────────────────────────────────────────────────────────────

function SignalsTab({ signals }) {
  if (!signals.length) {
    return (
      <div style={{ textAlign: "center", padding: 50, color: "var(--text-3)", fontSize: 13 }}>
        <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
        Aucun signal phéromone — démarre le minage
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {signals.map((sig, i) => {
        const meta = SIGNAL_META[sig.type] || { icon: "●", color: "var(--text-3)" };
        const ts   = sig.ts ? new Date(sig.ts).toLocaleTimeString("fr-FR") : "—";
        return (
          <div key={i} style={{
            display: "flex", alignItems: "flex-start", gap: 10,
            background: "var(--surface)", borderRadius: 7, padding: "8px 14px",
            borderLeft: `3px solid ${meta.color}`,
          }}>
            <span style={{ fontSize: 14, flexShrink: 0 }}>{meta.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{sig.type}</span>
                <span style={{ fontSize: 10, color: "var(--text-3)" }}>{ts}</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--text-2)", marginTop: 2 }}>
                {sig.pattern && <span>Pattern: {sig.pattern} · </span>}
                {sig.skill   && <span>Skill: <code style={{ fontFamily: "monospace", color: "#cba6f7" }}>{sig.skill}</code> · </span>}
                {sig.model   && <span>Modèle: <span style={{ color: "#f9e2af" }}>{sig.model}</span> · </span>}
                {sig.patterns != null && <span>{sig.patterns} patterns · </span>}
                {sig.gaps    != null && <span>{sig.gaps} gaps · </span>}
                {sig.episodes != null && <span>{sig.episodes} épisodes · </span>}
                {sig.top_domain && <span>domaine: {sig.top_domain}</span>}
                {sig.duration_ms && <span style={{ color: "var(--text-3)", marginLeft: 4 }}>({sig.duration_ms}ms)</span>}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "patterns", label: "Patterns" },
  { id: "profile",  label: "Profil" },
  { id: "gaps",     label: "Gaps" },
  { id: "signals",  label: "Signaux" },
];

export default function MinerPage() {
  const [tab, setTab]           = useState("patterns");
  const [patterns, setPatterns] = useState([]);
  const [profile,  setProfile]  = useState(null);
  const [gaps,     setGaps]     = useState([]);
  const [signals,  setSignals]  = useState([]);
  const [stats,    setStats]    = useState(null);
  const [mining,   setMining]   = useState(false);
  const [warming,  setWarming]  = useState(false);
  const [generating, setGenerating] = useState(null);
  const { toast } = useToast() || {};

  const load = useCallback(async () => {
    try {
      const [pRes, gRes, sigRes, stRes, prRes] = await Promise.all([
        fetch(`${MINER_API}/patterns?limit=50`).then(r => r.json()),
        fetch(`${MINER_API}/gaps?limit=20`).then(r => r.json()),
        fetch(`${MINER_API}/signals?limit=60`).then(r => r.json()),
        fetch(`${MINER_API}/stats`).then(r => r.json()),
        fetch(`${MINER_API}/profile`).then(r => r.json()),
      ]);
      setPatterns(pRes.patterns || []);
      setGaps(gRes.gaps || []);
      setSignals(sigRes.signals || []);
      setStats(stRes);
      setProfile(prRes);
    } catch {}
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const triggerMining = async () => {
    setMining(true);
    try {
      const r = await fetch(`${MINER_API}/mine`, { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        toast?.(`Mining: ${d.patterns_found} patterns, ${d.gaps_found} gaps`, "success");
        load();
      } else { toast?.("Erreur mining", "error"); }
    } catch { toast?.("Serveur inaccessible", "error"); }
    setMining(false);
  };

  const triggerWarmup = async () => {
    setWarming(true);
    try {
      const r = await fetch(`${MINER_API}/warmup`, { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        toast?.(`Warmup: ${d.warmed?.join(", ") || "aucun modèle"}`, "info");
        load();
      } else { toast?.("Erreur warmup", "error"); }
    } catch { toast?.("Serveur inaccessible", "error"); }
    setWarming(false);
  };

  const generateSkill = async (patternId) => {
    setGenerating(patternId);
    try {
      const r = await fetch(`${MINER_API}/gaps/${patternId}/generate`, { method: "POST" });
      if (r.ok) {
        const d = await r.json();
        if (d.ok) { toast?.(`Skill créé: ${d.skill}`, "success"); load(); }
        else { toast?.(`Échec: ${d.error}`, "error"); }
      }
    } catch { toast?.("Erreur génération", "error"); }
    setGenerating(null);
  };

  const maxScore = patterns.length ? Math.max(...patterns.map(p => p.pattern_score), 1) : 1;

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <div>
          <h2 style={{ margin: "0 0 4px", fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
            ⛏ Behavior Mining Engine
          </h2>
          <p style={{ margin: 0, fontSize: 12, color: "var(--text-3)" }}>
            Protocole phéromone · Patterns comportementaux · Skill gaps · Warm cache Ollama
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={triggerWarmup}
            disabled={warming}
            style={{
              background: "rgba(249,226,175,0.12)", border: "1px solid rgba(249,226,175,0.3)",
              borderRadius: 7, padding: "7px 14px", color: "#f9e2af",
              fontSize: 12, fontWeight: 600, cursor: warming ? "not-allowed" : "pointer",
              opacity: warming ? 0.6 : 1,
            }}
          >{warming ? "⏳ Warmup…" : "🔥 Warm Ollama"}</button>
          <button
            onClick={triggerMining}
            disabled={mining}
            style={{
              background: "var(--primary,#E07B54)", color: "white", border: "none",
              borderRadius: 7, padding: "7px 16px", fontSize: 12, fontWeight: 700,
              cursor: mining ? "not-allowed" : "pointer", opacity: mining ? 0.6 : 1,
            }}
          >{mining ? "⏳ Minage…" : "⛏ Miner maintenant"}</button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && (
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 20 }}>
          <StatCard icon="🧬" label="Patterns"    value={stats.patterns_total}   color="var(--primary,#E07B54)" />
          <StatCard icon="⚡" label="Skill gaps"  value={stats.gaps_total}       color={stats.gaps_total > 5 ? "#f38ba8" : "#f9e2af"} />
          <StatCard icon="🔨" label="Skills créés" value={stats.skills_generated} color="#cba6f7" />
          <StatCard icon="📡" label="Dernière run"
            value={stats.last_run ? `${stats.last_run.episodes_read} eps` : "—"}
            sub={stats.last_run ? new Date(stats.last_run.ran_at).toLocaleTimeString("fr-FR") : "jamais"}
            color="var(--text-2)" />
        </div>
      )}

      {/* Tabs */}
      <div style={{
        display: "flex", gap: 4, background: "var(--surface)",
        borderRadius: 8, padding: 4, border: "1px solid var(--border)",
        marginBottom: 24, width: "fit-content",
      }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: "7px 18px", borderRadius: 6, border: "none",
            background: tab === t.id ? "var(--primary,#E07B54)" : "transparent",
            color: tab === t.id ? "white" : "var(--text-2)",
            fontSize: 13, fontWeight: tab === t.id ? 600 : 400,
            cursor: "pointer", position: "relative",
          }}>
            {t.label}
            {t.id === "gaps" && gaps.length > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#f38ba8", color: "white",
                borderRadius: 10, padding: "0 5px", fontSize: 9, fontWeight: 700, lineHeight: "16px",
              }}>{gaps.length}</span>
            )}
            {t.id === "signals" && signals.length > 0 && (
              <span style={{
                position: "absolute", top: -4, right: -4,
                background: "#89b4fa", color: "white",
                borderRadius: 10, padding: "0 5px", fontSize: 9, fontWeight: 700, lineHeight: "16px",
              }}>{signals.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "patterns" && <PatternsTab patterns={patterns} maxScore={maxScore} />}
      {tab === "profile"  && <ProfileTab  profile={profile} />}
      {tab === "gaps"     && <GapsTab     gaps={gaps} onGenerate={generateSkill} generating={generating} />}
      {tab === "signals"  && <SignalsTab  signals={signals} />}
    </div>
  );
}
