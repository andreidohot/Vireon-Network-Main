import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  root: "src/dashboard",
  base: "/admin/",
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: ".",
      filename: "sw.js",
      registerType: "autoUpdate",
      manifest: {
        name: "VBOS Admin",
        short_name: "VBOS",
        description: "Installable admin dashboard for VBOS.",
        start_url: "/admin/",
        scope: "/admin/",
        display: "standalone",
        background_color: "#08090d",
        theme_color: "#d4af37",
        icons: [
          {
            src: "/admin/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png"
          },
          {
            src: "/admin/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png"
          },
          {
            src: "/admin/icons/maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg}"]
      },
      devOptions: {
        enabled: false
      }
    })
  ],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/auth": "http://127.0.0.1:8787",
      "/payment-links": "http://127.0.0.1:8787"
    }
  }
});
