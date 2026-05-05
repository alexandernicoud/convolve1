import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
// Match `npm run dev:backend` (port 8001). For `uvicorn` on 8000, run with:
//   VITE_PROXY_API=http://127.0.0.1:8000 npm run dev:frontend
const API_TARGET = process.env.VITE_PROXY_API ?? "http://127.0.0.1:8001";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 5173,
    // Same-origin requests in dev (empty API_BASE) proxy to FastAPI — avoids CORS / wrong-port uploads
    proxy: {
      "/datasets": { target: API_TARGET, changeOrigin: true },
      "/trainer": { target: API_TARGET, changeOrigin: true },
      "/runs": { target: API_TARGET, changeOrigin: true },
      "/models": { target: API_TARGET, changeOrigin: true },
      "/api": { target: API_TARGET, changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
