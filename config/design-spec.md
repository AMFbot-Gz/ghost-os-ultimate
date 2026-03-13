# LaRuche Design Spec — v1.0

## Palette

### Fond principal
- `--bg`: `#1A1915` — Noir chaud (base)
- `--surface`: `#222119` — Surface légèrement plus claire
- `--surface-2`: `#2A2921` — Cartes
- `--surface-3`: `#33312A` — Éléments interactifs
- `--surface-4`: `#3D3B33` — Hover states

### Accent principal — Terracotta
- `--primary`: `#E07B54` — Orange terracotta (comme Claude.ai)
- `--primary-hover`: `#D06944`
- `--primary-active`: `#BB5C38`
- `--primary-dim`: `rgba(224, 123, 84, 0.12)` — Fond accent subtle
- `--primary-glow`: `rgba(224, 123, 84, 0.25)` — Glow / focus

### Accent secondaire — Ambre (agents actifs)
- `--amber`: `#F59E0B`
- `--amber-dim`: `rgba(245, 158, 11, 0.15)`
- `--amber-glow`: `rgba(245, 158, 11, 0.30)`

### Textes
- `--text`: `#F2F0EA` — Texte principal
- `--text-2`: `#A09C94` — Texte secondaire
- `--text-3`: `#6B6760` — Texte désactivé / placeholder

### Statuts
- `--green`: `#4ADE80` — Succès
- `--red`: `#F87171` — Erreur
- `--yellow`: `#FBB24C` — Avertissement
- `--blue`: `#60A5FA` — Info
- `--violet`: `#6366F1` — Stratège
- `--cyan`: `#06B6D4` — Architecture

### Bordures
- `--border`: `rgba(255, 255, 255, 0.06)` — Très subtile
- `--border-2`: `rgba(255, 255, 255, 0.11)` — Standard
- `--border-3`: `rgba(255, 255, 255, 0.18)` — Visible

---

## Typographie

- **Font principale**: `Inter`, -apple-system, SF Pro Text, sans-serif
- **Font monospace**: `JetBrains Mono`, `Fira Code`, monospace
- **Size base**: 14px
- **Line-height**: 1.55

### Hierarchy
| Role | Size | Weight | Color |
|------|------|--------|-------|
| H1 titre page | 20px | 600 | `--text` |
| H2 section | 15px | 600 | `--text` |
| H3 card title | 13px | 600 | `--text` |
| Corps | 14px | 400 | `--text` |
| Secondary | 13px | 400 | `--text-2` |
| Muted | 12px | 400 | `--text-3` |
| Code/mono | 12px | 400 | `--green` ou `--amber` |

---

## Layout

### Dashboard
```
┌─────────────────────────────────────────────────────────┐
│  SIDEBAR (268px)  │  MAIN CONTENT (flex 1)              │
│  ─────────────── │  ──────────────────────────────────  │
│  Logo + nav       │  StatusGrid (2x2 agent cards)       │
│  Agent list       │  ─────────────────────────────────  │
│  Missions hist.   │  [ MissionFeed ]  [ CostMeter ]    │
│                   │  ─────────────────────────────────  │
│                   │  TelegramConsole                    │
└─────────────────────────────────────────────────────────┘
```

### HUD (Electron overlay)
```
┌──────────────────────┐  ← 320px, fixed bottom-right
│  MissionBar          │  Progress + agent name + timer
│  ────────────────    │
│  ThoughtStream       │  Tokens en streaming
│  (expandable)        │
│  ────────────────    │
│  ThermalGauge        │  CPU% / GPU% bars
└──────────────────────┘
```

---

## Composants

### Agent Card (StatusGrid)
- Background: `--surface-2`
- Border: `--border-2`
- Border-radius: `--radius` (10px)
- Padding: 16px
- Active state: border-color `--amber`, box-shadow `--amber-glow`
- Icon: 24px, couleur spécifique à l'agent
- Pulse animation sur carte active

**Agents et couleurs:**
| Agent | Icon | Couleur |
|-------|------|---------|
| Stratège | 🧠 | `#6366f1` violet |
| Architecte | ⚡ | `#3b82f6` bleu |
| Worker | 🔧 | `#f59e0b` amber |
| Vision | 👁 | `#10b981` vert |

### Mission Item (MissionFeed)
- Background: `--surface-2` hover `--surface-3`
- Status badge colors: success=`--green`, error=`--red`, running=`--amber`
- Duration badge: `--surface-4`, `--text-3`
- Progress bar: `--primary` → `--amber` gradient

### Cost Widget (CostMeter)
- "LOCAL ∞" affiché en `--green` (coût = 0 car 100% Ollama)
- Chart line: `--primary` (#E07B54)
- Grid: `--border`
- Font monospace pour les chiffres

### Terminal (TelegramConsole)
- Background: `#0D0D0D` (plus sombre que --bg)
- Font: JetBrains Mono, 12px
- Prompt: `> ` en `--primary`
- Réponses bot: `--text-2`
- Errors: `--red`
- Status indicator: dot animé vert/rouge

---

## Animations

| Nom | Description | Durée |
|-----|-------------|-------|
| `pulse` | Opacité 1 → 0.35 → 1 | 2s infinite |
| `slideUp` | Y+10 → Y0, opacity 0→1 | 0.25s ease |
| `shimmer` | Loading skeleton | 1.5s infinite |
| `spin` | Rotation 360° | 1s linear infinite |
| `bounceIn` | Y+4 → Y0, opacity 0→1 | 0.2s |

---

## Glassmorphism (HUD)

```css
background: rgba(13, 13, 13, 0.75);
backdrop-filter: blur(12px);
-webkit-backdrop-filter: blur(12px);
border: 1px solid rgba(255, 255, 255, 0.08);
border-radius: 14px;
```

---

## Responsive Breakpoints

| Breakpoint | Width | Layout |
|-----------|-------|--------|
| Desktop | ≥1200px | Sidebar + 3 col main |
| Laptop | 900–1199px | Sidebar réduite + 2 col |
| Tablet | 600–899px | Sidebar cachée (toggle) |
| Mobile | <600px | Stack vertical |

---

## Standards de Code React

- **Props**: TypeScript-style JSDoc pour la doc
- **Mocks**: données réalistes par défaut dans chaque composant
- **Fetch**: avec fallback gracieux sur mock data si API indisponible
- **Animation**: `transition: all 0.2s ease` sur éléments interactifs
- **Accessibilité**: `aria-label` sur les boutons icônes
