import { defineConfig } from "vite"
import solid from "vite-plugin-solid"

// On GitHub Pages the site lives under /<repo>/. The workflow sets BASE_PATH.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [solid()],
})
