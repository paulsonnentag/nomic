// Bundles every package under packages/ into its dist/index.js. Each bundle is
// self-contained (Solid and the core included), since the app imports it from
// a blob url where nothing else can be resolved.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { build } from "vite"
import solid from "vite-plugin-solid"

const root = fileURLToPath(new URL("..", import.meta.url))
const packages = `${root}packages`

for (const name of readdirSync(packages)) {
  const manifest = `${packages}/${name}/package.json`
  if (!existsSync(manifest)) continue
  const { source } = JSON.parse(readFileSync(manifest, "utf8"))
  await build({
    configFile: false,
    logLevel: "warn",
    plugins: [solid()],
    resolve: { alias: { "@": `${root}src` } },
    build: {
      lib: { entry: `${packages}/${name}/${source}`, formats: ["es"], fileName: () => "index.js" },
      outDir: `${packages}/${name}/dist`,
      emptyOutDir: true,
      minify: false,
    },
  })
  console.log(`built ${name}`)
}
