import { defineConfig } from "vite";

// GitHub Pages serves this project at https://kedar-wadhavkar.github.io/PersonalFinanceApp/,
// so every asset path must start with /PersonalFinanceApp/. `npm run dev` and
// `npm run preview` use the same path: open http://localhost:5173/PersonalFinanceApp/
export default defineConfig({
  base: "/PersonalFinanceApp/",
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
