import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  root: "./src",
  build: {
    outDir: "../dist",
  },
  server: {
    port: 3001,
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/mcp": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/debug": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://localhost:9001",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
