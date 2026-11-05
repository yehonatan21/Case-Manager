import type { MetadataRoute } from "next";
import { env } from "@/lib/env";

/** Web app manifest: lets the app be added to the home screen (needed for push on iPhone). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: env.appName,
    short_name: env.appName.slice(0, 12),
    description: "Requests, quotes and case management",
    start_url: "/portal",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#4338ca",
    dir: "auto",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
