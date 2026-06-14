import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        "bg-1": "var(--bg-1)",
        "bg-2": "var(--bg-2)",
        "bg-3": "var(--bg-3)",
        panel: "var(--bg-1)",
        line: "var(--line)",
        "line-soft": "var(--line-soft)",
        text: "var(--text)",
        text2: "var(--text-2)",
        text3: "var(--text-3)",
        amber: "var(--amber)",
        "amber-2": "var(--amber-2)",
        "amber-bg": "var(--amber-bg)",
        "amber-line": "var(--amber-line)",
        ok: "var(--ok)",
        "ok-bg": "var(--ok-bg)",
        hot: "var(--hot)",
        "hot-bg": "var(--hot-bg)",
        stop: "var(--stop)",
        "stop-bg": "var(--stop-bg)",
        steel: "var(--steel)",
        "steel-bg": "var(--steel-bg)",
      },
      fontFamily: {
        saira: "var(--font-saira)",
        sans: "var(--font-plex-sans)",
        mono: "var(--font-plex-mono)",
      },
      borderRadius: {
        DEFAULT: "var(--r)",
      },
    },
  },
  plugins: [],
};

export default config;
