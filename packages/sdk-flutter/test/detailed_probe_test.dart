import 'dart:io';
import 'package:healthguard_flutter/healthguard_flutter.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('active probes are disabled without explicit target configuration',
      () async {
    var lookedUp = false;
    final result = await NetworkDiagnostics.probeHost(
        Uri.https('api.example.com'), lookup: (_) async {
      lookedUp = true;
      return [];
    });
    expect(result, {'outcome': 'host_not_allowed'});
    expect(lookedUp, false);
  });

  TestWidgetsFlutterBinding.ensureInitialized();
  final origin = Uri.https('api.example.com');
  test(
      'probes distinguish DNS, TCP, TLS and HTTP without sending a business request',
      () async {
    final phases = <String>[];
    final result = await NetworkDiagnostics.probeHost(origin,
        allowedHosts: const {'api.example.com'},
        healthPath: '/healthz', lookup: (host) async {
      expect(host, origin.host);
      phases.add('dns');
      return [InternetAddress.loopbackIPv4];
    }, connectTcp: (address) async {
      expect(address, InternetAddress.loopbackIPv4);
      phases.add('tcp');
      return {};
    }, connectTls: (host) async {
      expect(host, origin.host);
      phases.add('tls');
      return {'certificateValidated': true};
    }, requestHealth: (uri) async {
      expect(uri.toString(), 'https://api.example.com/healthz');
      phases.add('health');
      return {'status': 503};
    });
    expect(phases, ['dns', 'tcp', 'tls', 'health']);
    expect(
        result['health']['outcome'], 'ok'); // HTTP response != backend healthy.
    expect(result['health']['status'], 503);
    expect(result['dns']['families'], ['IPv4']);
  });
  test('DNS failure stops downstream probes and retains the OS error code',
      () async {
    final result = await NetworkDiagnostics.probeHost(origin,
        allowedHosts: const {'api.example.com'},
        healthPath: '/healthz',
        lookup: (_) async => throw const SocketException('Name lookup failed',
            osError: OSError('failure', 7)),
        connectTcp: (_) async => throw StateError('should not run'));
    expect(result.keys, ['dns']);
    expect(result['dns']['outcome'], 'failed');
    expect(result['dns']['osErrorCode'], 7);
  });
  test('empty DNS result is a failure, not a reachable server', () async {
    final result = await NetworkDiagnostics.probeHost(origin,
        allowedHosts: const {'api.example.com'},
        healthPath: '/healthz',
        lookup: (_) async => []);
    expect(result['dns']['outcome'], 'failed');
    expect(result.containsKey('tcp'), false);
  });
  test('a TCP failure does not hide independent TLS or HTTP results', () async {
    final result = await NetworkDiagnostics.probeHost(origin,
        allowedHosts: const {'api.example.com'},
        healthPath: '/healthz',
        lookup: (_) async => [InternetAddress.loopbackIPv6],
        connectTcp: (_) async => throw const SocketException(
            'Network unreachable',
            osError: OSError('unreachable', 101)),
        connectTls: (_) async => throw const HandshakeException('certificate'),
        requestHealth: (_) async => {'status': 200});
    expect(result['tcp']['outcome'], 'failed');
    expect(result['tcp']['osErrorCode'], 101);
    expect(result['tls']['errorType'], 'HandshakeException');
    expect(result['health']['status'], 200);
    expect(result['dns']['families'], ['IPv6']);
  });
  test(
      'probe target restrictions reject credentials, custom ports and unrelated hosts',
      () async {
    for (final uri in [
      Uri.parse('http://api.example.com'),
      Uri.parse('https://api.example.com:8443'),
      Uri.parse('https://untrusted.example'),
      Uri.parse('https://user:password@api.example.com')
    ]) {
      expect(
          await NetworkDiagnostics.probeHost(uri,
              lookup: (_) async => throw StateError('should not run')),
          {'outcome': 'host_not_allowed'});
    }
  });
}
