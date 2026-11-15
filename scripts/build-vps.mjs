import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
await mkdir("storage/vps-release", { recursive: true });
for (const [source, name] of [["start", "server"], ["import", "import"]]) {
  await build({
    entryPoints: [`server/${source}.ts`], bundle: true, platform: "node", target: "node24",
    format: "esm", outfile: `storage/vps-release/${name}.mjs`, minify: true,
    sourcemap: false, logLevel: "info",
  });
}
