import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  root: "showcase",
  resolve: {
    alias: {
      "spectral-display": path.resolve(__dirname, "./src/index.ts"),
    },
  },
});
