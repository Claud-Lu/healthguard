const healthGuardSdkVersion = '0.3.0-flutter';

/// Only the native-side SHA-256 pseudonym crosses the platform channel.
class HealthGuardDeviceIdentity {
  const HealthGuardDeviceIdentity(
      {this.deviceId,
      this.source,
      this.scope,
      this.reason = 'not_available',
      this.model,
      this.system,
      this.appVersion});
  final String? deviceId, source, scope, reason, model, system, appVersion;
  bool get available => deviceId != null;
  String get shortCode =>
      available ? 'HG-${deviceId!.substring(5, 17).toUpperCase()}' : '未获取';
  factory HealthGuardDeviceIdentity.fromNative(Map<String, dynamic> value) {
    String? text(String key) {
      final raw = value[key];
      if (raw is! String || raw.trim().isEmpty) return null;
      return raw.trim().substring(0, raw.trim().length.clamp(0, 128));
    }

    final id = value['deviceId'];
    final source = value['deviceIdSource'];
    final scope = value['deviceIdScope'];
    final available = value['deviceIdStatus'] == 'available' &&
        id is String &&
        RegExp(r'^hgd1_[a-f0-9]{64}$').hasMatch(id) &&
        source == 'android_id' &&
        ['android_user_signing_key_app', 'android_user_app_legacy']
            .contains(scope);
    final reason = value['deviceIdReason'];
    return HealthGuardDeviceIdentity(
        deviceId: available ? id : null,
        source: source == 'android_id' ? 'android_id' : null,
        scope: ['android_user_signing_key_app', 'android_user_app_legacy']
                .contains(scope)
            ? scope as String
            : null,
        reason: available
            ? null
            : [
                'not_available',
                'invalid_android_id',
                'platform_error',
                'timeout',
                'unsupported_platform'
              ].contains(reason)
                ? reason as String
                : 'not_available',
        model: text('model'),
        system: text('system'),
        appVersion: text('appVersion'));
  }
  Map<String, dynamic> toEventFields() => {
        'deviceIdStatus': available ? 'available' : 'unavailable',
        if (deviceId != null) 'deviceId': deviceId,
        if (source != null) 'deviceIdSource': source,
        if (scope != null) 'deviceIdScope': scope,
        if (!available) 'deviceIdReason': reason ?? 'not_available',
      };
}
