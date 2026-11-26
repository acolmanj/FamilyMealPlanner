import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // The app's "@/..." imports, so tests can load route handlers.
  resolve: { alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }] },
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});
