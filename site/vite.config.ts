import patchwork from "@inkandswitch/patchwork/vite"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: patchwork({ html: false, icons: false, manifest: false, netlify: false, storagePrefix: "nomic" }),
})
