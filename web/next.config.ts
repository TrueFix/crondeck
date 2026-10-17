import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";
const apiTarget = process.env.CRONDECK_API ?? "http://localhost:8080";

// Production: static export embedded into the Go binary (no Node runtime at all).
// Development: `next dev` proxies /api to the Go server so cookies stay same-origin.
const nextConfig: NextConfig = {
  ...(isDev
    ? {
        // keep /api/foo as-is (no /api/foo/ redirect) so requests reach the Go router unchanged
        skipTrailingSlashRedirect: true,
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${apiTarget}/api/:path*` }];
        },
      }
    : { output: "export" as const }),
  trailingSlash: true,
  images: { unoptimized: true },
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
