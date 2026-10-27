# Scoped device identity (Android / Flutter 0.3.0 source)

This feature is available as **Flutter 0.3.0 Git source**. Collector/Dashboard and a consuming App have passed deployment verification. Package-registry publication, real email delivery and target-tablet acceptance remain separate and pending.

## Identity and limits

`deviceId` is independent of installation `anonymousId` and session `sessionId`. Android's `Settings.Secure.ANDROID_ID` is read by the native plugin; only a SHA-256 pseudonym is returned to Flutter. Input is UTF-8 `healthguard-device-v1`, scope, package name, HealthGuard app key and normalized Android ID, separated by NUL bytes. The wire value is `hgd1_` plus 64 lowercase hex characters. The app key is a namespace, not a cryptographic secret. This is pseudonymization, not encryption or irreversible anonymization; do not treat the ID as authentication.

- Android 8+ (`API 26+`): source `android_id`, scope `android_user_signing_key_app`. The underlying ID is scoped to signing key, system user and device; HealthGuard additionally scopes its hash to app package and project app key.
- Android 5–7 (`API 21–25`): scope `android_user_app_legacy`. Underlying Android ID is user/device scoped, without Android 8's signing-key isolation. HealthGuard adds app/project separation. OEM behavior and duplicate IDs require actual fleet validation.
- Same device/user/signature/package/project normally retains its pseudonym across App restarts and ordinary updates. Same-signature reinstall and clearing App data are expected to retain the underlying Android ID on supported systems, but must be verified on target tablets.
- Factory reset, switching users/work profiles, signing-key changes, package/project changes, OEM resets, and reinstall after an OS upgrade from pre-Android-8 can change the ID. IDs are **not permanently unique**. Do not link changed IDs automatically or merge by model. Legacy/OEM duplication remains possible.
- No IMEI, MAC, advertising ID, serial number, account identity or additional device permission is used. No raw Android ID is stored, logged, sent to Dart, Collector or email. Hashes are recomputed independently of installation storage; restoring installation backups does not establish a device identity.

References: [Android ID API](https://developer.android.com/reference/android/provider/Settings.Secure#ANDROID_ID), [Android 8 changes](https://developer.android.com/about/versions/oreo/android-8.0-changes#privacy-all).

## Flutter setup

Use a reviewed Git revision of `packages/sdk-flutter`; this is not a pub.dev release. Keep the current Collector endpoint and project app key when upgrading. No extra runtime permission is required.

```dart
final monitoring = HealthGuardClient(
  appKey: '<PROJECT_APP_KEY>',
  endpoint: '<COLLECTOR_ENDPOINT>/api/events/batch',
  release: '<APP_VERSION>', // Optional: falls back to native package versionName.
);
await monitoring.initialize();
// In your app's existing settings/debug navigation:
Navigator.of(context).push(MaterialPageRoute(
  builder: (_) => HealthGuardDeviceDebugPage(client: monitoring),
));
```

`deviceIdentity` and `deviceShortCode` expose the same state used by both `captureException` and `captureHttpFailure`, including automatic Dio failures. A caller-supplied model/system remains supported; native model/system fills omissions. SDK version is `0.3.0-flutter`. The optional device snapshot injection is a testing seam; integrations must not fabricate a stable ID.

Native identity lookup has a 300 ms timeout. Missing plugins, invalid/known-broken/all-zero IDs, exceptions or timeouts produce `deviceIdStatus: unavailable`, a bounded reason, no `deviceId`, and a debug label **未获取 / Unavailable**. Other platforms remain unsupported for stable IDs. Monitoring and Dio's business request flow continue; no random, installation or model fallback masquerades as a stable ID. Old offline events retain their original device/installation IDs, timestamp, SDK and release; they are not enriched from the current device during replay.

## Event contract and persistence

All new Flutter error and failed-HTTP events carry:

| Field | Meaning |
| --- | --- |
| `deviceId` | Scoped pseudonym, present only when available |
| `deviceIdStatus` | `available` or `unavailable` |
| `deviceIdSource` | `android_id` when known |
| `deviceIdScope` | Scope above when known |
| `deviceIdReason` | Missing/invalid/platform error/timeout/unsupported reason when unavailable |
| `deviceInfo.model`, `deviceInfo.system` | Native or explicitly supplied model and OS; missing values marked unavailable |
| `release`, `sdkVersion` | This event's App and SDK versions; blank release means unavailable |

Collector validates the pseudonym format and consistent status/source/scope. Raw or random-form device IDs and contradictory states are rejected. Existing clients without new identity fields remain accepted. PostgreSQL stores these fields in the existing `events.payload` JSONB, with a project/time lookup index. No historical device identifiers are invented or backfilled.

## Dashboard, aggregation and API

The project detail includes a device panel with independent category buttons, shortcode/model search, paging and per-identity anomaly history. The project's platform/time filters apply; errors and failed requests include manually archived issues. Search by model only finds rows: it never combines them.

- **Stable devices**: distinct full pseudonym + source + scope within the selected project. Count is affected identities, not guaranteed permanent physical-device count.
- **Installation IDs only**: distinct known `anonymousId` values lacking a valid stable identity. Reinstall/backup behavior can change or duplicate these; this count is not a device count. Do not combine these records into stable device history by installation ID.
- **Unidentified records**: missing/sentinel installation and stable identifiers. Count records, not devices; each event remains separate even if models match.

Each row shows anomaly count, first/last client occurrence time, model/OS and the latest reported App version. Metadata follows server receipt order when available; historical receipts remain null and fall back to client occurrence order for display, explicitly labeled receipt unknown. Event history shows each event's own App/SDK version. Pagination totals and category counts cover the selected time/platform range, not only the current page. Counts describe retained events, not a lifetime fleet registry.

Owner-authenticated endpoints:

- `GET /api/devices?appKey=<KEY>&kind=stable&search=HG-...&platform=flutter&start=<MS>&end=<MS>&limit=50&offset=0`
- `GET /api/devices/events?appKey=<KEY>&key=<URL_ENCODED_FULL_GROUP_KEY>&limit=50&offset=0`

Optional filters may be omitted; limit is 1–100. Missing authentication returns 401; another owner's project returns 404. Use the returned full group `key`, never the shortcode, for exact history lookup.

Shortcode is `HG-` plus the first 12 hash hex characters in uppercase. It is display-only and can collide; grouping and lookup always use the full pseudonym/source/scope. Newly generated alert bodies and subjects, Dashboard, AI handoff and App debug page use the same format. Email App version always comes from the triggering event, never the issue's latest version. Queued/historical emails remain unchanged.

## Rollout and acceptance

Deploy Collector before Dashboard and new SDK consumers. Pin the reviewed SDK commit in the consuming App; this source change does not publish npm/pub.dev, deploy services or build/distribute an APK. Keep the existing app key, application ID and signing identity for meaningful lifecycle comparisons.

Automated checks cover synthetic same-model devices, cross-version/reinstall state, unchanged installation/session semantics, unavailable-ID delivery, privacy/validation, owner isolation, PostgreSQL JSONB reload, replay, shortcode consistency and responsive browser operations. Native Java compiles against Android API 35 and Flutter 3.27 embedding; the pure-JDK test checks deterministic hashing and scope isolation. These are not actual Android lifecycle tests.

Target-tablet matrix (2026-10-27):

| Acceptance | Actual target result |
| --- | --- |
| Two same-model physical tablets have distinct IDs | Pending: no tablets connected |
| Restart App and ordinary same-signature update | Pending |
| Clear App data on target Android | Pending; requires disposable/approved App data |
| Uninstall/reinstall same signed APK on target Android | Pending; requires approved uninstall/data loss |
| App, Dashboard and received email shortcode agree | Automated formatting/content tests only; actual delivery/device pending |
| Unavailable ID preserves business/reporting | Automated failure-path tests passed; target-device check pending |

Record tablet model, Android/API, package, signature fingerprint, App version/build, project, shortcode before/after, event IDs and evidence. Do not clear real driver data or uninstall a deployed App without explicit authorization. Real email delivery requires separate observation; rendering a message or SMTP acceptance does not prove inbox receipt.

### Source verification recorded on 2026-10-27

- Main suite: 263 passed; 2 opt-in external PostgreSQL tests skipped. Device store persistence/SQL was exercised with isolated PostgreSQL WASM (PGlite), not a production database.
- Identity/grouping/owner routes: 100% lines, 95.38% branches across the targeted files; routes 100% lines/branches. Type check, lint, production build and sensitive-data scan passed.
- Flutter 3.27 / Dart 3.6: all 40 SDK tests and Dart analysis passed. The pending-identity Dio test confirms the business failure returns before identity lookup completes.
- Android plugin: Java 11 target compiled against Android API 35 and Flutter 3.27 embedding; deterministic hash/scope tests passed. No target APK installation was performed.
- Real Chrome against disposable Collector: same-model synthetic identities, cross-version history, categories, shortcode search/empty state, desktop/390px layout and English passed. Screenshots/logs retained outside source.
- Follow-up publication verified Collector/Dashboard deployment, preserved data/configuration, authenticated live browser flows, public asset hashes and a consuming App artifact/update API. No synthetic events were written to deployed data and no real test email was sent. Target-tablet acceptance and package-registry publication remain pending; the physical matrix above is unchanged.
