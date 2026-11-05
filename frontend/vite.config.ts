import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true, // Expõe na rede local (0.0.0.0)
    allowedHosts: true, // aceita qualquer domínio (preview remoto / túnel)
    // Em túnel/preview HTTPS o HMR precisa subir por wss/443. Em casa (localhost) fica o padrão.
    hmr: process.env.PREVIEW_HMR ? { clientPort: 443, protocol: "wss" } : undefined,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8787",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
