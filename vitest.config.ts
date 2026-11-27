import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config.ts";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // A browser-like DOM, so the page modules can run as they do in the app
      environment: "happy-dom",
      setupFiles: ["tests/setup.ts"],
      include: ["tests/**/*.test.ts"],
      // Every test file gets fresh modules, so app state never leaks between files
      isolate: true,
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        exclude: ["src/types.ts"],
      },
    },
  }),
);
