import { resolve } from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  server: {
    watch: {
      // Don't reload when assets are imported into public/
      ignored: [
        "**/public/textures/**",
        "**/public/models/**",
        "**/public/videos/**",
        "**/public/audio/**",
        "**/public/assets/**",
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

