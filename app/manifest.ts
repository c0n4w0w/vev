import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TING",
    short_name: "TING",
    description: "Private digitale rom for organisasjoner og kollektiver.",
    start_url: "/",
    display: "browser",
    background_color: "#F7F1E3",
    theme_color: "#214E43",
    icons: [
      { src: "/brand/ting-app-192.png", sizes: "192x192", type: "image/png" },
      { src: "/brand/ting-app-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
