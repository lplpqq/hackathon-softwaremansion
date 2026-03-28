import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-ignore
import path from "path";

export default defineConfig({
  plugins: [react()],
  envDir: __dirname,
  envPrefix: "VITE_",
  root: path.resolve(__dirname, "src/renderer"),
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
