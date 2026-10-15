import 'dart:async';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

/// Evidence about a failed request, never a claim about which remote peer closed it.
/// Probes are separate, anonymous requests performed AFTER the original failure.
class NetworkDiagnostics {
  NetworkDiagnostics({
    Future<Map<String, dynamic>> Function()? snapshotProvider,
    Future<Map<String, dynamic>> Function(Uri)? probe,
    DateTime Function()? clock,
    Set<String> allowedHosts = const {},
    String healthPath = '/health',
  })  : _snapshotProvider = snapshotProvider ?? _nativeSnapshot,
        _probe = probe ??
            ((origin) => probeHost(origin,
                allowedHosts: allowedHosts, healthPath: healthPath)),
        _allowedHosts = Set.unmodifiable(allowedHosts),
        _clock = clock ?? DateTime.now,
        _useNativeEvents = snapshotProvider == null;

  static const _channel = MethodChannel('healthguard/network');
  static const _events = EventChannel('healthguard/network_events');
  static final _nativeEvents = _events.receiveBroadcastStream();
  final Set<String> _allowedHosts;
  final Future<Map<String, dynamic>> Function() _snapshotProvider;
  final Future<Map<String, dynamic>> Function(Uri) _probe;
  final DateTime Function() _clock;
  final bool _useNativeEvents;
  StreamSubscription<dynamic>? _subscription;
  Map<String, dynamic> _current = {'available': false};
  final List<Map<String, dynamic>> _changes = [];
  final List<Map<String, dynamic>> _platformEvents = [];
  final Map<String, Map<String, dynamic>> _successes = {};
  final Map<String, Future<Map<String, dynamic>>> _runningProbes = {};
  final Map<String, Map<String, dynamic>> _probeCache = {};
  int _sequence = 0;
  int _inFlight = 0;
  final String _requestPrefix =
      DateTime.now().microsecondsSinceEpoch.toRadixString(36);

  static Future<Map<String, dynamic>> _nativeSnapshot() async {
    if (kIsWeb || !Platform.isAndroid) return {'available': false};
    return Map<String, dynamic>.from(
        await _channel.invokeMapMethod<String, dynamic>('snapshot') ?? {});
  }

  Future<void>? _initializing;

  Future<void> initialize() => _initializing ??= _initialize();

  Future<void> _initialize() async {
    if (_useNativeEvents && !kIsWeb && Platform.isAndroid) {
      _subscription = _nativeEvents.listen((event) {
        if (event is Map) recordSnapshot(Map<String, dynamic>.from(event));
      }, onError: (Object _) {
        _current = {'available': false};
      });
    }
    await _refresh();
  }

  Future<void> _refresh() async {
    try {
      recordSnapshot(
          await _snapshotProvider().timeout(const Duration(milliseconds: 500)));
    } catch (_) {
      _current = {'available': false};
    }
  }

  void recordSnapshot(Map<String, dynamic> snapshot) {
    final next = Map<String, dynamic>.from(snapshot);
    next['observedAt'] ??= _clock().millisecondsSinceEpoch;
    if (next['eventAt'] is int) {
      _platformEvents.add({
        'at': next['eventAt'],
        'reason': next['reason'],
        'scope': next['eventScope'],
      });
      if (_platformEvents.length > 40) _platformEvents.removeAt(0);
    }
    if (next['revision'] != _current['revision'] ||
        next['available'] != _current['available']) {
      _changes.add(Map<String, dynamic>.from(next));
      if (_changes.length > 40) _changes.removeAt(0);
    }
    _current = next;
  }

  Map<String, dynamic> beginRequest() => {
        'requestId': 'hg-$_requestPrefix-${++_sequence}',
        'startedAt': _clock().millisecondsSinceEpoch,
        'networkAtStart': Map<String, dynamic>.from(_current),
        'inFlightAtStart': ++_inFlight,
      };

  void endRequest({Response<dynamic>? response}) {
    if (_inFlight > 0) _inFlight--;
    if (response != null) {
      _successes[response.requestOptions.uri.host] = {
        'at': _clock().millisecondsSinceEpoch,
        'status': response.statusCode,
      };
    }
  }

  Future<Map<String, dynamic>> collect(
      DioException error, Map<String, dynamic> trace,
      {DateTime? failedAt}) async {
    final failureTime = (failedAt ?? _clock()).millisecondsSinceEpoch;
    final lastSuccess = _successes[error.requestOptions.uri.host];
    final inFlight = _inFlight;
    await _refresh();
    final start = Map<String, dynamic>.from(trace['networkAtStart'] as Map);
    final startedAt = trace['startedAt'] as int;
    final changes = _changes
        .where((s) =>
            (s['observedAt'] as int) > startedAt &&
            (s['observedAt'] as int) <= failureTime)
        .map(Map<String, dynamic>.from)
        .toList();
    // A platform query can complete after the failure. Do not misattribute a
    // subsequently observed network change to the original request.
    final atFailure = (_current['observedAt'] is int &&
            (_current['observedAt'] as int) <= failureTime)
        ? Map<String, dynamic>.from(_current)
        : (changes.isNotEmpty ? changes.last : start);
    if (_current['available'] == false) atFailure['available'] = false;
    final changed = start['available'] == true &&
        atFailure['available'] == true &&
        (start['revision'] != atFailure['revision'] ||
            changes.any((s) => s['revision'] != start['revision']));
    final original = errorDetails(error);
    final category = _category(error, original, atFailure);
    final uri = error.requestOptions.uri;
    final probes =
        error.response != null || error.type == DioExceptionType.cancel
            ? {'skipped': 'http_response_or_cancelled'}
            : atFailure['available'] == true && atFailure['connected'] == false
                ? {'skipped': 'no_active_network'}
                : await _probes(uri);
    return {
      'schemaVersion': 1,
      'requestId': trace['requestId'],
      'startedAt': startedAt,
      'failedAt': failureTime,
      'networkAtStart': start,
      'networkAtFailure': atFailure,
      'networkChangedDuringRequest': changed,
      'changesDuringRequest': changes,
      'platformEventsDuringRequest': _platformEvents
          .where((event) =>
              (event['at'] as int) > startedAt &&
              (event['at'] as int) <= failureTime)
          .toList(),
      'recentNetworkChanges': _changes
          .where((s) =>
              (s['observedAt'] as int) >= failureTime - 30000 &&
              (s['observedAt'] as int) <= failureTime)
          .map(Map<String, dynamic>.from)
          .toList(),
      'inFlightAtStart': trace['inFlightAtStart'],
      'otherRequestsInFlightAtFailure': inFlight,
      if (lastSuccess != null)
        'lastSuccessfulResponse': Map<String, dynamic>.from(lastSuccess),
      'originalError': original,
      'probes': probes,
      'assessment': {
        'category': category,
        'causeConfirmed': false,
        'networkChangeObserved': changed,
        'requiresServerLogs': true,
        'summary':
            '${_labels[category] ?? '原因待确认'}${changed ? '；请求期间观察到网络变化' : ''}；根因需结合服务端日志',
      },
    };
  }

  static const _labels = {
    'network_unavailable': '设备无活动网络',
    'dns_failure': '域名解析失败',
    'tls_failure': 'TLS/证书异常',
    'response_timeout': '等待响应超时',
    'connection_timeout': '建立连接超时',
    'send_timeout': '发送请求超时',
    'connection_aborted': '连接异常中断（关闭方未知）',
    'http_response': '收到HTTP错误响应',
    'cancelled': '请求主动取消',
    'unknown': '底层连接异常待确认',
  };

  static String _category(DioException error, Map<String, dynamic> original,
      Map<String, dynamic> network) {
    if (error.response != null) return 'http_response';
    if (error.type == DioExceptionType.cancel) return 'cancelled';
    if (network['available'] == true && network['connected'] == false) {
      return 'network_unavailable';
    }
    final message =
        '${original['message']} ${original['osErrorMessage']}'.toLowerCase();
    if (message.contains('failed host lookup') ||
        message.contains('name or service not known')) {
      return 'dns_failure';
    }
    if (error.error is HandshakeException ||
        error.type == DioExceptionType.badCertificate) {
      return 'tls_failure';
    }
    if (error.type == DioExceptionType.receiveTimeout) {
      return 'response_timeout';
    }
    if (error.type == DioExceptionType.connectionTimeout) {
      return 'connection_timeout';
    }
    if (error.type == DioExceptionType.sendTimeout) return 'send_timeout';
    if (message.contains('connection abort') ||
        message.contains('connection reset') ||
        message.contains('broken pipe')) {
      return 'connection_aborted';
    }
    return 'unknown';
  }

  static Map<String, dynamic> errorDetails(DioException error) {
    final underlying = error.error;
    final os = underlying is SocketException ? underlying.osError : null;
    // HttpException.toString includes its URI; use only the safe message.
    final message = underlying is SocketException
        ? underlying.message
        : underlying is HttpException
            ? underlying.message
            : underlying is HandshakeException
                ? underlying.message
                : error.message ?? error.type.name;
    return {
      'dioType': error.type.name,
      'underlyingType': underlying?.runtimeType.toString(),
      'message': safeMessage(message),
      if (error.response?.statusCode != null)
        'status': error.response!.statusCode,
      if (os != null) 'osErrorCode': os.errorCode,
      if (os != null) 'osErrorMessage': safeMessage(os.message),
    };
  }

  static String safeMessage(String message) {
    final safe =
        message.replaceAll(RegExp(r'https?://[^\s]+'), '[url omitted]');
    return safe.length > 300 ? safe.substring(0, 300) : safe;
  }

  Future<Map<String, dynamic>> _probes(Uri uri) async {
    if (uri.scheme != 'https' ||
        uri.port != 443 ||
        !_allowedHosts.contains(uri.host)) {
      return {'skipped': 'host_not_allowed'};
    }
    final host = uri.host;
    if (_runningProbes.containsKey(host)) return _runningProbes[host]!;
    final cached = _probeCache[host];
    if (cached != null &&
        _clock().millisecondsSinceEpoch - (cached['sampledAt'] as int) <
            60000) {
      return {...cached, 'cached': true};
    }
    final future = _runProbe(Uri.https(host));
    _runningProbes[host] = future;
    try {
      final result = await future;
      _probeCache[host] = result;
      return result;
    } finally {
      _runningProbes.remove(host);
    }
  }

  Future<Map<String, dynamic>> _runProbe(Uri origin) async {
    final sampledAt = _clock().millisecondsSinceEpoch;
    Map<String, dynamic> results;
    try {
      results = await _probe(origin).timeout(const Duration(seconds: 12));
    } catch (_) {
      results = {'outcome': 'failed'};
    }
    return {
      'timing': 'after_failure',
      'sampledAt': sampledAt,
      'finishedAt': _clock().millisecondsSinceEpoch,
      'cached': false,
      'results': results
    };
  }

  /// No auth, cookies, user queries, business mutations, redirects, or TLS bypass.
  static Future<Map<String, dynamic>> probeHost(
    Uri origin, {
    Set<String> allowedHosts = const {},
    String healthPath = '/health',
    Future<List<InternetAddress>> Function(String)? lookup,
    Future<Map<String, dynamic>> Function(InternetAddress)? connectTcp,
    Future<Map<String, dynamic>> Function(String)? connectTls,
    Future<Map<String, dynamic>> Function(Uri)? requestHealth,
  }) async {
    if (origin.userInfo.isNotEmpty ||
        origin.scheme != 'https' ||
        origin.port != 443 ||
        !allowedHosts.contains(origin.host)) {
      return {'outcome': 'host_not_allowed'};
    }
    final health = Uri.tryParse(healthPath);
    if (health == null ||
        !healthPath.startsWith('/') ||
        health.hasAuthority ||
        health.hasScheme ||
        health.hasQuery ||
        health.hasFragment ||
        healthPath.startsWith('//')) {
      return {'outcome': 'health_path_not_allowed'};
    }
    final results = <String, dynamic>{};
    final addresses = <InternetAddress>[];
    Future<void> step(
        String name, Future<Map<String, dynamic>> Function() action) async {
      final watch = Stopwatch()..start();
      try {
        results[name] = {
          ...await action().timeout(const Duration(seconds: 3)),
          'outcome': 'ok',
          'durationMs': watch.elapsedMilliseconds
        };
      } catch (e) {
        results[name] = {
          'outcome': 'failed',
          'durationMs': watch.elapsedMilliseconds,
          'errorType': e.runtimeType.toString(),
          if (e is SocketException && e.osError != null)
            'osErrorCode': e.osError!.errorCode
        };
      }
    }

    await step('dns', () async {
      addresses.addAll(await (lookup ?? InternetAddress.lookup)(origin.host));
      if (addresses.isEmpty) throw const SocketException('No DNS addresses');
      return {
        'addressCount': addresses.length,
        'families': addresses.map((a) => a.type.name).toSet().toList()
      };
    });
    if (addresses.isEmpty) return results;
    await step('tcp', () async {
      if (connectTcp != null) return connectTcp(addresses.first);
      // Direct-IP TCP separates socket reachability from hostname resolution.
      final socket = await Socket.connect(addresses.first, 443,
          timeout: const Duration(seconds: 2));
      socket.destroy();
      return {
        'addressFamily': addresses.first.type.name,
        'sampledAddressCount': 1
      };
    });
    await step('tls', () async {
      if (connectTls != null) return connectTls(origin.host);
      final socket = await SecureSocket.connect(origin.host, 443,
          timeout: const Duration(seconds: 2));
      socket.destroy();
      return {'certificateValidated': true};
    });
    await step('health', () async {
      if (requestHealth != null) {
        return requestHealth(origin.resolve(healthPath));
      }
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 2);
      try {
        final request = await client
            .getUrl(origin.resolve(healthPath))
            .timeout(const Duration(seconds: 2));
        request.followRedirects = false;
        final response =
            await request.close().timeout(const Duration(seconds: 2));
        // Status proves an HTTP response, not that the business API is healthy.
        return {'status': response.statusCode};
      } finally {
        client.close(force: true);
      }
    });
    return results;
  }

  void dispose() {
    unawaited(_subscription?.cancel());
    _subscription = null;
  }
}
