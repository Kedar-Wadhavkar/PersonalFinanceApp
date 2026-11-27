import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config.ts";

/* The offline app (vite-plugin-pwa) and the Content Security Policy must work
   together: the page may load its manifest and service worker from the site,
   and still may not connect anywhere. */

type AnyPlugin = { name?: string; transformIndexHtml?: unknown };
const plugins = (viteConfig.plugins ?? []).flat(3) as AnyPlugin[];

function csp(): string {
  const plugin = plugins.find((p) => p?.name === "content-security-policy")!;
  const tags = (plugin.transformIndexHtml as () => { attrs: { content: string } }[])();
  return tags[0]!.attrs.content;
}

describe("offline app and security policy", () => {
  it("adds the PWA plugin", () => {
    expect(plugins.some((p) => p?.name?.startsWith("vite-plugin-pwa"))).toBe(true);
  });

  it("allows the manifest and service worker from this site only", () => {
    const policy = csp();
    expect(policy).toContain("manifest-src 'self'");
    expect(policy).toContain("worker-src 'self'");
  });

  it("still blocks every network connection", () => {
    const policy = csp();
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("default-src 'none'");
  });
});
