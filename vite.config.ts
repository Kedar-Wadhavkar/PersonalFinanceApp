import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// Content Security Policy of the built site. The browser enforces it, so even
// a future bug cannot send a workbook anywhere:
//   connect-src 'none' .. no fetch / XHR / WebSocket / beacon to any server
//   form-action 'none' .. no form posts
//   default-src 'none' .. nothing else may load unless listed here
// Scripts, styles, fonts, the service worker and the app manifest come only
// from this site. Inline style
// attributes are allowed because the charts set widths/colours with them.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data:",
  "manifest-src 'self'",
  "worker-src 'self'",
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
  plugins: [
    contentSecurityPolicy(),
    // Installable app that works offline. The service worker stores ONLY the
    // app itself (HTML, JS, CSS, fonts, icons, sample workbook) when the site
    // is first opened, then serves it from that copy, online or not.
    // Workbooks are never cached or stored: they are read from the chosen
    // file into memory, exactly as before.
    VitePWA({
      // A new version waits until you choose to reload (src/pwa.ts shows a
      // note), so a deploy never reloads the page and wipes a loaded workbook.
      registerType: "prompt",
      injectRegister: false,
      // The glob below already picks up every icon
      includeManifestIcons: false,
      manifest: {
        id: "/PersonalFinanceApp/",
        name: "Finance Analytics",
        short_name: "Finance",
        description: "Income, expense, savings and investment analytics from your own Excel workbook. Works offline; files never leave the device.",
        lang: "en",
        start_url: "/PersonalFinanceApp/",
        scope: "/PersonalFinanceApp/",
        display: "standalone",
        orientation: "any",
        background_color: "#ffffff",
        theme_color: "#0f766e",
        categories: ["finance", "productivity"],
        icons: [
          { src: "icons/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          { src: "icons/icon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{html,js,css,woff2,png,svg,xlsx}"],
        navigateFallback: "/PersonalFinanceApp/index.html",
        cleanupOutdatedCaches: true,
        // No runtime caching: nothing outside the precached app is stored
        runtimeCaching: [],
      },
    }),
  ],
  build: {
    outDir: "dist",
    target: "es2022",
  },
});
