/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        // Backgrounds LaRuche
        "laruche-bg":        "#1A1915",
        "laruche-surface":   "#222119",
        "laruche-surface-2": "#2A2921",
        "laruche-surface-3": "#33312A",
        "laruche-surface-4": "#3D3B33",
        // Primary terracotta
        "laruche-primary":   "#E07B54",
        "laruche-primary-h": "#D06944",
        // Agents
        "agent-strategist":  "#6366F1",
        "agent-architect":   "#3B82F6",
        "agent-worker":      "#F59E0B",
        "agent-vision":      "#10B981",
        // Status
        "laruche-green":     "#4ADE80",
        "laruche-red":       "#F87171",
        "laruche-yellow":    "#FBB24C",
        "laruche-blue":      "#60A5FA",
        // Text
        "laruche-text":      "#F2F0EA",
        "laruche-text-2":    "#A09C94",
        "laruche-text-3":    "#6B6760",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "BlinkMacSystemFont", "SF Pro Text", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "monospace"],
      },
      borderRadius: {
        sm: "6px",
        DEFAULT: "10px",
        lg: "14px",
        xl: "20px",
      },
      animation: {
        "pulse-slow": "pulse 2s ease-in-out infinite",
        "spin-slow": "spin 2s linear infinite",
        "slide-up": "slideUp 0.25s ease both",
      },
    },
  },
  // IMPORTANT: désactive Preflight pour ne pas casser le CSS existant
  corePlugins: {
    preflight: false,
  },
};
