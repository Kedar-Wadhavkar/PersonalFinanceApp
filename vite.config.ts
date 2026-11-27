import { defineConfig, type Plugin, type UserConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";

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

// Policy of the one-file preview (see singleFile() below). The code and the
// styles are inside the page and the fonts are data: URLs, so those must be
// allowed inline; there is no service worker or manifest. Every network
// connection stays blocked, exactly as on the live site.
const PREVIEW_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "img-src 'self' data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

// Added to the built index.html only: the dev server needs a WebSocket for
// live reload, which connect-src 'none' would block.
function contentSecurityPolicy(policy: string): Plugin {
  return {
    name: "content-security-policy",
    apply: "build",
    transformIndexHtml: () => [
      { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy }, injectTo: "head-prepend" },
    ],
  };
}

// Preview build only: puts the bundled JavaScript and CSS inside index.html,
// so the page opens by double-clicking it (file://) with no server. Browsers
// refuse to load separate module scripts from file://, but run inline ones.
// Fonts are already inside the CSS as data: URLs (assetsInlineLimit below).
function singleFile(): Plugin {
  return {
    name: "single-file",
    apply: "build",
    enforce: "post",
    // The font preload would point at a file that no longer exists
    transformIndexHtml: { order: "pre", handler: (html) => html.replace(/<link rel="preload"[^>]*>\s*/g, "") },
    // After the files are written, so Vite has finished every chunk
    writeBundle(options, bundle) {
      const dir = options.dir ?? "dist-preview";
      const htmlPath = path.join(dir, "index.html");
      let page = fs.readFileSync(htmlPath, "utf8");
      for (const file of Object.values(bundle)) {
        const ref = new RegExp(`<(script|link)[^>]*?(?:src|href)="[^"]*${file.fileName.replace(/[.]/g, "\\.")}"[^>]*>(?:</script>)?`);
        if (!ref.test(page)) continue;
        if (file.type === "chunk") {
          // A "</script" inside the code would end the tag early
          const code = file.code.replace(/<\/script/gi, "<\\/script");
          page = page.replace(ref, () => `<script type="module">${code}</script>`);
        } else if (file.fileName.endsWith(".css")) {
          page = page.replace(ref, () => `<style>${String(file.source)}</style>`);
        } else continue;
        fs.rmSync(path.join(dir, file.fileName));
      }
      fs.writeFileSync(htmlPath, page);
      fs.rmSync(path.join(dir, "assets"), { recursive: true, force: true });
    },
  };
}

// GitHub Pages serves this project at https://kedar-wadhavkar.github.io/PersonalFinanceApp/,
// so every asset path must start with /PersonalFinanceApp/. `npm run dev` and
// `npm run preview` use the same path: open http://localhost:5173/PersonalFinanceApp/
//
// makeConfig(true) is the one-file preview that every pull request builds
// (vite.singlefile.config.ts, npm run build:preview, .github/workflows/preview.yml).
// It never touches the live site: it writes to dist-preview/, not dist/.
export function makeConfig(preview: boolean): UserConfig {
  return {
  base: preview ? "./" : "/PersonalFinanceApp/",
  // Lets main.ts skip the service worker, which cannot run from file://
  define: { "import.meta.env.VITE_SINGLE_FILE": JSON.stringify(preview) },
  plugins: [
    contentSecurityPolicy(preview ? PREVIEW_CSP : CSP),
    ...(preview ? [singleFile()] : []),
    // Installable app that works offline. The service worker stores ONLY the
    // app itself (HTML, JS, CSS, fonts, icons, sample workbook) when the site
    // is first opened, then serves it from that copy, online or not.
    // Workbooks are never cached or stored: they are read from the chosen
    // file into memory, exactly as before.
    VitePWA({
      // The preview has no service worker (nothing to register from file://)
      disable: preview,
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
  build: preview
    ? {
        outDir: "dist-preview",
        target: "es2022",
        // Every font and image goes inside the page as a data: URL
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
        // One script: no separate chunks to load
        rolldownOptions: { output: { codeSplitting: false } },
      }
    : {
        outDir: "dist",
        target: "es2022",
      },
  };
}

export default defineConfig(makeConfig(false));
