import 'dart:async';
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:healthguard_flutter/healthguard_flutter.dart';
import 'client_test.dart' show MemoryStorage, FailingAdapter;
import 'package:dio/dio.dart';

Map<String, dynamic> identity(String char) => {
      'deviceId': 'hgd1_${List.filled(64, char).join()}',
      'deviceIdStatus': 'available',
      'deviceIdSource': 'android_id',
      'deviceIdScope': 'android_user_signing_key_app',
      'model': 'Same tablet',
      'system': 'Android 12 (API 31)',
      'appVersion': '1.0.1',
    };
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  test(
      'one identity enriches errors and failed requests; upgrades and installation resets preserve scoped identity',
      () async {
    final received = <Map<String, dynamic>>[];
    HealthGuardClient create(
            MemoryStorage storage, String release, String device) =>
        HealthGuardClient(
            appKey: 'demo',
            endpoint: 'https://collector.example.com/events',
            release: release,
            storage: storage,
            retryInterval: Duration.zero,
            networkSnapshot: () async => {},
            deviceSnapshot: () async => identity(device),
            transport: (batch) async => received.addAll(
                (batch['events'] as List).cast<Map<String, dynamic>>()));
    final storage = MemoryStorage();
    final first = create(storage, '1.0.1', 'a');
    await first.captureException(StateError('first'));
    await first.captureHttpFailure(
        method: 'GET', url: 'https://api.example.com/failure', durationMs: 3);
    final restart = create(storage, '1.0.2', 'a');
    await restart.captureException(StateError('upgrade'));
    final reinstalled = create(MemoryStorage(), '1.0.2', 'a');
    await reinstalled.captureException(StateError('new installation'));
    final other = create(MemoryStorage(), '1.0.2', 'b');
    await other.captureException(StateError('other tablet'));
    expect(
        received.take(4).map((event) => event['deviceId']).toSet().length, 1);
    expect(received[0]['anonymousId'], received[2]['anonymousId']);
    expect(received[0]['sessionId'], isNot(received[2]['sessionId']));
    expect(received[0]['anonymousId'], isNot(received[3]['anonymousId']));
    expect(received[0]['deviceId'], isNot(received[4]['deviceId']));
    for (final event in received) {
      expect(event['deviceInfo'],
          {'model': 'Same tablet', 'system': 'Android 12 (API 31)'});
      expect(event['sdkVersion'], healthGuardSdkVersion);
      expect(event['deviceIdSource'], 'android_id');
      expect(event['deviceIdScope'], 'android_user_signing_key_app');
    }
    expect(received[2]['release'], '1.0.2');
    expect(first.deviceShortCode, 'HG-AAAAAAAAAAAA');
    for (final client in [first, restart, reinstalled, other]) {
      client.dispose();
    }
  });
  test(
      'native channel receives project scope and rejects raw or malformed device IDs',
      () async {
    const channel = MethodChannel('healthguard/network');
    final messenger =
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
    var called = false;
    messenger.setMockMethodCallHandler(channel, (call) async {
      if (call.method == 'deviceIdentity') {
        called = true;
        expect(call.arguments, {'appKey': 'demo'});
        return {...identity('a'), 'deviceId': '0123456789abcdef'};
      }
      return null;
    });
    addTearDown(() => messenger.setMockMethodCallHandler(channel, null));
    final events = <Map<String, dynamic>>[];
    final client = HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        storage: MemoryStorage(),
        retryInterval: Duration.zero,
        networkSnapshot: () async => {},
        transport: (batch) async => events
            .addAll((batch['events'] as List).cast<Map<String, dynamic>>()));
    await client.captureException(StateError('still reported'));
    expect(called, true);
    expect(events.single['deviceIdStatus'], 'unavailable');
    expect(events.single.containsKey('deviceId'), false);
    expect(jsonEncode(events), isNot(contains('0123456789abcdef')));
    expect(client.appVersion, '1.0.1');
    client.dispose();
  });
  test(
      'timeouts, plugin failure and exceptions remain explicit and do not stop reporting',
      () async {
    for (final snapshot in <Future<Map<String, dynamic>> Function()>[
      () async => throw StateError('native unavailable'),
      () async => throw MissingPluginException(),
      () => Completer<Map<String, dynamic>>().future,
    ]) {
      final events = <Map<String, dynamic>>[];
      final client = HealthGuardClient(
          appKey: 'demo',
          endpoint: 'https://collector.example.com/events',
          storage: MemoryStorage(),
          retryInterval: Duration.zero,
          deviceSnapshot: snapshot,
          networkSnapshot: () async => {},
          transport: (batch) async => events
              .addAll((batch['events'] as List).cast<Map<String, dynamic>>()));
      final elapsed = Stopwatch()..start();
      await client.captureException(StateError('error'));
      await client.captureHttpFailure(
          method: 'GET', url: 'https://api.example.com/failure', durationMs: 1);
      expect(events.length, 2);
      expect(elapsed.elapsedMilliseconds, lessThan(1500));
      for (final event in events) {
        expect(event['deviceIdStatus'], 'unavailable');
        expect(event.containsKey('deviceId'), false);
        expect(event['deviceInfo'], {'model': '未获取', 'system': '未获取'});
        expect(event['deviceIdReason'],
            isIn(['timeout', 'unsupported_platform', 'platform_error']));
      }
      expect(client.deviceShortCode, '未获取');
      client.dispose();
    }
  });
  test(
      'offline replay keeps the original identity and app version after SDK upgrade/reinstall',
      () async {
    final storage = MemoryStorage();
    final first = HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        release: 'old',
        storage: storage,
        deviceSnapshot: () async => identity('a'),
        networkSnapshot: () async => {},
        retryInterval: Duration.zero,
        transport: (_) async => throw StateError('offline'));
    await first.captureException(StateError('old error'));
    first.dispose();
    final received = <Map<String, dynamic>>[];
    final second = HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        release: 'new',
        storage: storage,
        deviceSnapshot: () async => identity('b'),
        networkSnapshot: () async => {},
        retryInterval: Duration.zero,
        transport: (batch) async => received
            .addAll((batch['events'] as List).cast<Map<String, dynamic>>()));
    await second.initialize();
    expect(received.single['release'], 'old');
    expect(received.single['deviceId'], identity('a')['deviceId']);
    second.dispose();
  });
  test('Dio failure returns while stable identity lookup is still pending',
      () async {
    final client = HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        storage: MemoryStorage(),
        retryInterval: Duration.zero,
        deviceSnapshot: () => Completer<Map<String, dynamic>>().future,
        networkSnapshot: () async => {},
        transport: (_) async {});
    final dio = Dio()..httpClientAdapter = FailingAdapter();
    dio.interceptors.add(client.interceptor());
    final elapsed = Stopwatch()..start();
    await expectLater(dio.get('https://api.example.com/failure'),
        throwsA(isA<DioException>()));
    expect(elapsed.elapsedMilliseconds, lessThan(250));
    await client.initialize();
    await Future<void>.delayed(const Duration(milliseconds: 20));
    await client.flushPending();
    expect(client.deviceIdentity.available, false);
    client.dispose();
    dio.close();
  });
  testWidgets(
      'debug page displays the same device shortcode and release as the event',
      (tester) async {
    final client = HealthGuardClient(
        appKey: 'demo',
        endpoint: 'https://collector.example.com/events',
        storage: MemoryStorage(),
        retryInterval: Duration.zero,
        deviceSnapshot: () async => identity('a'),
        networkSnapshot: () async => {},
        transport: (_) async {});
    await client.initialize();
    await tester.pumpWidget(
        MaterialApp(home: HealthGuardDeviceDebugPage(client: client)));
    await tester.pumpAndSettle();
    expect(find.text('HG-AAAAAAAAAAAA'), findsOneWidget);
    expect(find.text('App 版本: 1.0.1'), findsOneWidget);
    await tester.pumpWidget(const SizedBox.shrink());
    client.dispose();
  });
}
