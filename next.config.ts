import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server in .next/standalone for the Docker image.
  output: "standalone",
  // Native SQLite driver must not be bundled.
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
  // No telemetry, no external image optimisation.
  images: { unoptimized: true },
  experimental: {
    serverActions: {
      // Hevy CSV exports can be a few MB.
      bodySizeLimit: "20mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
