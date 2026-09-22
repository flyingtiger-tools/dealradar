# S24 Ultra beta E2E checklist

LOT "Beta Testable ASAP + Real Activation + End-to-End Device Proof" —
ordered manual test steps for the first real on-device pass. **Nothing
below is marked PASS until actually executed on the device** — this is a
script to follow, not a report of results.

## Prerequisites

- Beta APK installed (see `docs/mobile/beta-build.md` for how it's built;
  install via the direct `.apk` download link from the EAS build page —
  internal distribution, no Play Store review).
- Package `com.dealradar.mobile.internal` — installs alongside any
  existing standard `com.dealradar.mobile` build with zero conflict.
- Device connected to the internet (Wi-Fi or mobile data) — no cable
  required once the APK is installed.

## Steps

**A. Install APK**
Download the `.apk` from the EAS build artifact URL directly on the
device (or transfer it), then install (Android will prompt to allow
installs from this source the first time for internal-distribution APKs).

**B. Login**
Open the app, go through the sign-in flow. Confirm no crash, a session is
established, and the app reaches its main/home screen.

**C. Generic object photo scan**
Pick a non-TCG category, capture/upload a photo of any real object,
submit. Confirm the request is accepted and a result eventually renders
(or a clear, honest "insufficient data" — never a silent hang).

**D. Barcode scan**
Repeat with an object that has a visible barcode, letting the camera
detect it (`normalize-barcode.ts` / `UniversalCaptureScreen.tsx`). Confirm
the barcode is captured alongside the photo (not instead of it).

**E. Cancel one analysis**
Submit an analysis, then cancel it before it completes (interactive
cancellation, migration 0026). Confirm the UI reflects a cancelled state,
never a stuck spinner or a misrepresented failure.

**F. Open returned result**
For a completed analysis, open its result screen. Confirm product name,
price range, and decision (if any) render without crashing.

**G. Verify identity-quality label**
Check whether the result surfaces an identity-quality indicator
("Identifié par code-barres" / "Catalogue LEGO confirmé" / "Identification
visuelle seulement") — the view-model field exists
(`identityQualityLabel`, `screens/result/identity-quality.ts`), but **no
screen renders it yet as of this lot** (deliberately deferred, see
`docs/free-open-sources-audit.md` §12). Confirm this on the actual
`ResultScreen` UI, not just from prior code review.

**H. Open history**
From a completed result, navigate to product history (if a `productKey`
was resolved). Confirm it opens and does not crash on an empty/thin
history.

**I. Pokémon card scan**
Run the existing, separate TCG scan flow end to end. Confirm no
regression versus its established behavior (this pipeline is untouched by
this lot's work).

## Reporting

For each step, record exactly one of: **PASS**, **FAIL** (with what broke),
or **NOT TESTED** (with why, e.g. blocked by an earlier step). Do not mark
any step PASS from code inspection alone — only from having actually
tapped through it on the device.
