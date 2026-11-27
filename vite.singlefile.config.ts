import { defineConfig } from "vite";
import { makeConfig } from "./vite.config.ts";

// One self-contained index.html for pull request previews. See makeConfig().
export default defineConfig(makeConfig(true));
