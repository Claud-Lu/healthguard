import 'dart:async';
import 'dart:io';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:dio/io.dart';

final _traceZoneKey = Object();
int _sequence = 0;
const healthGuardRequestTraceKey = 'healthguardRequestTrace';

/// Observes the ORIGINAL HttpClient.openUrl promise. Does not replace DNS,
/// sockets, certificate verification, proxies or connection pooling.
/// DNS/TCP/TLS remain explicitly unavailable, never inferred from a probe.
class HealthGuardIoHttpClientAdapter extends IOHttpClientAdapter {
  HealthGuardIoHttpClientAdapter({
    HttpClient Function()? createHttpClient,
    super.validateCertificate,
  }) : super(
          createHttpClient: () =>
              _ObservedHttpClient(createHttpClient?.call() ?? HttpClient()),
        );

  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final trace = _RequestTrace(options);
    void publish() =>
        options.extra[healthGuardRequestTraceKey] = trace.snapshot();
    publish();
    cancelFuture?.then((_) {
      trace.finish('cancelled');
      publish();
    }, onError: (Object _) {});
    try {
      final response = await runZoned(
          () => super.fetch(options, requestStream, cancelFuture),
          zoneValues: {_traceZoneKey: trace});
      trace.finish('received');
      return response;
    } on DioException catch (error) {
      trace.finish(error.type.name);
      rethrow;
    } catch (_) {
      trace.finish('failed');
      rethrow;
    } finally {
      publish();
    }
  }
}

class _RequestTrace {
  _RequestTrace(RequestOptions options) {
    final header = options.headers.entries
        .where((e) => e.key.toLowerCase() == 'x-request-id')
        .firstOrNull;
    final existing = header?.value;
    requestId = existing is String &&
            RegExp(r'^[A-Za-z0-9._:-]{1,128}$').hasMatch(existing)
        ? existing
        : 'hg-io-${DateTime.now().microsecondsSinceEpoch.toRadixString(36)}-${++_sequence}';
    options.headers[header?.key ?? 'X-Request-ID'] = requestId;
    for (final entry in {
      'connectMs': options.connectTimeout,
      'sendMs': options.sendTimeout,
      'receiveMs': options.receiveTimeout
    }.entries) {
      if (entry.value != null) {
        timeouts[entry.key] = entry.value!.inMilliseconds;
      }
    }
  }
  late final String requestId;
  final int startedAt = DateTime.now().millisecondsSinceEpoch;
  final Stopwatch clock = Stopwatch()..start();
  final timeouts = <String, int>{};
  int? openStarted, acquiredAt;
  bool sealed = false;
  String outcome = 'pending';
  int elapsed = 0;
  void finish(String value) {
    if (sealed) return;
    outcome = value;
    elapsed = clock.elapsedMilliseconds;
    sealed = true;
  }

  Map<String, dynamic> snapshot() => {
        'schemaVersion': 1,
        'source': 'original_request',
        'requestId': requestId,
        'startedAt': startedAt,
        'timeouts': Map<String, int>.from(timeouts),
        'connectionAcquisition': {
          'outcome': acquiredAt != null
              ? 'ready'
              : (openStarted == null ? 'unavailable' : outcome),
          if (openStarted != null)
            'durationMs':
                (acquiredAt ?? (sealed ? elapsed : clock.elapsedMilliseconds)) -
                    openStarted!,
        },
        'responseHeaders': {
          'outcome': acquiredAt == null ? 'unavailable' : outcome,
          if (acquiredAt != null)
            'durationMs':
                (sealed ? elapsed : clock.elapsedMilliseconds) - acquiredAt!,
        },
        'dns': {'availability': 'unavailable'},
        'tcp': {'availability': 'unavailable'},
        'tls': {'availability': 'unavailable'},
      };
}

class _ObservedHttpClient implements HttpClient {
  _ObservedHttpClient(this.inner);
  final HttpClient inner;
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    final trace = Zone.current[_traceZoneKey] as _RequestTrace?;
    if (trace != null) trace.openStarted = trace.clock.elapsedMilliseconds;
    final request = await inner.openUrl(method, url);
    if (trace != null) {
      // Dio's timeout can finish before openUrl resolves. Abort that abandoned
      // acquisition; never rewrite the already published failure snapshot.
      if (trace.sealed && trace.acquiredAt == null) {
        request.abort();
      } else if (!trace.sealed) {
        trace.acquiredAt = trace.clock.elapsedMilliseconds;
      }
    }
    return request;
  }

  @override
  Duration get idleTimeout => inner.idleTimeout;
  @override
  set idleTimeout(Duration value) => inner.idleTimeout = value;
  @override
  Duration? get connectionTimeout => inner.connectionTimeout;
  @override
  set connectionTimeout(Duration? value) => inner.connectionTimeout = value;
  @override
  int? get maxConnectionsPerHost => inner.maxConnectionsPerHost;
  @override
  set maxConnectionsPerHost(int? value) => inner.maxConnectionsPerHost = value;
  @override
  bool get autoUncompress => inner.autoUncompress;
  @override
  set autoUncompress(bool value) => inner.autoUncompress = value;
  @override
  String? get userAgent => inner.userAgent;
  @override
  set userAgent(String? value) => inner.userAgent = value;
  @override
  Future<HttpClientRequest> open(
          String method, String host, int port, String path) =>
      inner.open(method, host, port, path);
  @override
  Future<HttpClientRequest> get(String host, int port, String path) =>
      inner.get(host, port, path);
  @override
  Future<HttpClientRequest> getUrl(Uri url) => inner.getUrl(url);
  @override
  Future<HttpClientRequest> post(String host, int port, String path) =>
      inner.post(host, port, path);
  @override
  Future<HttpClientRequest> postUrl(Uri url) => inner.postUrl(url);
  @override
  Future<HttpClientRequest> put(String host, int port, String path) =>
      inner.put(host, port, path);
  @override
  Future<HttpClientRequest> putUrl(Uri url) => inner.putUrl(url);
  @override
  Future<HttpClientRequest> delete(String host, int port, String path) =>
      inner.delete(host, port, path);
  @override
  Future<HttpClientRequest> deleteUrl(Uri url) => inner.deleteUrl(url);
  @override
  Future<HttpClientRequest> patch(String host, int port, String path) =>
      inner.patch(host, port, path);
  @override
  Future<HttpClientRequest> patchUrl(Uri url) => inner.patchUrl(url);
  @override
  Future<HttpClientRequest> head(String host, int port, String path) =>
      inner.head(host, port, path);
  @override
  Future<HttpClientRequest> headUrl(Uri url) => inner.headUrl(url);
  @override
  set authenticate(Future<bool> Function(Uri, String, String?)? value) =>
      inner.authenticate = value;
  @override
  void addCredentials(
          Uri url, String realm, HttpClientCredentials credentials) =>
      inner.addCredentials(url, realm, credentials);
  @override
  set connectionFactory(
          Future<ConnectionTask<Socket>> Function(Uri, String?, int?)? value) =>
      inner.connectionFactory = value;
  @override
  set findProxy(String Function(Uri)? value) => inner.findProxy = value;
  @override
  set authenticateProxy(
          Future<bool> Function(String, int, String, String?)? value) =>
      inner.authenticateProxy = value;
  @override
  void addProxyCredentials(String host, int port, String realm,
          HttpClientCredentials credentials) =>
      inner.addProxyCredentials(host, port, realm, credentials);
  @override
  set badCertificateCallback(
          bool Function(X509Certificate, String, int)? value) =>
      inner.badCertificateCallback = value;
  @override
  set keyLog(Function(String)? value) => inner.keyLog = value;
  @override
  void close({bool force = false}) => inner.close(force: force);
}
