import type { MetadataRoute } from "next";

// The web app manifest (E0-S4), served at /manifest.webmanifest without a session (see src/proxy.ts).
// There is deliberately no service worker: v1 is online only and caches no data.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "BFTM Planner",
    short_name: "BFTM Planner",
    description: "Perencanaan dan pemantauan akuisisi dana di lapangan.",
    lang: "id",
    start_url: "/",
    scope: "/",
    display: "standalone",
    theme_color: "#0E6E73",
    background_color: "#FFFFFF",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
