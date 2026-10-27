## 0.3.0 (source, Unreleased)

- Android ID is pseudonymized natively with SHA-256 and app/project scope; installation and session identities remain separate.
- Both native errors and HTTP failures automatically carry identity status/source/scope, model/OS, App and SDK release. Unavailable IDs never use random substitutes or stop reporting.
- Expose `deviceIdentity`, `deviceShortCode` and `HealthGuardDeviceDebugPage`; preserve original queued event identity/version.
- Android 5 compatibility remains; older Android/OEM behavior requires real-device validation. No pub.dev publication or target-device lifecycle acceptance is implied.

## 0.2.1 (unreleased source)

- Optional IO adapter observes original connection acquisition and response-header wait per request, preserves transport configuration and aborts late abandoned acquisitions.
- Retains original Dio error types and allowlisted requestTrace evidence; does not infer original DNS/TCP/TLS timing from probes.
- 34 Flutter tests and Dart analysis pass; IO trace line coverage 99.3%. Registry publication, server deployment and device acceptance are separate.

## 0.1.0 (source release preparation)

- Standalone HealthGuard client with Dio request-failure interception and native exception capture.
- Bounded persistent queue, stable original event identity and explicit collector acknowledgement.
- Android API 21 network-state plugin, with default-network validation/VPN fields when supported and bounded recent connectivity changes.
- Diagnostic privacy allowlist, conservative failure categories and explicit unavailable data.
- Source is prepared; registry publication and real-device acceptance require separate verification.
