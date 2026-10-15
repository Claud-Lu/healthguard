# 可复用网络诊断

本次能力放在 HealthGuard SDK 中。业务项目提供 Collector 地址、appKey、版本和环境，并启用 SDK；不再各自维护网络分类、限频、脱敏和补传实现。

## 接入与发布顺序

1. 先部署更新后的 Collector 和 Dashboard；新字段为可选字段，旧客户端仍可上报。
2. 验收后发布 npm `@health-guard/core`、Web、小程序和 uni-app SDK `0.4.0`。本仓库版本提升不代表已经发布到 npm。
3. Flutter 新增 `packages/sdk-flutter` / `healthguard_flutter@0.2.1`，当前可以通过 Git/path 引入；它不在 npm 发布流程中。pub.dev 发布须单独执行。
4. 业务端升级并重新构建发布。旧 App 不能通过后台升级获得新采集能力，历史事件不回填。
5. 替换业务端拦截器时删除重复 HTTP 上报路径；原有已处理异常调用、业务上下文和真实配置需要逐项核对，不自动删除。

### Web / H5

```ts
import { createHealthGuardClient } from '@health-guard/sdk-web';
const client = createHealthGuardClient({
  appKey: 'your-app-key',
  endpoint: 'https://collector.example.com/api/events/batch',
  release: 'your-app-version',
  environment: 'production',
  autoCapture: true,
  networkDiagnostics: true
});
```

uni-app 使用 `createUniAppClient`，小程序使用 `createMiniProgramClient`（微信 `wx`，支付宝 `my` 传入 `wx` 适配器参数，同时指定 `platform`）。配置一致；不需要把诊断代码复制到业务项目。初始化只执行一次，客户端生命周期结束时调用 `dispose()`；原有 HTTP 全局拦截器仍包装业务请求，销毁客户端后停止向其队列写入。

高级配置支持 `networkDiagnostics: { cooldownMs: 30000, maxPendingEvents: 100, storage }`。`storage` 为同步 `getItem/setItem` 适配器，默认使用浏览器 localStorage 或小程序/uni-app 存储 API。存储禁用或空间不足时退回内存，不影响业务请求。

### Flutter / Android

```yaml
# pubspec.yaml; pin ref to a reviewed commit for production.
dependencies:
  healthguard_flutter:
    git:
      url: https://github.com/Claud-Lu/healthguard.git
      ref: master
      path: packages/sdk-flutter
```

```dart
import 'package:healthguard_flutter/healthguard_flutter.dart';
final healthGuard = HealthGuardClient(
  appKey: 'your-app-key',
  endpoint: 'https://collector.example.com/api/events/batch',
  release: 'your-app-version',
  environment: 'production',
);
await healthGuard.initialize();
dio.interceptors.add(healthGuard.interceptor());
// Existing handled exception reporting can call captureException(...).
// On app/service shutdown: healthGuard.dispose();
```

原始 Dio 响应/异常保持不变，监控采集和上传不阻塞请求结果；主动取消不触发 HTTP 异常告警。`captureHttpFailure` 支持业务层手动报告已处理的失败，`captureException` 保持 native error 语义。仅为同一次失败选择一条自动或手动 HTTP 上报路径，避免重复计数。

Flutter 队列最多 100 条，失败保留原事件 ID、发生时间、版本、会话和安装 ID；串行持久化与上传，默认 30 秒重试、每批最多 50 条。`flushPending` 可主动补传。默认 Android SharedPreferences 落盘；可注入 `HealthGuardStorage`、transport 和 networkSnapshot 进行适配/测试。初始化必须先于手动 flush。

Android 插件声明 INTERNET 和 ACCESS_NETWORK_STATE，不申请定位权限。原生 minSdk=21；存储依赖固定到仍支持 API 21 的版本，避免依赖升级悄悄提高系统下限。API 21/22 不上报系统 validated/VPN 字段；API 23+ 可读默认网络，API 24+ 监听默认网络变化。iOS/Web 暂无本 SDK 的原生网络插件，保留请求失败分类，原生网络字段标为不可用。

## 统一事件契约

error / http 事件可带 `networkDiagnostic`：

```json
{
  "version": 1,
  "category": "unknown",
  "targetOrigin": "https://api.example.com",
  "networkAvailability": "unavailable",
  "network": {},
  "timing": { "availability": "unavailable" },
  "recentChanges": []
}
```

- `category`：offline / dns / connect / tls / timeout / cancelled / http / unknown。
- `network`：online、transport、effectiveType、validated、metered、vpn；仅保留允许字段。
- `timing`：DNS、连接、TTFB 可用时分别记录毫秒，不可读的字段省略，不能用 0 代替缺失。
- `recentChanges`：近两分钟最多五条系统网络状态通知，不含网络标识。
- `targetOrigin` 只保留协议、域名和端口，不包含用户信息、路径、参数或片段。

分类优先使用本次 HTTP 错误响应或明确原生错误种类；offline 为设备联网状态线索。普通浏览器 Failed to fetch 保留 unknown，不能推断为 DNS、TLS、CORS 或服务端宕机。在线或系统 validated 也不能证明业务服务器可达。

H5 的网络信息接口并非所有浏览器支持。跨域 Resource Timing 需要响应提供 `Timing-Allow-Origin`；没有暴露的 DNS/连接/TTFB 保持 unavailable。SDK 只使用时间匹配本次请求的 Resource Timing，不能复用前一次同 URL 请求的耗时。Flutter Dio 无法直接给出分阶段耗时，本期仅有请求总耗时，分阶段仍标不可用。

JS 端维持被动采集。Flutter 0.2.0 的主动 DNS/TCP/TLS/健康检查默认关闭，只有应用显式配置 HTTPS/443 域名白名单及健康路径后才启用；分阶段超时、每域单组任务及缓存控制预算。主动探测与原业务请求是分开的连接，不能将其结果当作原请求成功或根因确认。

## 限频、脱敏与补传

- 默认每目标域 30 秒附加一次详细诊断，最多记住 20 个目标域；限频只控制附加证据，不丢掉 HTTP 失败事件。
- 启用 JS 诊断时，所有 HTTP 失败均可落盘；事件队列最多 100 条，超限移除最旧项。上传中的事件在确认前仍在存储中。
- 默认 transport 在诊断开启时要求 Collector 返回 `accepted` 等于本批事件数。200 HTML、空响应、错误应答均保留事件；自定义 transport 必须在真实确认后才 resolve。
- 成功后删除对应待传事件；失败沿用 SDK 30 秒退避与手动 flush。Collector 以 eventId 去重，响应丢失后的重试不会重新计数。
- 新增诊断和 HTTP 补传只保存允许字段，不采集请求头、请求体、SSID/BSSID、IP 或运营商身份；持久化请求 URL 去掉 userinfo、全部查询和片段。
- 既有手动 context、requestData、异常文本属于原有采集接口，业务方仍需遵守自身隐私边界，不传入凭据或敏感业务数据。Flutter handled exception context 使用允许字段，异常文本中的 URL/常见凭据字段脱敏。
- 存储不可用时只能内存补传；队列保留上限、卸载清数据、进程在持久化前被杀等情况无法保证不丢失。

## 后台与验收

Dashboard 的 error/http 卡片、复制给 AI 的报告及告警邮件使用同一摘要，描述触发事件，不混用聚合 Issue 中其他事件的网络信息；旧事件不显示虚构诊断。

```bash
yarn build
yarn test
yarn test:network
yarn test apps/server/src/store/network-replay.test.ts
yarn type-check
yarn lint
yarn check:sensitive
cd packages/sdk-flutter
flutter pub get
flutter test --coverage
flutter analyze
```

上线后需另做真机验收：Wi-Fi/移动数据切换、断网恢复、VPN、超时、DNS/TLS 错误、Collector 失联、App 重启补传、旧 Android 安装和真实告警。构建、单元测试和模拟事件不能替代这些验收；平台邮件发送也需要部署环境单独验证。

参考：[Android 网络状态](https://developer.android.com/develop/connectivity/network-ops/reading-network-state)、[ConnectivityManager](https://developer.android.com/reference/android/net/ConnectivityManager)、[Resource Timing](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming)、[Dio](https://pub.dev/packages/dio)。

数据库去重测试使用 PGlite 执行真实 PostgreSQL SQL 语义，覆盖重复批次、响应丢失重试和重建 Store 后回放。它不能证明独立 PostgreSQL 服务的连接池、多进程 advisory lock 或线上数据库验收。既有服务级集成测试需要 `TEST_DATABASE_URL`，缺失时跳过，不能计为通过。


## Flutter migration compatibility (source 0.2.1)

For manual HTTP reports, captureHttpFailure accepts occurredAt, eventEnvironment, deviceModel, deviceSystem and fingerprint. Diagnostic context retains bounded allowlisted networkDiagnostics and originalError fields; passive snapshot sampledAt records collection time separately from the original failure time.

Applications may configure additionalContextKeys for explicitly approved scalar business evidence. Credential keys and nested business payloads are excluded even when requested. Select a single manual or automatic HTTP reporting path to prevent duplicate alerts.

Existing application queues and installation IDs can be migrated through HealthGuardStorage. Persist the new queue before clearing old storage and retain original event IDs, timestamps and releases. A custom transport must throw unless the collector acknowledges the full batch.

The package is source-only, not published to pub.dev. Pin reviewed commit 792e323348083657ae519cabac104479314d9cfd. Registry publication, server deployment and device acceptance are separate steps.


## Detailed Flutter diagnostics (source 0.2.1)

NetworkDiagnostics now lives in the SDK. It provides beginRequest, endRequest,
collect and dispose; applications supply allowedHosts and healthPath and connect
these hooks to their single existing HTTP reporting path. Retain business
configuration, handled-error reporting and legacy-storage migration adapters;
remove duplicated native observers and application probe implementations only
after migrating all call sites.

The Android client and detailed event stream share one reference-counted observer.
Network evidence includes request IDs, start/failure snapshots, observed changes,
in-flight counts, last successful response and original Dio/OS errors. It does
not confirm which peer caused a failure. Non-Android native evidence remains
explicitly unavailable.

Active probes require a non-empty HTTPS/443 host allowlist. healthPath must be a
relative absolute path without authority, scheme, query or fragment. Each stage
and the whole group have bounded timeouts; per-host single-flight and a 60-second
cache bound probe traffic. Probe results are collected after failure and retain
their actual sampling time. They are separate requests and never reproduce the
original business connection. No authentication, business queries, redirects or
TLS bypass are used. Manual and interceptor cancellation creates no alert.

## HTTP 事件聚合与原请求证据（未发布）

HTTP 新指纹为 `http:v2:<hash>`，使用目标 origin、路径、方法、平台、环境、状态及故障阶段；不使用查询参数、请求编号或耗时。阶段优先采用原始 Dio 类型，HTTP 状态优先表示已收到错误响应；仅明确的 SocketException 域名解析错误细分为 DNS。旧客户端无细节时保留 unknown，不凭事后探测确定原请求根因。服务端统一生成指纹，不直接信任客户端自定义分组。

已有历史事件/问题保留原指纹、Issue ID 和修复关联；首次升级可能与新分组并存。启动回填以时间最新的事件更新摘要和最近版本，延迟到达的旧事件不覆盖新摘要。历史混合问题不会自动继承为新分组的已修复状态。部署后请按时间、请求编号、原始错误和单次版本排查。

Flutter 原生 IO 连接证据需在创建 Dio 后配置 `dio.httpClientAdapter = HealthGuardIoHttpClientAdapter()`。自定义 HttpClient/TLS/代理配置通过 createHttpClient 传入，叶证书验证通过 validateCertificate 保留。不要覆盖其他必要的自定义 adapter。自动上报只挂载一个 SDK interceptor；已有手动上报只从 `error.requestOptions.extra[healthGuardRequestTraceKey]` 传入 `context.requestTrace`，继续保留 `context.originalError`。

requestTrace 只记录原请求编号、开始时间、配置的超时、连接取得与响应头等待结果/单调耗时。连接取得包含潜在池等待、DNS、TCP、TLS 或代理阶段，未分别测量；responseHeaders 已收到不代表响应体读取完成。超时或取消后证据冻结，迟到连接被中止。原请求子阶段不可用就显示 unavailable，禁止用独立探测的 DNS/TCP/TLS 时间替代。

邮件区分「本次异常」和「历史聚合摘要」。Dashboard、AI 报告及邮件共享原始类型、请求编号、探测采样时间和缓存标记。后端若要关联失败请求，需保留 X-Request-ID；未形成 HTTP 请求的连接失败可能没有访问日志。原始连接的进一步分层定位仍需平台跟踪或现场抓包。
