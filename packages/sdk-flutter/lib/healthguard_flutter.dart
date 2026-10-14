library;

import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:shared_preferences/shared_preferences.dart';

abstract class HealthGuardStorage {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
}

class _PreferencesStorage implements HealthGuardStorage {
  @override
  Future<String?> read(String key) async =>
      (await SharedPreferences.getInstance()).getString(key);
  @override
  Future<void> write(String key, String value) async {
    await (await SharedPreferences.getInstance()).setString(key, value);
  }
}

/// A standalone client: applications supply configuration and attach interceptor().
/// Android supplies network state; other platforms retain an explicit unavailable state.
class HealthGuardClient {
  HealthGuardClient({
    required this.appKey,
    required this.endpoint,
    this.release = '',
    this.environment = 'production',
    HealthGuardStorage? storage,
    Future<void> Function(Map<String, dynamic>)? transport,
    Future<Map<String, dynamic>> Function()? networkSnapshot,
    this.retryInterval = const Duration(seconds: 30),
    this.cooldown = const Duration(seconds: 30),
    int maxPendingEvents = 100,
  })  : _storage = storage ?? _PreferencesStorage(),
        _transport = transport,
        _snapshot = networkSnapshot,
        _limit = maxPendingEvents.clamp(1, 100);

  final String appKey, endpoint, environment;
  String release;
  final HealthGuardStorage _storage;
  final Future<void> Function(Map<String, dynamic>)? _transport;
  final Future<Map<String, dynamic>> Function()? _snapshot;
  final int _limit;
  final Duration retryInterval, cooldown;
  final List<Map<String, dynamic>> _pending = [];
  final Map<String, DateTime> _last = {};
  final String _session = _id('session');
  String _anonymous = _id('anon');
  final Dio _collector = Dio(BaseOptions(
      connectTimeout: const Duration(seconds: 5),
      receiveTimeout: const Duration(seconds: 5),
      sendTimeout: const Duration(seconds: 5)));
  Future<void> _serial = Future.value();
  Future<void>? _initializing;
  Timer? _timer;
  bool _disposed = false;
  static const _channel = MethodChannel('healthguard/network');
  int get pendingCount => _pending.length;
  bool get enabled => !_disposed && appKey.isNotEmpty && endpoint.isNotEmpty;
  String get _key =>
      'healthguard_pending_v1:${Uri.encodeComponent(appKey)}:${Uri.encodeComponent(endpoint)}';

  Future<void> initialize() => _initializing ??= _initialize();
  Future<void> _initialize() async {
    try {
      final saved = jsonDecode(await _storage.read(_key) ?? '[]');
      if (saved is List) {
        _pending.addAll(saved
            .whereType<Map>()
            .where((e) =>
                e['appKey'] == appKey &&
                e['eventId'] is String &&
                e['timestamp'] is num &&
                (e['type'] == 'http' || e['type'] == 'error'))
            .map((e) => Map<String, dynamic>.from(e))
            .toList()
            .reversed
            .take(_limit)
            .toList()
            .reversed);
      }
      final identityKey =
          'healthguard_installation_v1:${Uri.encodeComponent(appKey)}';
      _anonymous = await _storage.read(identityKey) ?? _anonymous;
      await _storage.write(identityKey, _anonymous);
    } catch (_) {/* Unavailable storage must not break requests. */}
    if (_snapshot == null) {
      try {
        await _channel
            .invokeMethod<void>('start')
            .timeout(const Duration(milliseconds: 300));
      } catch (_) {}
    }
    if (retryInterval > Duration.zero && !_disposed) {
      _timer = Timer.periodic(retryInterval, (_) {
        unawaited(flushPending());
      });
    }
    await flushPending();
  }

  Future<void> captureHttpFailure(
      {required String method,
      required String url,
      int? status,
      required int durationMs,
      String? errorMessage,
      String? failureKind,
      DateTime? occurredAt,
      String? eventEnvironment,
      String? deviceModel,
      String? deviceSystem,
      String? fingerprint,
      Map<String, dynamic>? context}) async {
    if (!enabled || _isCollector(url)) return;
    await initialize();
    final uri = Uri.tryParse(url);
    final origin = uri != null &&
            uri.hasAuthority &&
            ['http', 'https'].contains(uri.scheme)
        ? '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}'
        : null;
    final now = DateTime.now();
    Map<String, dynamic> native = {};
    try {
      native = await (_snapshot?.call() ??
              _channel
                  .invokeMapMethod<String, dynamic>('snapshot')
                  .then((v) => v ?? <String, dynamic>{}))
          .timeout(const Duration(milliseconds: 300));
    } catch (_) {}
    final network = <String, dynamic>{};
    for (final key in ['online', 'validated', 'metered', 'vpn']) {
      if (native[key] is bool) network[key] = native[key];
    }
    if (['wifi', 'cellular', 'ethernet', 'vpn', 'none', 'unknown']
        .contains(native['transport'])) {
      network['transport'] = native['transport'];
    }
    final category = classifyNetworkFailure(
        status: status,
        failureKind: failureKind,
        online: network['online'] as bool?,
        message: errorMessage);
    final key = origin ?? 'relative';
    final attach =
        !_last.containsKey(key) || now.difference(_last[key]!) >= cooldown;
    final recent = <Map<String, dynamic>>[];
    if (native['recentChanges'] is List) {
      for (final change in (native['recentChanges'] as List).whereType<Map>()) {
        final timestamp = change['timestamp'];
        if (timestamp is num &&
            now.millisecondsSinceEpoch - timestamp >= 0 &&
            now.millisecondsSinceEpoch - timestamp <= 120000) {
          recent.add({
            'timestamp': timestamp,
            if (change['online'] is bool) 'online': change['online'],
            if (['wifi', 'cellular', 'ethernet', 'vpn', 'none', 'unknown']
                .contains(change['transport']))
              'transport': change['transport']
          });
        }
      }
    }
    if (attach) {
      _last.remove(key);
      _last[key] = now;
      if (_last.length > 20) _last.remove(_last.keys.first);
    }
    final event = <String, dynamic>{
      'eventId': _id('evt'),
      'appKey': appKey,
      'platform': 'flutter',
      'type': 'http',
      'timestamp': (occurredAt ?? now).millisecondsSinceEpoch,
      'sessionId': _session,
      'anonymousId': _anonymous,
      'release': release,
      'environment': eventEnvironment ?? environment,
      'sdkVersion': '0.1.1-flutter',
      if (deviceModel != null || deviceSystem != null)
        'deviceInfo': {
          if (deviceModel != null) 'model': _safeText(deviceModel),
          if (deviceSystem != null) 'system': _safeText(deviceSystem),
        },
      if (fingerprint != null) 'fingerprint': _safeText(fingerprint),
      'method': method.toUpperCase(),
      'url': safeRequestUrl(url),
      if (status != null) 'status': status,
      'duration': max(0, durationMs),
      'success': false,
      'errorMessage': 'Network request failed ($category)',
      if (attach)
        'networkDiagnostic': {
          'version': 1,
          'sampledAt': now.millisecondsSinceEpoch,
          'category': category,
          if (origin != null) 'targetOrigin': origin,
          'networkAvailability': network.isEmpty ? 'unavailable' : 'available',
          'network': network,
          'timing': {'availability': 'unavailable'},
          'recentChanges': recent.reversed.take(5).toList().reversed.toList()
        },
      if (context != null) 'context': _safeContext(context),
    };
    await _schedule(() async {
      _pending.add(event);
      if (_pending.length > _limit) {
        _pending.removeRange(0, _pending.length - _limit);
      }
      await _persist();
      await _deliver();
    });
  }

  /// Reuse existing handled-error call sites while allowing only diagnostic context.
  Future<void> captureException(Object error,
      {StackTrace? stackTrace,
      Map<String, dynamic>? context,
      String? eventEnvironment,
      String? deviceModel,
      String? deviceSystem}) async {
    if (!enabled) return;
    await initialize();
    final message = _safeText(error.toString());
    final event = <String, dynamic>{
      'eventId': _id('evt'),
      'appKey': appKey,
      'platform': 'flutter',
      'type': 'error',
      'timestamp': DateTime.now().millisecondsSinceEpoch,
      'sessionId': _session,
      'anonymousId': _anonymous,
      'release': release,
      'environment': eventEnvironment ?? environment,
      'sdkVersion': '0.1.1-flutter',
      if (deviceModel != null || deviceSystem != null)
        'deviceInfo': {
          if (deviceModel != null) 'model': _safeText(deviceModel),
          if (deviceSystem != null) 'system': _safeText(deviceSystem),
        },
      'errorType': 'native',
      'message': message,
      if (stackTrace != null) 'stack': _safeText(stackTrace.toString()),
      'fingerprint': 'native:${_fingerprint(message)}',
      'breadcrumbs': <dynamic>[],
      if (context != null) 'context': _safeContext(context),
    };
    await _schedule(() async {
      _pending.add(event);
      if (_pending.length > _limit) {
        _pending.removeRange(0, _pending.length - _limit);
      }
      await _persist();
      await _deliver();
    });
  }

  Interceptor interceptor() => _HealthGuardInterceptor(this);
  Future<void> flushPending() => _schedule(_deliver);
  Future<void> _schedule(Future<void> Function() task) {
    _serial = _serial.then((_) async {
      if (!_disposed) await task();
    }).catchError((Object _) {});
    return _serial;
  }

  Future<void> _persist() async {
    try {
      await _storage.write(_key, jsonEncode(_pending));
    } catch (_) {}
  }

  Future<void> _deliver() async {
    if (!enabled) return;
    while (_pending.isNotEmpty) {
      final count = min(50, _pending.length);
      final batch = {'appKey': appKey, 'events': _pending.take(count).toList()};
      try {
        if (_transport != null) {
          await _transport(batch).timeout(const Duration(seconds: 5));
        } else {
          final response = await _collector.post(endpoint, data: batch);
          if (response.data is! Map || response.data['accepted'] != count) {
            return;
          }
        }
        _pending.removeRange(0, count);
        await _persist();
      } catch (_) {
        return;
      }
    }
  }

  bool _isCollector(String url) {
    final current = Uri.tryParse(url), collector = Uri.tryParse(endpoint);
    return current != null &&
        collector != null &&
        current.scheme == collector.scheme &&
        current.host == collector.host &&
        current.port == collector.port &&
        current.path == collector.path;
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _collector.close();
    if (_snapshot == null) {
      unawaited(_channel.invokeMethod<void>('stop').catchError((Object _) {}));
    }
  }
}

class _HealthGuardInterceptor extends Interceptor {
  _HealthGuardInterceptor(this.client);
  final HealthGuardClient client;
  final _started = Expando<Stopwatch>();
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    _started[options] = Stopwatch()..start();
    handler.next(options);
  }

  @override
  void onResponse(Response response, ResponseInterceptorHandler handler) {
    if ((response.statusCode ?? 0) >= 400) {
      unawaited(client.captureHttpFailure(
          method: response.requestOptions.method,
          url: response.requestOptions.uri.toString(),
          status: response.statusCode,
          durationMs:
              _started[response.requestOptions]?.elapsedMilliseconds ?? 0));
    }
    handler.next(response);
  }

  @override
  void onError(DioException error, ErrorInterceptorHandler handler) {
    final kind = switch (error.type) {
      DioExceptionType.connectionTimeout ||
      DioExceptionType.sendTimeout ||
      DioExceptionType.receiveTimeout =>
        'timeout',
      DioExceptionType.cancel => 'cancelled',
      DioExceptionType.badCertificate => 'tls',
      _ => null,
    };
    // Cancellation is intentional, not an application failure to alert on.
    if (kind != 'cancelled') {
      unawaited(client.captureHttpFailure(
          method: error.requestOptions.method,
          url: error.requestOptions.uri.toString(),
          status: error.response?.statusCode,
          durationMs: _started[error.requestOptions]?.elapsedMilliseconds ?? 0,
          failureKind: kind,
          errorMessage: error.error?.toString()));
    }
    handler.next(error);
  }
}

String classifyNetworkFailure(
    {int? status, String? failureKind, bool? online, String? message}) {
  if (status != null && status >= 400) return 'http';
  if (failureKind == 'cancelled') return 'cancelled';
  if (online == false) return 'offline';
  if (['dns', 'connect', 'tls', 'timeout', 'unknown'].contains(failureKind)) {
    return failureKind!;
  }
  final text = message ?? '';
  if (RegExp('timeout|timed out', caseSensitive: false).hasMatch(text)) {
    return 'timeout';
  }
  if (RegExp('ENOTFOUND|EAI_AGAIN|UnknownHostException|Failed host lookup',
          caseSensitive: false)
      .hasMatch(text)) {
    return 'dns';
  }
  if (RegExp('ECONNREFUSED|connection refused', caseSensitive: false)
      .hasMatch(text)) {
    return 'connect';
  }
  if (RegExp('CERT_|SSLHandshakeException|HandshakeException',
          caseSensitive: false)
      .hasMatch(text)) {
    return 'tls';
  }
  return 'unknown';
}

String safeRequestUrl(String raw) {
  final uri = Uri.tryParse(raw);
  if (uri == null ||
      (uri.hasScheme && !['http', 'https'].contains(uri.scheme))) {
    return '[Unavailable]';
  }
  return uri
      .replace(userInfo: '', query: '', fragment: '')
      .toString()
      .replaceAll(RegExp(r'[?#]+$'), '');
}

Map<String, dynamic> _safeContext(Map<String, dynamic> context) {
  final result = <String, dynamic>{};
  for (final key in ['method', 'operation', 'failureKind']) {
    if (context[key] is String) {
      final text = _safeText(context[key] as String);
      result[key] = text.substring(0, min(80, text.length));
    }
  }
  if (context['status'] is num) result['status'] = context['status'];
  if (context['url'] is String) result['url'] = safeRequestUrl(context['url']);
  for (final key in ['networkDiagnostics', 'originalError']) {
    if (context[key] is Map) {
      result[key] = _safeDiagnostic(context[key], 0);
    }
  }
  return result;
}

// Only transport evidence is retained; arbitrary application payloads, user
// identifiers, credentials and network identifiers are never copied wholesale.
const _diagnosticKeys = {
  'schemaVersion',
  'requestId',
  'startedAt',
  'failedAt',
  'networkAtStart',
  'networkAtFailure',
  'networkChangedDuringRequest',
  'changesDuringRequest',
  'platformEventsDuringRequest',
  'recentNetworkChanges',
  'inFlightAtStart',
  'otherRequestsInFlightAtFailure',
  'lastSuccessfulResponse',
  'originalError',
  'probes',
  'assessment',
  'category',
  'causeConfirmed',
  'networkChangeObserved',
  'requiresServerLogs',
  'summary',
  'available',
  'connected',
  'online',
  'validated',
  'metered',
  'revision',
  'transport',
  'observedAt',
  'sampledAt',
  'finishedAt',
  'eventAt',
  'reason',
  'eventScope',
  'scope',
  'at',
  'androidSdk',
  'deviceModel',
  'manufacturer',
  'captivePortal',
  'powerSaveMode',
  'proxyConfigured',
  'callbackRegistered',
  'dioType',
  'underlyingType',
  'message',
  'status',
  'osErrorCode',
  'osErrorMessage',
  'cached',
  'timing',
  'results',
  'skipped',
  'dns',
  'tcp',
  'tls',
  'health',
  'outcome',
  'durationMs',
  'errorType',
  'families',
  'addressCount',
  'code',
};
dynamic _safeDiagnostic(dynamic value, int depth) {
  if (depth > 7) return null;
  if (value is Map) {
    return <String, dynamic>{
      for (final entry in value.entries.take(64))
        if (_diagnosticKeys.contains(entry.key))
          entry.key as String: entry.key == 'causeConfirmed'
              ? false
              : _safeDiagnostic(entry.value, depth + 1),
    };
  }
  if (value is List) {
    return value.take(40).map((v) => _safeDiagnostic(v, depth + 1)).toList();
  }
  if (value is String) {
    final text = _safeText(value);
    return text.substring(0, min(500, text.length));
  }
  if (value is num || value is bool || value == null) return value;
  return null;
}

String _id(String prefix) =>
    '${prefix}_${DateTime.now().microsecondsSinceEpoch}_${Random.secure().nextInt(1 << 32)}';

String _safeText(String raw) {
  final text = raw
      .replaceAllMapped(
          RegExp(r'https?://[^\s)]+'), (m) => safeRequestUrl(m[0]!))
      .replaceAllMapped(
          RegExp(
              r'(token|password|authorization|cookie|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+',
              caseSensitive: false),
          (m) => '${m[1]}=[Filtered]');
  return text.substring(0, min(4000, text.length));
}

String _fingerprint(String value) {
  var hash = 2166136261;
  for (final unit in value.codeUnits) {
    hash = ((hash ^ unit) * 16777619) & 0xffffffff;
  }
  return hash.toRadixString(36);
}
