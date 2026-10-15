# HTTP occurrence evidence verification — 2026-10-15

## Source scope

- Collector/core fix sequence through `ffe6347`; Flutter IO implementation at `792e323348083657ae519cabac104479314d9cfd` (SDK source 0.2.1).
- New HTTP v2 groups include origin, method, path, environment, platform, HTTP status and original failure phase. Explicit DNS errors remain distinguishable from generic connection failures.
- Triggering-event summaries and request evidence are shared by email, Dashboard and AI handoff. Historical summaries are labeled separately in email.
- Late arrivals and restart backfill retain latest summary/release. Historical events, Issue IDs and repair associations remain intact; mixed historical groups are not automatically split. New/legacy groups can coexist after upgrade.
- Optional IO adapter observes original connection acquisition and response headers, keeps existing transport configuration, freezes timeout/cancellation evidence and aborts late abandoned acquisitions. Native DNS/TCP/TLS subphase timings remain unavailable.

## Checks completed

| Check | Result |
| --- | --- |
| Main `yarn test` | 204 passed; two existing service-level PostgreSQL tests skipped without TEST_DATABASE_URL |
| TypeScript / ESLint / source sensitive-info scan | Passed |
| Main `yarn build` | Passed |
| HTTP evidence unit coverage | 100% lines; branch/function thresholds >=80% passed |
| PostgreSQL semantics | PGlite real SQL tests cover phase separation, replay/restart, out-of-order release metadata and Issue reconstruction from historical events |
| Real loopback Collector HTTP | Two original failure types round-trip through ingestion/authenticated reads as two Issues with original trace preserved; fixtures remain in memory |
| Dashboard rendering | Original Dio type, request ID and cached independent probe timestamp render correctly |
| Flutter 3.27 / Dart 3.6 | 34 SDK tests passed; Dart analysis passed |
| SDK coverage | Client 230/275 (83.6%); detailed diagnostics 184/216 (85.2%); original IO tracing 134/135 (99.3%) |
| Real loopback Dio | Concurrent success/receive-timeout stay isolated; acquisition timeout and cancellation freeze evidence and abort late connections; forwarding preserves custom client configuration |

The Flutter command wrapper cannot analyze this truncated SDK distribution because its tool-only dev directory is absent. Analysis used the matching bundled Dart executable on lib/test; Flutter tests actually compiled and ran.

## Delivery boundary

Source prepared and Git-pinned; no pub.dev/npm publication, Collector/Dashboard deployment, website deployment or consuming APK release is implied. Physical-device network changes and original DNS/TCP/TLS tracing remain separate acceptance work. Independent probes cannot reconstruct the failed connection or assign a confirmed network/server root cause.
