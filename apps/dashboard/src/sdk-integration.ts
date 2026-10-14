export function sdkIntegrationSnippet(type: string, appKey: string, endpoint: string): string {
  if (type === 'flutter') {
    return `# pubspec.yaml (SDK source; publish to your registry after acceptance)
dependencies:
  healthguard_flutter:
    git:
      url: https://github.com/Claud-Lu/healthguard.git
      ref: master
      path: packages/sdk-flutter

// Dart startup
import 'package:healthguard_flutter/healthguard_flutter.dart';

final healthGuard = HealthGuardClient(
  appKey: '${appKey}',
  endpoint: '${endpoint}',
  release: 'YOUR_APP_VERSION',
  environment: 'production',
);
await healthGuard.initialize();
dio.interceptors.add(healthGuard.interceptor());
// Dispose with the application lifecycle: healthGuard.dispose();`;
  }
  const mini = type === 'wechat-miniprogram' || type === 'alipay-miniprogram';
  const name = mini ? 'createMiniProgramClient' : type === 'uni-app' ? 'createUniAppClient' : 'createHealthGuardClient';
  const pkg = mini ? 'sdk-miniprogram' : type === 'uni-app' ? 'sdk-uniapp' : 'sdk-web';
  const adapter = mini ? `  wx: ${type === 'alipay-miniprogram' ? 'my' : 'wx'},\n  platform: '${type}',\n` : '';
  return `import { ${name} } from '@health-guard/${pkg}';

const client = ${name}({
  appKey: '${appKey}',
  endpoint: '${endpoint}',
${adapter}  autoCapture: true,
  networkDiagnostics: true
});`;
}
