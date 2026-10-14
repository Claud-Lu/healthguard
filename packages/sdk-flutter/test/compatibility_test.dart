import 'package:flutter_test/flutter_test.dart';
import 'package:healthguard_flutter/healthguard_flutter.dart';

class TestStorage implements HealthGuardStorage {
  final values = <String, String>{};
  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async {
    values[key] = value;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'handled HTTP failures preserve occurrence, environment and diagnostic evidence',
      () async {
    final events = <dynamic>[];
    final client = HealthGuardClient(
      appKey: 'demo',
      endpoint: 'https://collector.example.com/events',
      release: '2.0.0',
      storage: TestStorage(),
      retryInterval: Duration.zero,
      networkSnapshot: () async => {'online': true},
      transport: (batch) async {
        events.addAll(batch['events']);
      },
    );
    final occurredAt = DateTime.utc(2026, 1, 2);
    await client.captureHttpFailure(
      method: 'GET',
      url: 'https://api.example.com/calls?token=private',
      durationMs: 10000,
      occurredAt: occurredAt,
      eventEnvironment: 'test',
      deviceModel: 'test-pad',
      fingerprint: 'http:timeout',
      errorMessage: 'Failure https://api.example.com/?password=private',
      context: {
        'networkDiagnostics': {
          'schemaVersion': 1,
          'requestId': 'request-1',
          'startedAt': 1,
          'failedAt': 2,
          'inFlightAtStart': 2,
          'networkAtStart': {
            'available': true,
            'connected': true,
            'ssid': 'private'
          },
          'assessment': {
            'category': 'connection_timeout',
            'causeConfirmed': false
          },
          'probes': {
            'cached': true,
            'sampledAt': 1,
            'results': {
              'dns': {'outcome': 'ok'}
            }
          },
          'authorization': 'private',
        },
        'originalError': {
          'dioType': 'connectionTimeout',
          'message': 'timeout',
          'token': 'private'
        },
        'token': 'private',
      },
    );
    final event = events.single as Map;
    expect(event['timestamp'], occurredAt.millisecondsSinceEpoch);
    expect(event['environment'], 'test');
    expect(event['deviceInfo']['model'], 'test-pad');
    expect(event['fingerprint'], 'http:timeout');
    expect(event['context']['networkDiagnostics']['requestId'], 'request-1');
    expect(
        event['context']['networkDiagnostics']['probes']['results']['dns']
            ['outcome'],
        'ok');
    expect(event['context']['originalError']['dioType'], 'connectionTimeout');
    expect(event['url'], 'https://api.example.com/calls');
    expect(event.toString(), isNot(contains('private')));
    client.dispose();
  });

  test(
      'handled native failures retain their diagnostic evidence and device metadata',
      () async {
    final events = <dynamic>[];
    final client = HealthGuardClient(
      appKey: 'demo',
      endpoint: 'https://collector.example.com/events',
      storage: TestStorage(),
      retryInterval: Duration.zero,
      networkSnapshot: () async => {},
      transport: (batch) async {
        events.addAll(batch['events']);
      },
    );
    await client.captureException(
      StateError('handled'),
      deviceModel: 'test-pad',
      deviceSystem: 'test-os',
      context: {
        'operation': 'bind',
        'networkDiagnostics': {
          'requestId': 'request-2',
          'assessment': {'category': 'dns_failure'}
        }
      },
    );
    expect(events.single['deviceInfo'],
        {'model': 'test-pad', 'system': 'test-os'});
    expect(events.single['context']['networkDiagnostics']['requestId'],
        'request-2');
    client.dispose();
  });
  test(
      'explicit scalar context keys preserve business evidence but reject secrets',
      () async {
    final events = <dynamic>[];
    final client = HealthGuardClient(
      appKey: 'demo',
      endpoint: 'https://collector.example.com/events',
      storage: TestStorage(),
      retryInterval: Duration.zero,
      additionalContextKeys: {'resourceId', 'serverCode', 'token', 'payload'},
      networkSnapshot: () async => {},
      transport: (batch) async {
        events.addAll(batch['events']);
      },
    );
    await client.captureException('handled', context: {
      'resourceId': 'resource-1',
      'serverCode': 'BUSY',
      'token': 'private',
      'payload': {'password': 'private'},
    });
    expect(events.single['context'],
        {'resourceId': 'resource-1', 'serverCode': 'BUSY'});
    client.dispose();
  });
}
