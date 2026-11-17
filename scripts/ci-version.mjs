// CI: the version and channel of this build, written to $GITHUB_ENV, and into
// package.json so every artifact (electron-builder, APKs, server zip) carries it.
//   tag vX.Y.Z      -> X.Y.Z, stable (a GitHub release)
//   branch dev      -> <package.json version>-dev.<run number>, dev (the rolling "dev" pre-release)
//   anything else   -> <package.json version>, stable (artifacts only)
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const ref = process.env.GITHUB_REF ?? "";
let version = pkg.version;
let channel = "stable";
if (ref.startsWith("refs/tags/v")) {
  version = ref.slice("refs/tags/v".length);
  if (version !== pkg.version) console.warn(`::warning::tag v${version} but package.json says ${pkg.version}`);
} else if (ref === "refs/heads/dev") {
  version = `${pkg.version.replace(/-.*$/, "")}-dev.${process.env.GITHUB_RUN_NUMBER ?? 0}`;
  channel = "dev";
}
pkg.version = version;
writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
const lines = `REPRONOTE_VERSION=${version}\nREPRONOTE_CHANNEL=${channel}\n`;
if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, lines);
console.log(lines.trim());
