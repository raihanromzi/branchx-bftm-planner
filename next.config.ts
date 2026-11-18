import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The dev-only indicator sits bottom-left, over the app shell's bottom navigation (E0-S4). Errors still show.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
