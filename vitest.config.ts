import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  // Database-backed tests share one local SQLite file. Run test files serially
  // so separate Vitest workers cannot contend for the same write lock.
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"], fileParallelism: false },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
