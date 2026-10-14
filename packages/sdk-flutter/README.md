# healthguard_flutter

Standalone HealthGuard Flutter SDK with Dio interception, bounded persistent replay and an Android network-state plugin.

See [Network diagnostics](https://github.com/Claud-Lu/healthguard/blob/master/docs/network-diagnostics.md) for initialization, Git dependency setup, privacy boundaries, Android API 21 compatibility and the device acceptance checklist. This source package has not been published to pub.dev.

Applications supply appKey, absolute Collector endpoint, release and environment. Initialize once, attach `client.interceptor()` to the business Dio instance, retain handled exceptions via `captureException`, and dispose with the application lifecycle. Other platforms receive explicit unavailable native network evidence.
