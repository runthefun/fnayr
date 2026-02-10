import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    proxy: {
      "/api": "http://localhost:3001",
    },
    watch: {
      ignored: [
        "**/public/textures/**",
        "**/public/models/**",
        "**/public/videos/**",
        "**/public/audio/**",
        "**/public/assets/**",
        "**/data/**",
      ],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "demo.html"),
      },
    },
  },
});
