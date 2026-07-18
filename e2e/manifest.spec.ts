import { expect, test } from "@playwright/test";
import { branding } from "../src/lib/config/branding";

test("manifest is served, branded, and installable-shaped", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);

  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    display: string;
    start_url: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  expect(manifest.name).toBe(branding.appTitle);
  expect(manifest.short_name).toBe(branding.productName);
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");

  const sizes = manifest.icons.map((i) => `${i.sizes}:${i.purpose ?? "any"}`);
  expect(sizes).toContain("192x192:any");
  expect(sizes).toContain("512x512:any");
  expect(sizes).toContain("512x512:maskable");

  for (const icon of manifest.icons) {
    const iconRes = await request.get(icon.src);
    expect(iconRes.ok(), `${icon.src} should be served`).toBe(true);
    expect(iconRes.headers()["content-type"]).toContain("image/png");
  }
});
