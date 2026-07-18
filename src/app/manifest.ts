import type { MetadataRoute } from "next";
import { branding } from "@/lib/config/branding";

// Served at /manifest.webmanifest and auto-linked from every page by Next.
// No service worker by design: installability doesn't require one, and
// offline caching of financial data needs its own privacy design pass
// (DECISIONS #22).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: branding.appTitle,
    short_name: branding.productName,
    description: branding.description,
    start_url: "/",
    display: "standalone",
    background_color: "#0b0d0f",
    theme_color: "#0b0d0f",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
