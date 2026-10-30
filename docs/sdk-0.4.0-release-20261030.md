# JavaScript SDK 0.4.0 npm publication — 2026-10-30

- Implementation source: `a54ee71cf02925ba2b1f1c6ed565423761e92e57`.
- Trusted publishing run: https://github.com/Claud-Lu/healthguard/actions/runs/41031232633 . Full CI build/test/type/lint and publication job completed successfully.
- Official npm registry confirms core, sdk-web, sdk-miniprogram and sdk-uniapp at 0.4.0 with latest tags and provenance. Package integrity, source and registry timestamps are recorded in [registry metadata](./sdk-0.4.0-registry-20261030.json).
- Installed Web SDK ESM SHA-256: `c91adb4dfac136e3f17db491dd867b4a85dacc4ac48014685f2efba7fd1c6a03`, identical to the reviewed build.
- 273 tests pass; 2 external database integration tests were not run locally. Browser context/Vue helper line coverage is 100%; an independent Chrome page that imports only the SDK verifies global, Promise, Vue and genuinely opaque cross-origin exceptions, redaction and cleanup without production test events.
- Browser diagnostics are SDK-owned. Optional Vue integration is exported by the package; consumers supply build identity/private sourcemaps, upgrade dependencies and rebuild separately. Existing deployments and historical events do not update automatically.
- This npm publication does not deploy Collector, Dashboard or the documentation website, and does not publish Flutter to pub.dev. Physical browsers/devices and actual alert inbox delivery require separate acceptance.
