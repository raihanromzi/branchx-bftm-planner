import { fileURLToPath } from "node:url";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [tsconfigPaths()],
  resolve: {
    alias: {
      // "server-only" throws outside a React Server bundle; tests import server modules directly.
      "server-only": fileURLToPath(new URL("./tests/unit/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/unit/**/*.test.tsx"],
    environment: "node",
    // Test files share one test database and truncate it, so they run one at a time.
    fileParallelism: false,
  },
});
