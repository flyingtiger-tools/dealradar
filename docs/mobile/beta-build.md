# Beta build (Android internal APK)

LOT "Beta Testable ASAP + Real Activation + End-to-End Device Proof" — how to
build and install an installable beta APK pointed at the correct
non-Production stack.

## What the `beta` EAS profile points at (`apps/mobile/eas.json`)

- **API**: the Vercel git-branch alias for `feat/reprise-ai-ingestion-foundation`
  (`dealradar-web-git-feat-reprise-ai-ingestion-f-d558b0-dealradar2.vercel.app`)
  — this alias always resolves to the latest READY deployment for this
  branch automatically (Vercel-managed, never needs manual updating).
  **Never** the stale `dealradar-web-omega.vercel.app` alias used by the
  `preview` profile (untouched, left as-is) — that one does not track this
  branch.
- **Supabase**: `ofjjqpvdewnzlqaovzfc` (project `dealradar`) — the same
  project used as the beta database for this phase (see
  `docs/market-data-activation-checklist.md`). Only the public `anon` key
  is present (protected by RLS) — never a service-role key in mobile config.
- **`EXPO_PUBLIC_INTERNAL_TOOLS=true`** — builds under package id
  `com.dealradar.mobile.internal` / app name "DealRadar Internal", so it
  installs alongside the standard `com.dealradar.mobile` build without any
  signature conflict (two independent Android apps).

## Building

```bash
cd apps/mobile
npx eas-cli build --platform android --profile beta --non-interactive
```

Requires an authenticated `eas-cli` session (`npx eas-cli whoami`) with
access to the `dealradar` EAS account/project
(`43ef931b-5126-4828-ab49-8ba2a8db4396`).

A repo-root `.easignore` excludes local tooling directories
(`.agents/`, `.claude/`, `.codex/`, `graphify-out/`) from the upload — some
of these can contain symlinks that a raw working-directory tar cannot
replicate on Windows (`EPERM ... symlink`); building from a clean git
checkout (no uncommitted changes) additionally makes `eas-cli` use a git
archive, which never includes untracked files in the first place.

## Known local caveat

If a native `android/` directory exists locally (e.g. from a prior
`expo prebuild` run), EAS Build uses the package id baked into it instead
of `app.config.ts`'s dynamic switching — check
`android/app/build.gradle`'s `applicationId` if a build produces the wrong
package id. This directory is never committed (not in `.gitignore` by
name, but never `git add`-ed in practice) — a fresh checkout does not have
this problem.

## Installing

Once a build finishes, `npx eas-cli build:list --platform android --limit 1`
gives its `artifacts.applicationArchiveUrl` (a direct `.apk` download) —
transfer/download it to the device and install (internal distribution,
no Play Store review needed).
