import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:healthguard_flutter/healthguard_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  var now = DateTime.utc(2026, 10, 14, 3);
  late NetworkDiagnostics diagnostics;
  var probeCount = 0;
  var network = <String, dynamic>{};
  setUp(() {
    now = DateTime.utc(2026, 10, 14, 3);
    probeCount = 0;
    network = {
      'available': true,
      'connected': true,
      'transport': 'wifi',
      'revision': 1,
      'observedAt': now.millisecondsSinceEpoch
    };
    diagnostics = NetworkDiagnostics(
      allowedHosts: const {'api.example.com'},
      healthPath: '/healthz',
      clock: () => now,
      snapshotProvider: () async => network,
      probe: (uri) async {
        probeCount++;
        return {
          'dns': {'outcome': 'ok'},
          'tcp': {'outcome': 'ok'},
          'tls': {'outcome': 'ok'},
          'health': {'outcome': 'ok', 'status': 200}
        };
      },
    );
  });
  tearDown(() => diagnostics.dispose());

  DioException failure(
          {DioExceptionType type = DioExceptionType.connectionError,
          Object? error,
          String? message,
          String host = 'api.example.com'}) =>
      DioException(
          requestOptions: RequestOptions(
              baseUrl: 'https://$host',
              path: '/v1/calls',
              queryParameters: {'token': 'secret'},
              headers: {'Authorization': 'secret'}),
          type: type,
          error: error,
          message: message);

  test('records a network transition during a request, without asserting cause',
      () async {
    await diagnostics.initialize();
    final trace = diagnostics.beginRequest();
    now = now.add(const Duration(seconds: 1));
    diagnostics.recordSnapshot({
      'available': true,
      'connected': false,
      'transport': 'none',
      'revision': 2,
      'observedAt': now.millisecondsSinceEpoch
    });
    now = now.add(const Duration(seconds: 1));
    network = {
      'available': true,
      'connected': true,
      'transport': 'mobile',
      'revision': 3,
      'observedAt': now.millisecondsSinceEpoch
    };
    diagnostics.recordSnapshot(network);
    final report = await diagnostics.collect(failure(), trace);
    expect(report['networkChangedDuringRequest'], true);
    expect(report['assessment']['causeConfirmed'], false);
    expect(report['networkAtStart']['transport'], 'wifi');
    expect(report['networkAtFailure']['transport'], 'mobile');
    expect(report['changesDuringRequest'], hasLength(2));
  });

  test('preserves DNS failure even when the later probe succeeds', () async {
    await diagnostics.initialize();
    final report = await diagnostics.collect(
        failure(
            error: const SocketException('Failed host lookup: api.example.com',
                osError: OSError('Name or service not known', 7))),
        diagnostics.beginRequest());
    expect(report['assessment']['category'], 'dns_failure');
    expect(report['originalError']['osErrorCode'], 7);
    expect(report['probes']['results']['dns']['outcome'], 'ok');
    expect(report['probes']['timing'], 'after_failure');
    expect(report.toString(), isNot(contains('secret')));
  });

  test('no active network is observed but not claimed as the only cause',
      () async {
    network = {
      'available': true,
      'connected': false,
      'transport': 'none',
      'revision': 2
    };
    await diagnostics.initialize();
    final report =
        await diagnostics.collect(failure(), diagnostics.beginRequest());
    expect(report['assessment']['category'], 'network_unavailable');
    expect(report['assessment']['causeConfirmed'], false);
    expect(probeCount, 0);
  });

  test('failed native telemetry remains unknown, not offline', () async {
    diagnostics.dispose();
    diagnostics = NetworkDiagnostics(
        allowedHosts: const {'api.example.com'},
        healthPath: '/healthz',
        snapshotProvider: () async => throw StateError('unavailable'),
        clock: () => now,
        probe: (_) async => {
              'dns': {'outcome': 'ok'}
            });
    await diagnostics.initialize();
    final report = await diagnostics.collect(
        failure(type: DioExceptionType.receiveTimeout),
        diagnostics.beginRequest());
    expect(report['networkAtFailure']['available'], false);
    expect(report['assessment']['category'], 'response_timeout');
  });

  test('connection abort never guesses whether proxy or server terminated it',
      () async {
    await diagnostics.initialize();
    final report = await diagnostics.collect(
        failure(
            type: DioExceptionType.unknown,
            error: HttpException('Software caused connection abort',
                uri: Uri.parse('https://api.example.com/?token=secret'))),
        diagnostics.beginRequest());
    expect(report['assessment']['category'], 'connection_aborted');
    expect(report['assessment']['causeConfirmed'], false);
    expect(report.toString(), isNot(contains('secret')));
  });

  test('concurrent failures share probes and rate limit later failures',
      () async {
    await diagnostics.initialize();
    final reports = await Future.wait(List.generate(
        5, (_) => diagnostics.collect(failure(), diagnostics.beginRequest())));
    expect(probeCount, 1);
    expect(reports.every((r) => r['probes']['sampledAt'] != null), true);
    now = now.add(const Duration(seconds: 30));
    final cached =
        await diagnostics.collect(failure(), diagnostics.beginRequest());
    expect(probeCount, 1);
    expect(cached['probes']['cached'], true);
    now = now.add(const Duration(seconds: 31));
    await diagnostics.collect(failure(), diagnostics.beginRequest());
    expect(probeCount, 2);
  });

  test('only configured HTTPS API hosts may be probed', () async {
    await diagnostics.initialize();
    final report = await diagnostics.collect(
        failure(host: '127.0.0.1'), diagnostics.beginRequest());
    expect(probeCount, 0);
    expect(report['probes']['skipped'], 'host_not_allowed');
  });

  test('business HTTP errors do not trigger diagnostic network traffic',
      () async {
    await diagnostics.initialize();
    final options = failure().requestOptions;
    final report = await diagnostics.collect(
        DioException(
            requestOptions: options,
            type: DioExceptionType.badResponse,
            response: Response(requestOptions: options, statusCode: 503)),
        diagnostics.beginRequest());
    expect(report['assessment']['category'], 'http_response');
    expect(report['originalError']['status'], 503);
    expect(probeCount, 0);
  });

  test('probe exceptions cannot replace original failure', () async {
    diagnostics.dispose();
    diagnostics = NetworkDiagnostics(
        allowedHosts: const {'api.example.com'},
        healthPath: '/healthz',
        snapshotProvider: () async => network,
        clock: () => now,
        probe: (_) async => throw StateError('probe failed'));
    await diagnostics.initialize();
    final report = await diagnostics.collect(
        failure(type: DioExceptionType.receiveTimeout),
        diagnostics.beginRequest());
    expect(report['assessment']['category'], 'response_timeout');
    expect(report['probes']['results']['outcome'], 'failed');
  });

  test('network changes after failure are excluded from the request interval',
      () async {
    await diagnostics.initialize();
    final trace = diagnostics.beginRequest();
    final failedAt = now;
    now = now.add(const Duration(seconds: 2));
    network = {
      'available': true,
      'connected': true,
      'transport': 'mobile',
      'revision': 2,
      'observedAt': now.millisecondsSinceEpoch
    };
    final report =
        await diagnostics.collect(failure(), trace, failedAt: failedAt);
    expect(report['networkChangedDuringRequest'], false);
    expect(report['networkAtFailure']['transport'], 'wifi');
  });
  test(
      'native loss callbacks remain visible even when topology snapshots match',
      () async {
    await diagnostics.initialize();
    final trace = diagnostics.beginRequest();
    now = now.add(const Duration(seconds: 1));
    diagnostics.recordSnapshot({
      ...network,
      'eventAt': now.millisecondsSinceEpoch,
      'reason': 'network_lost',
      'eventScope': 'default_network'
    });
    final report = await diagnostics.collect(failure(), trace);
    expect(report['networkChangedDuringRequest'], false);
    expect(
        report['platformEventsDuringRequest'].single['reason'], 'network_lost');
    expect(report['assessment']['causeConfirmed'], false);
  });

  testWidgets('a hanging probe has a bounded timeout', (tester) async {
    diagnostics.dispose();
    diagnostics = NetworkDiagnostics(
        allowedHosts: const {'api.example.com'},
        healthPath: '/healthz',
        snapshotProvider: () async => network,
        clock: () => now,
        probe: (_) => Completer<Map<String, dynamic>>().future);
    await diagnostics.initialize();
    final reportFuture =
        diagnostics.collect(failure(), diagnostics.beginRequest());
    await tester.pump();
    await tester.pump(const Duration(seconds: 13));
    final report = await reportFuture;
    expect(report['probes']['results']['outcome'], 'failed');
    expect(report['originalError']['dioType'], 'connectionError');
  });
}
