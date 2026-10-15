import 'dart:async';
import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:healthguard_flutter/healthguard_flutter.dart';

class DelayedClient extends Fake implements HttpClient {
  DelayedClient(this.gate);
  final Completer<void> gate;
  final inner = HttpClient();
  @override
  Duration idleTimeout = const Duration(seconds: 15);
  @override
  Duration? connectionTimeout;
  @override
  Future<HttpClientRequest> openUrl(String method, Uri url) async {
    await gate.future;
    return inner.openUrl(method, url);
  }

  @override
  void close({bool force = false}) => inner.close(force: force);
}

class RecordingClient extends Fake implements HttpClient {
  final calls = <String>[];
  @override
  Duration idleTimeout = const Duration(seconds: 15);
  @override
  Duration? connectionTimeout;
  @override
  int? maxConnectionsPerHost;
  @override
  bool autoUncompress = true;
  @override
  String? userAgent;
  @override
  dynamic noSuchMethod(Invocation invocation) {
    final name = invocation.memberName.toString();
    calls.add(name);
    if (['open', 'get', 'post', 'put', 'delete', 'patch', 'head'].any(
        (method) =>
            name == 'Symbol("$method")' || name == 'Symbol("${method}Url")')) {
      return Future<HttpClientRequest>.value(FakeRequest());
    }
    return null;
  }
}

class FakeRequest extends Fake implements HttpClientRequest {}

void main() {
  test(
      'IO observation preserves custom HttpClient configuration and forwarding',
      () async {
    final inner = RecordingClient();
    final adapter =
        HealthGuardIoHttpClientAdapter(createHttpClient: () => inner);
    final client = adapter.createHttpClient!();
    client.idleTimeout = const Duration(seconds: 6);
    client.connectionTimeout = const Duration(seconds: 3);
    client.maxConnectionsPerHost = 2;
    client.autoUncompress = false;
    client.userAgent = 'test';
    expect(client.idleTimeout, inner.idleTimeout);
    expect(client.connectionTimeout, inner.connectionTimeout);
    expect(client.maxConnectionsPerHost, 2);
    expect(client.autoUncompress, false);
    expect(client.userAgent, 'test');
    final url = Uri.parse('https://api.example.com/calls');
    await client.open('GET', url.host, 443, '/calls');
    await client.openUrl('GET', url);
    await client.get(url.host, 443, '/calls');
    await client.getUrl(url);
    await client.post(url.host, 443, '/calls');
    await client.postUrl(url);
    await client.put(url.host, 443, '/calls');
    await client.putUrl(url);
    await client.delete(url.host, 443, '/calls');
    await client.deleteUrl(url);
    await client.patch(url.host, 443, '/calls');
    await client.patchUrl(url);
    await client.head(url.host, 443, '/calls');
    await client.headUrl(url);
    client.authenticate = (_, __, ___) async => false;
    client.authenticateProxy = (_, __, ___, ____) async => false;
    client.connectionFactory = null;
    client.findProxy = (_) => 'DIRECT';
    client.badCertificateCallback = null;
    client.keyLog = null;
    client.addCredentials(
        url, 'test', HttpClientBasicCredentials('demo', 'test'));
    client.addProxyCredentials(
        url.host, 443, 'test', HttpClientBasicCredentials('demo', 'test'));
    client.close(force: true);
    expect(inner.calls, hasLength(23));
  });

  test(
      'concurrent real requests retain their own acquisition and response evidence',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      if (request.uri.path == '/slow') {
        await Future<void>.delayed(const Duration(milliseconds: 180));
      }
      request.response.write('ok');
      await request.response.close();
    });
    final dio = Dio()..httpClientAdapter = HealthGuardIoHttpClientAdapter();
    final base = 'http://127.0.0.1:${server.port}';
    try {
      final slow = dio
          .get('$base/slow?token=private',
              options: Options(
                  headers: {'X-Request-ID': 'slow-id'},
                  receiveTimeout: const Duration(milliseconds: 60)))
          .then<Object>((v) => v, onError: (Object e) => e);
      final fast = await dio.get('$base/fast',
          options: Options(headers: {'X-Request-ID': 'fast-id'}));
      final error = await slow as DioException;
      expect(error.type, DioExceptionType.receiveTimeout);
      final a = error.requestOptions.extra['healthguardRequestTrace'] as Map;
      final b = fast.requestOptions.extra['healthguardRequestTrace'] as Map;
      expect(a['requestId'], 'slow-id');
      expect(b['requestId'], 'fast-id');
      expect(a['connectionAcquisition']['outcome'], 'ready');
      expect(a['responseHeaders']['outcome'], 'receiveTimeout');
      expect(b['responseHeaders']['outcome'], 'received');
      expect(a['source'], 'original_request');
      expect(a['dns']['availability'], 'unavailable');
      expect(a.toString(), isNot(contains('private')));
    } finally {
      dio.close(force: true);
      await server.close(force: true);
    }
  });
  test('a timed-out acquisition is frozen and a late connection is aborted',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var requests = 0;
    server.listen((r) {
      requests++;
      r.response.close();
    });
    final gate = Completer<void>();
    final dio = Dio()
      ..httpClientAdapter = HealthGuardIoHttpClientAdapter(
          createHttpClient: () => DelayedClient(gate));
    try {
      Object? failure;
      try {
        await dio.get('http://127.0.0.1:${server.port}/calls',
            options: Options(connectTimeout: const Duration(milliseconds: 20)));
      } catch (e) {
        failure = e;
      }
      expect(failure, isA<DioException>());
      final error = failure as DioException;
      expect(error.type, DioExceptionType.connectionTimeout);
      final trace =
          error.requestOptions.extra['healthguardRequestTrace'] as Map;
      expect(trace['connectionAcquisition']['outcome'], 'connectionTimeout');
      final before = trace.toString();
      gate.complete();
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(error.requestOptions.extra['healthguardRequestTrace'].toString(),
          before);
      expect(requests, 0);
    } finally {
      dio.close(force: true);
      await server.close(force: true);
    }
  });
  test(
      'cancelled acquisition freezes evidence and uses the actual request ID header',
      () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var requests = 0;
    server.listen((r) {
      requests++;
      r.response.close();
    });
    final gate = Completer<void>();
    final cancel = CancelToken();
    final dio = Dio()
      ..httpClientAdapter = HealthGuardIoHttpClientAdapter(
          createHttpClient: () => DelayedClient(gate));
    try {
      final future = dio
          .get('http://127.0.0.1:${server.port}/calls',
              cancelToken: cancel,
              options: Options(headers: {'x-request-id': 'invalid/id'}))
          .then<Object>((v) => v, onError: (Object e) => e);
      await Future<void>.delayed(const Duration(milliseconds: 20));
      cancel.cancel('leaving page');
      final error = await future as DioException;
      expect(error.type, DioExceptionType.cancel);
      final trace =
          error.requestOptions.extra[healthGuardRequestTraceKey] as Map;
      expect(trace['connectionAcquisition']['outcome'], 'cancelled');
      expect(trace['requestId'], error.requestOptions.headers['x-request-id']);
      final before = trace.toString();
      gate.complete();
      await Future<void>.delayed(const Duration(milliseconds: 50));
      expect(error.requestOptions.extra[healthGuardRequestTraceKey].toString(),
          before);
      expect(requests, 0);
    } finally {
      dio.close(force: true);
      await server.close(force: true);
    }
  });
}
