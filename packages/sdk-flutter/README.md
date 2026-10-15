# healthguard_flutter

Standalone HealthGuard Flutter SDK with Dio interception, bounded replay and shared detailed Android network diagnostics.

See [Network diagnostics](https://github.com/Claud-Lu/healthguard/blob/master/docs/network-diagnostics.md) for initialization, Git dependency setup, privacy boundaries, Android API 21 compatibility and the device acceptance checklist. This source package has not been published to pub.dev.

Applications supply appKey, absolute Collector endpoint, release and environment. Initialize once, attach `client.interceptor()` to the business Dio instance, retain handled exceptions via `captureException`, and dispose with the application lifecycle. Other platforms receive explicit unavailable native network evidence.


## Flutter migration compatibility (source 0.2.1)

For manual HTTP reports, captureHttpFailure accepts occurredAt, eventEnvironment, deviceModel, deviceSystem and fingerprint. Diagnostic context retains bounded allowlisted networkDiagnostics and originalError fields; passive snapshot sampledAt records collection time separately from the original failure time.

Applications may configure additionalContextKeys for explicitly approved scalar business evidence. Credential keys and nested business payloads are excluded even when requested. Select a single manual or automatic HTTP reporting path to prevent duplicate alerts.

Existing application queues and installation IDs can be migrated through HealthGuardStorage. Persist the new queue before clearing old storage and retain original event IDs, timestamps and releases. A custom transport must throw unless the collector acknowledges the full batch.

The package is source-only, not published to pub.dev. Pin reviewed commit 792e323348083657ae519cabac104479314d9cfd. Registry publication, server deployment and device acceptance are separate steps.


## Detailed Flutter diagnostics (source 0.2.1)

NetworkDiagnostics now lives in the SDK. It provides beginRequest, endRequest,
collect and dispose; applications supply allowedHosts and healthPath and connect
these hooks to their single existing HTTP reporting path. Retain business
configuration, handled-error reporting and legacy-storage migration adapters;
remove duplicated native observers and application probe implementations only
after migrating all call sites.

The Android client and detailed event stream share one reference-counted observer.
Network evidence includes request IDs, start/failure snapshots, observed changes,
in-flight counts, last successful response and original Dio/OS errors. It does
not confirm which peer caused a failure. Non-Android native evidence remains
explicitly unavailable.

Active probes require a non-empty HTTPS/443 host allowlist. healthPath must be a
relative absolute path without authority, scheme, query or fragment. Each stage
and the whole group have bounded timeouts; per-host single-flight and a 60-second
cache bound probe traffic. Probe results are collected after failure and retain
their actual sampling time. They are separate requests and never reproduce the
original business connection. No authentication, business queries, redirects or
TLS bypass are used. Manual and interceptor cancellation creates no alert.

## Original-request IO evidence (source 0.2.1)

```dart
// Configure once before issuing requests. Keep custom TLS/proxy configuration
// in createHttpClient and existing leaf validation in validateCertificate.
dio.httpClientAdapter = HealthGuardIoHttpClientAdapter();
dio.interceptors.add(healthGuard.interceptor()); // one automatic reporting path
```

This optional native IO adapter observes the original HttpClient.openUrl promise
and the wait for response headers, without replacing sockets, DNS, proxies,
certificate validation or pooling. Valid X-Request-ID headers are reused; otherwise
a bounded ID is generated and sent. Source is original_request. Per-request
observations are isolated with zones and frozen at timeout/cancellation; late
connections are aborted. Headers received is not proof that the body completed.

For an existing manual reporting path, pass
`context: {'originalError': NetworkDiagnostics.errorDetails(error),
'requestTrace': error.requestOptions.extra[healthGuardRequestTraceKey]}` to
captureHttpFailure. Do not attach another HTTP-reporting interceptor. Keep a custom
adapter if required by your application; unobserved acquisition stays unavailable.

Connection acquisition includes possible connection-pool wait, DNS, TCP, TLS and
proxy work. Individual original DNS/TCP/TLS timings remain unavailable. Independent
post-failure probes never fill those timings or prove the original path healthy.
No request headers, body, IP addresses or URL query are stored in requestTrace.
