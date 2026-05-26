# API 优化记录

## 问题：项目列表页存在 N+1 查询

### 现状

`ProjectListPage`（项目列表页）加载数据时，当前实现为 **N+1 次请求**：

1. 调用 `/apps` 获取项目基础列表（1 次）
2. 为每个项目循环调用 `/overview?appKey={appKey}` 获取统计概览（N 次）

**涉及代码**：
- 前端：`apps/dashboard/src/pages/ProjectListPage.ts` → `loadOverviewData()`
- 后端：暂无批量接口

### 影响

- 项目数量越多，页面加载越慢
- 并发请求对服务端和浏览器均造成不必要的压力
- 容易触发浏览器同源并发限制

### 期望

后端提供一个**批量项目概览接口**，例如：

```
GET /apps/overview
```

或带筛选参数：

```
GET /overview?appKeys=app1,app2,app3
```

响应示例：

```json
{
  "apps": [
    {
      "appKey": "school_driver_admin",
      "totals": {
        "events": 120,
        "errors": 3,
        "failedRequests": 0,
        "affectedUsers": 45,
        "issues": 2
      }
    }
  ]
}
```

前端 `loadOverviewData()` 改为单次调用该接口，替换掉当前的 `Promise.all` 循环请求。

### 影响用户统计口径说明

当前 `affectedUsers` 的统计逻辑为 `COUNT(DISTINCT COALESCE(user_id, anonymous_id))`：

- `userId`：业务方主动设置的真实用户标识
- `anonymousId`：SDK 自动生成的设备/会话级匿名标识

**问题**：如果业务方未调用 `client.setUserId()`，统计完全基于 `anonymousId`。同一真实用户清除缓存、重新打开、换设备都会产生新的 `anonymousId`，导致"影响用户"数量远高于实际用户数。

**建议**：在 Dashboard 中增加提示或文档，引导接入方调用 `setUserId()`，使监控数据能关联到真实用户。

### 后续整改

1. 服务端新增批量接口
2. 前端 `ProjectListPage` 替换为批量接口调用
3. 检查其他页面是否也存在类似的 N+1 查询模式（如 `ProjectDetailPage` 等）
