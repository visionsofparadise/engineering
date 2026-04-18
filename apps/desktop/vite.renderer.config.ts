import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  define: {
    'process.platform': JSON.stringify(process.platform),
    'process.arch': JSON.stringify(process.arch),
  },
  optimizeDeps: {
    // @e9g/design-system is a workspace package actively edited during
    // development; excluding it from pre-bundling means fresh builds are
    // picked up without restarting the dev server. Other @e9g/* packages
    // ship code that relies on Node builtins (e.g. `crypto`) and need
    // Vite's pre-bundled browser shims, so they stay pre-bundled.
    exclude: ["@e9g/design-system"],
  },
});
