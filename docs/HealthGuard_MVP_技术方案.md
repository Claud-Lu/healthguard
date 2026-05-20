# HealthGuard MVP 技术方案

## 1. 项目定位

HealthGuard 是一个开源、可私有化部署的跨端应用健康度检测系统。长期目标覆盖 H5、小程序、Android、iOS；MVP 阶段只聚焦 H5 和微信小程序，先跑通“采集 -> 入库 -> 聚合 -> 查询 -> 告警雏形”的闭环。

这个版本的核心目标不是一次性复刻 Sentry 或 Bugly，而是做出一个中小团队能部署、个人开发者能维护、后续 AI agent 能接力的最小可用系统。

## 2. MVP 原则

| 原则 | 调整 |
| --- | --- |
| 先跑通再扩展 | 先做 H5 + 微信小程序，不同时铺开 Android/iOS |
| 控制依赖 | 第一版不引入 Kafka、Redis、MinIO、Grafana、Elasticsearch |
| 可验证 | 每个阶段都有 demo、接口测试和可视化结果 |
| 可接力 | 所有业务决策写入文档，避免后续 agent 重新猜 |
| 默认脱敏 | SDK 默认不上报敏感字段，请求 body 默认关闭 |

## 3. 首版功能范围

### 3.1 H5 SDK

- 捕获 `window.onerror` 和 `error` 事件。
- 捕获 `unhandledrejection`。
- 捕获资源加载错误。
- 包装 `fetch` 和 `XMLHttpRequest`，记录 URL、method、status、duration、失败原因。
- 采集基础 Web Vitals：FCP、LCP、CLS、TTFB。
- 记录 breadcrumb：页面跳转、点击、接口请求、手动日志。
- 本地队列批量上报，默认 10 条或 5 秒触发。
- 失败重试，最多 3 次。

### 3.2 微信小程序 SDK

- 使用 `wx.onError` 捕获运行时错误。
- 使用 `wx.onUnhandledRejection` 捕获 Promise 错误。
- 包装 `wx.request`，记录请求状态和耗时。
- 注入 `App` / `Page` 生命周期，记录页面进入、离开、首屏时间。
- 记录 breadcrumb。
- 本地队列批量上报，弱网失败时缓存。

### 3.3 Collector 服务

- 提供 `/api/events/batch` 上报接口。
- 使用 `appKey` 做应用识别，MVP 阶段先不做复杂 HMAC。
- 校验 event schema。
- 做敏感字段过滤。
- 写入事件表。
- 根据 `fingerprint` 聚合为 issue。
- 提供 dashboard 查询 API。

### 3.4 Dashboard

MVP 管理台只做必要页面：

- 应用管理：创建应用、查看 `appKey`、接入说明。
- 概览：今日错误数、影响用户数、错误趋势。
- Issue 列表：按错误聚合展示。
- Issue 详情：堆栈、最近事件、设备/浏览器、breadcrumb。
- 事件查询：按时间、平台、版本筛选。

前端技术栈建议使用 Vue 3 + Vite + Element Plus + Pinia + Axios + ECharts，贴合个人维护习惯。

## 4. 暂缓功能

以下功能进入路线图，不进入 MVP：

- Android SDK。
- iOS SDK。
- Native 崩溃采集。
- ANR / 卡死检测。
- dSYM / mapping / SourceMap 自动符号化。
- Kafka 流式队列。
- Redis 缓存与限流。
- MinIO 对象存储。
- Grafana 大盘。
- Session Replay。
- 多租户权限和团队协作。

## 5. 建议技术架构

### 5.1 MVP 架构

```text
H5 SDK / MiniProgram SDK
        |
        v
Collector API
        |
        +--> Event Store
        |
        +--> Issue Aggregator
        |
        v
Dashboard API
        |
        v
Vue Dashboard
```

### 5.2 存储建议

首版有两种可选路径：

| 方案 | 适合场景 | 说明 |
| --- | --- | --- |
| SQLite/PostgreSQL 单库 | 最快启动 | 适合 demo 和早期开发，部署简单 |
| ClickHouse + SQLite/PostgreSQL | 更贴近监控产品 | ClickHouse 存事件，关系库存应用和配置 |

推荐第一阶段直接采用 ClickHouse + SQLite/PostgreSQL。事件类数据天然适合列式查询，但元数据不需要放进 ClickHouse。

## 6. 事件协议草案

### 6.1 通用字段

```ts
export interface BaseEvent {
  eventId: string;
  appKey: string;
  platform: 'web' | 'wechat-miniprogram';
  type: 'error' | 'performance' | 'http' | 'breadcrumb';
  timestamp: number;
  sessionId: string;
  userId?: string;
  anonymousId: string;
  release?: string;
  environment?: 'development' | 'test' | 'production';
  pageUrl?: string;
  sdkVersion: string;
}
```

### 6.2 错误事件

```ts
export interface ErrorEvent extends BaseEvent {
  type: 'error';
  errorType: 'js' | 'promise' | 'resource' | 'request';
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  fingerprint: string;
  breadcrumbs: Breadcrumb[];
}
```

### 6.3 HTTP 事件

```ts
export interface HttpEvent extends BaseEvent {
  type: 'http';
  method: string;
  url: string;
  status?: number;
  duration: number;
  success: boolean;
  errorMessage?: string;
}
```

## 7. 隐私与脱敏规则

SDK 和服务端都要做脱敏，服务端兜底。

- 默认不上报 request body。
- 默认不上报 response body。
- 默认不上报 cookie、authorization、token、password、secret。
- URL query 中命中敏感 key 时替换为 `[Filtered]`。
- input 内容不进入 breadcrumb。
- 用户标识使用业务方传入的 `userId` 或匿名 ID，不采集真实姓名、手机号、身份证。

## 8. 项目结构建议

```text
healthguard/
├── apps/
│   ├── dashboard/
│   └── server/
├── packages/
│   ├── sdk-web/
│   └── sdk-miniprogram/
├── examples/
│   ├── vue3-demo/
│   └── wechat-mini-demo/
├── deploy/
├── docs/
└── scripts/
```

## 9. MVP 验收标准

- `yarn test` 能跑通核心 SDK 和 server 单测。
- 本地 demo H5 抛错后，dashboard 能看到错误事件。
- 相同错误能按 fingerprint 聚合为一个 issue。
- 失败请求能记录 status、duration、url。
- 微信小程序 demo 能上报运行时错误。
- Dashboard 能按应用、时间、平台筛选事件。
- Docker Compose 或本地脚本能启动最小环境。
- 文档中有接入指南、事件协议、部署说明和下一阶段计划。

## 10. 下一步开发顺序

1. 初始化 monorepo：yarn workspace、TypeScript、lint、test。
2. 先写 event schema 和 SDK 单测。
3. 实现 `sdk-web` 最小采集能力。
4. 实现 collector API 和事件写入。
5. 做 Vue demo，验证 H5 端到端。
6. 做 dashboard 的应用管理、issue 列表和 issue 详情。
7. 再接微信小程序 SDK。
8. 最后补 Docker Compose 和 README 接入指引。

## 11. 长期路线

- V1：H5 + 微信小程序 + 私有化部署。
- V1.5：SourceMap 上传与反解。
- V2：支付宝/抖音小程序。
- V3：Android Java crash 和 ANR。
- V4：iOS crash 和卡死。
- V5：Kafka、Redis、对象存储、集群部署。
