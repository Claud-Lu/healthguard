# healthguard_flutter

Standalone HealthGuard Flutter SDK with Dio interception, bounded persistent replay and an Android network-state plugin.

See [Network diagnostics](https://github.com/Claud-Lu/healthguard/blob/master/docs/network-diagnostics.md) for initialization, Git dependency setup, privacy boundaries, Android API 21 compatibility and the device acceptance checklist. This source package has not been published to pub.dev.

Applications supply appKey, absolute Collector endpoint, release and environment. Initialize once, attach `client.interceptor()` to the business Dio instance, retain handled exceptions via `captureException`, and dispose with the application lifecycle. Other platforms receive explicit unavailable native network evidence.


## Flutter migration compatibility (source 0.1.1)

For manual HTTP reports, captureHttpFailure accepts occurredAt, eventEnvironment, deviceModel, deviceSystem and fingerprint. Diagnostic context retains bounded allowlisted networkDiagnostics and originalError fields; passive snapshot sampledAt records collection time separately from the original failure time.

Applications may configure additionalContextKeys for explicitly approved scalar business evidence. Credential keys and nested business payloads are excluded even when requested. Select a single manual or automatic HTTP reporting path to prevent duplicate alerts.

Existing application queues and installation IDs can be migrated through HealthGuardStorage. Persist the new queue before clearing old storage and retain original event IDs, timestamps and releases. A custom transport must throw unless the collector acknowledges the full batch.

The package is source-only, not published to pub.dev. Pin reviewed commit 1e95665f978f4347120c969a9771bbc64531cdca. Registry publication, server deployment and device acceptance are separate steps.
