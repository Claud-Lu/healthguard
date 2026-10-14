import 'package:flutter_test/flutter_test.dart';
import 'dart:typed_data';
import 'package:dio/dio.dart';
import 'package:healthguard_flutter/healthguard_flutter.dart';

class MemoryStorage implements HealthGuardStorage {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }
}

class FailingAdapter implements HttpClientAdapter {
  @override
  Future<ResponseBody> fetch(RequestOptions options,
      Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    throw DioException(
        requestOptions: options, type: DioExceptionType.receiveTimeout);
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test('handled Flutter exceptions remain native error events with preserved context', () async {
    final received = <Map<String, dynamic>>[];
    final client = HealthGuardClient(appKey: 'demo', endpoint: 'https://collector.example.com/events', storage: MemoryStorage(), retryInterval: Duration.zero,
      transport: (batch) async { received.add(batch); }, networkSnapshot: () async => {});
    await client.initialize();
    await client.captureException(StateError('Speech initialization failed'), context: {'operation': 'speech_init', 'token': 'private'});
    final event = (received.single['events'] as List).single;
    expect(event['type'], 'error');
    expect(event['errorType'], 'native');
    expect(event['message'], contains('Speech initialization failed'));
    expect(event['context'], {'operation': 'speech_init'});
    client.dispose();
  });

  test(
      'failure reports are private, bounded and persist original identity on retry',
      () async {
    final storage = MemoryStorage();
    final received = <Map<String, dynamic>>[];
    var fail = true;
    Future<void> transport(Map<String, dynamic> batch) async {
      if (fail) throw StateError('offline');
      received.add(batch);
    }

    HealthGuardClient create() => HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        release: '1.2.3',
        storage: storage,
        transport: transport,
        retryInterval: Duration.zero,
        networkSnapshot: () async => {
              'online': false,
              'transport': 'none',
              'ssid': 'private',
              'ip': 'private'
            });
    final first = create();
    await first.initialize();
    await first.captureHttpFailure(
        method: 'POST',
        url: 'https://user:pass@api.example.com/v1?token=private',
        durationMs: 12,
        errorMessage: 'private',
        failureKind: 'timeout');
    expect(first.pendingCount, 1);
    first.dispose();
    fail = false;
    final second = create();
    await second.initialize();
    await second.flushPending();
    final event = (received.single['events'] as List).single as Map;
    expect(event['release'], '1.2.3');
    expect(event['networkDiagnostic']['category'], 'offline');
    expect(event.toString(), isNot(contains('private')));
    expect(second.pendingCount, 0);
    second.dispose();
  });
  test(
      'Dio errors retain cancellation and timeout categories without blocking request flow',
      () async {
    final received = <Map<String, dynamic>>[];
    final client = HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        storage: MemoryStorage(),
        retryInterval: Duration.zero,
        cooldown: Duration.zero,
        transport: (batch) async {
          received.add(batch);
        },
        networkSnapshot: () async => {'online': true});
    await client.initialize();
    final dio = Dio()..httpClientAdapter = FailingAdapter();
    dio.interceptors.add(client.interceptor());
    await expectLater(
        dio.get('https://api.example.com/v1'), throwsA(isA<DioException>()));
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await client.flushPending();
    expect(
        (received.single['events'] as List).single['networkDiagnostic']
            ['category'],
        'timeout');
    client.dispose();
  });
  test(
      'unavailable native APIs do not make monitoring throw and queue is bounded',
      () async {
    final client = HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        storage: MemoryStorage(),
        retryInterval: Duration.zero,
        maxPendingEvents: 2,
        cooldown: Duration.zero,
        transport: (_) async => throw StateError('offline'),
        networkSnapshot: () async => throw StateError('unsupported'));
    await client.initialize();
    for (var i = 0; i < 3; i++) {
      await client.captureHttpFailure(
          method: 'GET', url: 'https://api.example.com/v1', durationMs: 1);
    }
    expect(client.pendingCount, 2);
    client.dispose();
  });
}
