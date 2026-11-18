// electron-builder afterPack hook: ad-hoc signs the macOS app.
// There is no Apple Developer certificate, so electron-builder doesn't sign
// (mac.identity: null). But Apple Silicon refuses to run code with no valid
// signature, and packing changes Electron's bundle (which breaks its original
// signature). An ad-hoc signature ("-") makes it run; Gatekeeper still asks
// the user to confirm on first launch (see README, "macOS").
const { execFileSync } = require("node:child_process");
const { join } = require("node:path");

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" });
};
