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
