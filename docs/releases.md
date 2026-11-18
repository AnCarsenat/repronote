# Branches, channels and releases

## Branches

| Branch | Role | Published as | Download page |
|---|---|---|---|
| `dev` | Day-to-day work. Features land here first (directly or through PRs into `dev`). | The rolling **`dev` pre-release**, rebuilt on every push: version `X.Y.Z-dev.<CI run number>` | <https://ancarsenat.github.io/repronote/dev/> |
| `main` | Stable. Only receives `dev` when it is ready to ship (merge `dev` → `main`), plus urgent fixes. | **Stable releases**, from a `vX.Y.Z` tag on `main` | <https://ancarsenat.github.io/repronote/> |

Feature branches start from `dev` and are merged back into `dev`. Never commit release work directly on `main` except a hotfix; a hotfix on `main` is merged back into `dev` right after.

## Versions

- `package.json` holds the **next** version on `dev` (e.g. `0.4.0` while 0.3.0 is the latest release) and the released version on `main`.
- CI computes the real version (`scripts/ci-version.mjs`) and writes it into `package.json` in the runner, so every file carries it:
  - push to `dev` → `0.4.0-dev.57` (channel `dev`)
  - tag `v0.4.0` → `0.4.0` (channel `stable`; a warning if it differs from `package.json`)
  - anything else (PRs, pushes to `main`) → `package.json`'s version, artifacts only
- The bundles get `__REPRONOTE_VERSION__` / `__REPRONOTE_CHANNEL__` from `scripts/build.mjs`; the running app reports them in `/api/state.version`.
- Ordering (used by the update check, `isNewer` in `src/core/updates.ts`): `0.3.0 < 0.4.0-dev.1 < 0.4.0-dev.57 < 0.4.0`.
- Android `versionCode` is the CI run number, so every build installs over any older one; `versionName` is the version.

## Releasing a stable version

1. On `dev`: make sure the last `dev` build is green and tried (the dev pre-release). Update `README.md`/`site/` for the new features.
2. Merge `dev` into `main` (PR `dev` → `main`, merge commit).
3. On `main`: set `package.json` to the version (`npm version 0.4.0 --no-git-tag-version`), commit `chore: v0.4.0`, tag `git tag -a v0.4.0 -m "v0.4.0"`, push `main` and the tag.
4. CI builds and publishes the release (all files + `install-linux.sh`, generated notes). Check it has every asset.
5. On `dev`: merge `main` back, then bump `package.json` to the next version (`0.5.0`) so dev builds sort after the release.

## The dev pre-release

Job `release-dev` in `.github/workflows/build.yml`: after a successful build of a push to `dev`, it deletes the previous `dev` release and tag and creates a new pre-release named `Dev <version>` with all files and `install-linux.sh`, at that commit. Pre-releases never become GitHub's "latest", so stable links (`/releases/latest`) are not affected.

## Download pages (GitHub Pages)

`.github/workflows/pages.yml` runs when `site/` (or the screenshots) change on either branch. It checks out **both** branches and publishes `main`'s `site/` at the root and `dev`'s `site/` under `/dev/`. The page reads the matching release from the GitHub API (`/releases/latest` or `/releases/tags/dev`) and picks the right file for the visitor's device. Pages must be enabled once with "GitHub Actions" as the source (Settings → Pages, or `gh api -X POST repos/AnCarsenat/repronote/pages -f build_type=workflow`).

## Update checks in the apps

`src/core/updates.ts` asks `GET /repos/AnCarsenat/repronote/releases`: channel `stable` takes the first non-pre-release, channel `dev` the `dev` pre-release (its version is read from its title). The user picks the channel in Réglages → À propos. Nothing is installed automatically; per platform:

| Platform | Offered | How it installs |
|---|---|---|
| Android | the APK for the phone's ABI | opened by the system installer, over the old app — **requires the same signing key** (below) |
| Windows | `win-x64.exe` | NSIS installer over the old version |
| macOS | `mac-arm64.dmg` / `mac-x64.dmg` (by `process.arch`) | drag into Applications over the old app; no Apple certificate, ad-hoc signed by `scripts/mac-adhoc-sign.cjs`, so Gatekeeper asks once (README « macOS ») |
| Linux AppImage / deb / tar.gz | the same kind of file | replace / install the package |
| Server from `install-linux.sh` | the command; `repronote-server --update` | re-runs the installer (keeps the channel) |
| Server zip / source | the zip | replace the folder / `git pull` |

## Android signing

Updates only install over an app signed with the same key. CI signs with the key from these repository secrets (otherwise with a throwaway debug key, and every build needs an uninstall first):

| Secret | |
|---|---|
| `ANDROID_KEYSTORE_B64` | the keystore file, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | store password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

**Never lose or replace this key**: apps signed with another key can't update, users would have to uninstall (losing their data). Keep an offline backup of the keystore and its passwords.

The secrets were added on 2026-11-17: v0.1.0–v0.3.0 (and dev builds before run 38) were signed with each CI runner's throwaway debug key, so every one of them needs a one-time uninstall before 0.4.0 installs (the README's update table says so). To stop that happening again, the `android` job sets `REPRONOTE_REQUIRE_SIGNING` on `dev` and tag builds, and `android/app/build.gradle` fails instead of falling back to the debug key; pull requests (no secrets) still build debug-signed artifacts.
