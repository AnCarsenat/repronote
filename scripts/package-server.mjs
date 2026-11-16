// Assembles the standalone server into release/repronote-server/:
//   dist/server.mjs, web/, a minimal package.json (playwright-core only), README, LICENSE.
// Run `npm run build` first. Usage on the target machine:
//   npm install --omit=dev && npm start
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const out = "release/repronote-server";
const pkg = JSON.parse(await readFile("package.json", "utf8"));

await rm(out, { recursive: true, force: true });
await mkdir(`${out}/dist`, { recursive: true });
await cp("dist/server.mjs", `${out}/dist/server.mjs`);
await cp("dist/mcp.mjs", `${out}/dist/mcp.mjs`);
await cp("web", `${out}/web`, { recursive: true });
await cp("README.md", `${out}/README.md`);
await cp("LICENSE", `${out}/LICENSE`);
await writeFile(
  `${out}/package.json`,
  JSON.stringify(
    {
      name: "repronote-server",
      version: pkg.version,
      private: true,
      description: pkg.description,
      license: pkg.license,
      type: "module",
      engines: pkg.engines,
      scripts: { start: "node dist/server.mjs", mcp: "node dist/mcp.mjs" },
      // Everything else is bundled into dist/server.mjs.
      dependencies: { "playwright-core": pkg.dependencies["playwright-core"] },
    },
    null,
    2,
  ) + "\n",
);
console.log(`Server package ready in ${out}/`);
