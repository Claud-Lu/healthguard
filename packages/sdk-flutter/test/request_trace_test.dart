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
void main() {
  test('concurrent real requests retain their own acquisition and response evidence', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    server.listen((request) async {
      if (request.uri.path == '/slow') await Future<void>.delayed(const Duration(milliseconds: 180));
      request.response.write('ok');
      await request.response.close();
    });
    final dio = Dio()..httpClientAdapter = HealthGuardIoHttpClientAdapter();
    final base = 'http://127.0.0.1:${server.port}';
    try {
      final slow = dio.get('$base/slow?token=private', options: Options(headers: {'X-Request-ID': 'slow-id'}, receiveTimeout: const Duration(milliseconds: 60))).then<Object>((v) => v, onError: (Object e) => e);
      final fast = await dio.get('$base/fast', options: Options(headers: {'X-Request-ID': 'fast-id'}));
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
    } finally { dio.close(force: true); await server.close(force: true); }
  });
  test('a timed-out acquisition is frozen and a late connection is aborted', () async {
    final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
    var requests = 0;
    server.listen((r) { requests++; r.response.close(); });
    final gate = Completer<void>();
    final dio = Dio()..httpClientAdapter = HealthGuardIoHttpClientAdapter(createHttpClient: () => DelayedClient(gate));
    try {
      Object? failure;
      try { await dio.get('http://127.0.0.1:${server.port}/calls', options: Options(connectTimeout: const Duration(milliseconds: 20))); } catch (e) { failure = e; }
      expect(failure, isA<DioException>());
      final error = failure as DioException;
      expect(error.type, DioExceptionType.connectionTimeout);
      final trace = error.requestOptions.extra['healthguardRequestTrace'] as Map;
      expect(trace['connectionAcquisition']['outcome'], 'connectionTimeout');
      final before = trace.toString();
      gate.complete();
      await Future<void>.delayed(const Duration(milliseconds: 80));
      expect(error.requestOptions.extra['healthguardRequestTrace'].toString(), before);
      expect(requests, 0);
    } finally { dio.close(force: true); await server.close(force: true); }
  });
}
