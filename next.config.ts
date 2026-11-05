import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-contained server bundle (.next/standalone) for the Docker image; Vercel uses its own output.
  output: process.env.VERCEL ? undefined : "standalone",
  env: {
    // Serverless hosts get lightweight polling instead of long-lived Server-Sent Events.
    NEXT_PUBLIC_REALTIME: process.env.NEXT_PUBLIC_REALTIME || (process.env.VERCEL ? "poll" : "sse"),
  },
  serverExternalPackages: ["@electric-sql/pglite", "pg", "nodemailer"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Service worker for push notifications: always fetched fresh, and limited to same-origin scripts.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
