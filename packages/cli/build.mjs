// Bundles the CLI (and the workspace-only @session-relay/shared) into one file: dist/relay.js.
// Runtime dependencies stay external and are installed from npm.
import { readFile, rm } from "node:fs/promises";
import { build } from "esbuild";

const pkg = JSON.parse(await readFile(new URL("./package.json", import.meta.url), "utf8"));
await rm(new URL("./dist", import.meta.url), { recursive: true, force: true });
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/relay.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: false,
  legalComments: "none",
  external: Object.keys(pkg.dependencies ?? {}).flatMap((d) => [d, `${d}/*`]),
  banner: { js: "#!/usr/bin/env node" },
  define: { __RELAY_VERSION__: JSON.stringify(pkg.version) },
});
console.log(`built dist/relay.js (${pkg.name}@${pkg.version})`);
