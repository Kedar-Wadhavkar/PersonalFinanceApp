import { defineConfig, type Plugin } from "vite";

// Content Security Policy of the built site. The browser enforces it, so even
// a future bug cannot send a workbook anywhere:
//   connect-src 'none' .. no fetch / XHR / WebSocket / beacon to any server
//   form-action 'none' .. no form posts
//   default-src 'none' .. nothing else may load unless listed here
// Scripts, styles and fonts come only from this site. Inline style
// attributes are allowed because the charts set widths/colours with them.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

// Added to the built index.html only: the dev server needs a WebSocket for
// live reload, which connect-src 'none' would block.
function contentSecurityPolicy(): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
    ],
  };
}

// GitHub Pages serves this project at https://kedar-wadhavkar.github.io/PersonalFinanceApp/,
// so every asset path must start with /PersonalFinanceApp/. `npm run dev` and
// `npm run preview` use the same path: open http://localhost:5173/PersonalFinanceApp/
export default defineConfig({
  base: "/PersonalFinanceApp/",
  plugins: [contentSecurityPolicy()],
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
