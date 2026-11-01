import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@freecall/auth": path.resolve(__dirname, "../../packages/auth/src/index.ts"),
      "@freecall/config": path.resolve(__dirname, "../../packages/config/src/index.ts"),
      "@freecall/db": path.resolve(__dirname, "../../packages/db/src/index.ts"),
      "@freecall/i18n": path.resolve(__dirname, "../../packages/i18n/src/index.ts"),
      "@freecall/observability": path.resolve(__dirname, "../../packages/observability/src/index.ts"),
      "@freecall/protocol": path.resolve(__dirname, "../../packages/protocol/src/index.ts"),
    },
  },
});
