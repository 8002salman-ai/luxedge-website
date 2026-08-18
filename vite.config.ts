import path from "path";
import { fileURLToPath } from "url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // Dev-only: proxy /api to a deployed Vercel preview so the local admin UI
  // exercises the REAL serverless functions (auth guard, AI router, provider
  // adapters) instead of Vite serving /api as source. Gated on env vars so
  // normal dev/production builds are completely unaffected. The bypass token
  // lives in the gitignored .env, never in this file.
  const apiTarget = env.VERCEL_PREVIEW_API || "";
  const bypass = env.VERCEL_PREVIEW_BYPASS || "";
  const proxy = apiTarget
    ? {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
          ...(bypass ? { headers: { "x-vercel-protection-bypass": bypass } } : {}),
        },
      }
    : undefined;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
    server: {
      allowedHosts: ['.monkeycode-ai.live'],
      ...(proxy ? { proxy } : {}),
    },
  build: {
    // Split vendor libraries into separately cached chunks so app updates
    // do not force visitors to re-download React/router/icon code.
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          icons: ["@phosphor-icons/react"],
        },
      },
    },
  },
  };
});
