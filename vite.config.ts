import { fileURLToPath, URL } from "node:url"
import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// On GitHub Pages the site lives under /<repo>/. The workflow sets BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [solid()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
})
