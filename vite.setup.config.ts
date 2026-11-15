// The setup window's page alone (setup.html), built into dist-setup for src-setup. `npm run dev` serves it too, at
// http://localhost:1420/setup.html.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: { target: "es2022", sourcemap: false, outDir: "dist-setup", emptyOutDir: true, rollupOptions: { input: "setup.html" } },
});
