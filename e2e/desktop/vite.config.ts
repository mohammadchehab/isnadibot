import { defineConfig } from "vite-plus";

// One Electron app per file; files run one at a time so each gets a fresh isolated home.
export default defineConfig({
  test: {
    include: ["journeys/**/*.e2e.ts"],
    fileParallelism: false,
    hookTimeout: 240_000,
    testTimeout: 240_000,
  },
});
