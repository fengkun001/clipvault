# ClipVault API 文档

> 基础 URL：`http://39.107.52.250`  
> 所有 API 返回 JSON，Content-Type: `application/json`  
> 在线 Swagger 文档：`http://39.107.52.250/docs`（FastAPI 自动生成）

---

## 一、通用约定

### 1.1 认证方式

大多数接口**无需认证**（匿名使用）。需要登录的接口在请求头中携带：

```
Authorization: Bearer <JWT_TOKEN>
```

### 1.2 错误响应格式

```json
{
  "detail": "错误描述信息"
}
```

### 1.3 限流

所有 API 接口均受滑动窗口限流保护，超出限制返回 `429 Too Many Requests`：

```json
{
  "detail": "创建太频繁，请稍后再试"
}
```

| 接口 | 方法 | 窗口 | 最大次数 |
|------|------|------|----------|
| `/api/shares` | POST | 10 分钟 | 30 |
| `/api/files` | POST | 10 分钟 | 20 |
| `/api/auth/*` | POST | 10 分钟 | 20 |
| `/api/*` | GET | 1 分钟 | 120 |

---

## 二、文本分享

### 2.1 创建分享

```
POST /api/shares
```

**请求体（JSON）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| content | string | 是 | 分享内容，最大 512KB |
| content_type | string | 否 | `text`（默认）/ `markdown` / `code` / `encrypted` |
| expires_in | int | 否 | 有效期（秒），1～31536000（365天），不传则永久 |
| max_views | int | 否 | 最大访问次数，1～100000，不传则不限 |

**请求示例：**

```bash
curl -X POST http://39.107.52.250/api/shares \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello World", "content_type": "text", "expires_in": 3600, "max_views": 5}'
```

**响应示例（200）：**

```json
{
  "code": "aB3xK9mZ",
  "url": "http://39.107.52.250/s/aB3xK9mZ",
  "delete_token": "abc123...",
  "expires_at": "2026-09-07T15:00:00",
  "max_views": 5
}
```

**字段说明：**

| 字段 | 说明 |
|------|------|
| code | 8 位短码，用于访问分享 |
| url | 完整分享链接 |
| delete_token | 销毁令牌，**务必保存**，丢失则无法删除 |
| expires_at | 过期时间（UTC），null 表示永久 |
| max_views | 最大访问次数，null 表示不限 |

### 2.2 获取分享内容

```
GET /api/shares/{code}
```

> ⚠️ 此接口会**消耗一次访问次数**。仅获取元信息不消耗次数，使用 `/api/shares/{code}/meta`。

**响应示例（200）：**

```json
{
  "code": "aB3xK9mZ",
  "content_type": "text",
  "content": "Hello World",
  "created_at": "2026-09-07T14:00:00",
  "expires_at": "2026-09-07T15:00:00",
  "view_count": 2,
  "max_views": 5
}
```

**错误码：**

| 状态码 | 说明 |
|--------|------|
| 404 | 分享不存在 |
| 410 | 已过期或访问次数已用尽 |

### 2.3 获取分享元信息

```
GET /api/shares/{code}/meta
```

> 不消耗访问次数，用于文件下载前的信息查询。

**响应示例（200）：**

```json
{
  "code": "aB3xK9mZ",
  "content_type": "file",
  "file_name": "photo.jpg",
  "file_size": 2048000,
  "file_mime": "image/jpeg",
  "created_at": "2026-09-07T14:00:00",
  "expires_at": null,
  "view_count": 3,
  "max_views": null
}
```

### 2.4 销毁分享

```
DELETE /api/shares/{code}?token={delete_token}
```

**鉴权方式（满足任一即可）：**

1. 匿名创建者：携带 `delete_token` 查询参数
2. 登录用户：携带 `Authorization: Bearer <token>` 请求头，且是分享的创建者

**请求示例：**

```bash
curl -X DELETE "http://39.107.52.250/api/shares/aB3xK9mZ?token=abc123..."
```

**响应示例（200）：**

```json
{
  "detail": "分享已销毁"
}
```

---

## 三、文件分享

### 3.1 上传文件

```
POST /api/files
```

**请求体（multipart/form-data）：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| file | file | 是 | 文件，最大 100MB |
| expires_in | int | 否 | 有效期（秒），1～31536000 |
| max_views | int | 否 | 最大访问次数，1～100000 |

**请求示例：**

```bash
curl -X POST http://39.107.52.250/api/files \
  -F "file=@photo.jpg" \
  -F "expires_in=86400" \
  -F "max_views=10"
```

**响应示例（200）：**

```json
{
  "code": "xY7mP2qR",
  "url": "http://39.107.52.250/s/xY7mP2qR",
  "delete_token": "xyz789...",
  "expires_at": "2026-09-08T14:00:00",
  "max_views": 10
}
```

**错误码：**

| 状态码 | 说明 |
|--------|------|
| 413 | 文件超过 100MB 限制 |
| 422 | 空文件或参数超出范围 |

### 3.2 下载文件

```
GET /api/files/{code}/download
```

> 会消耗一次访问次数。如果这是最后一次访问，文件会在下载完成后自动焚毁，响应头中会包含 `X-Burned: true`。

**响应：** 文件二进制流，Content-Type 为原始文件的 MIME 类型。

**请求示例：**

```bash
curl -O -J "http://39.107.52.250/api/files/xY7mP2qR/download"
```

---

## 四、用户系统（可选）

### 4.1 注册

```
POST /api/auth/register
```

**请求体（JSON）：**

```json
{
  "username": "alice",
  "password": "mypassword123"
}
```

**约束：** 用户名 3-32 位（字母/数字/下划线/中文），密码 6-128 位。

**响应示例（200）：**

```json
{
  "token": "eyJhbGciOi...",
  "username": "alice"
}
```

**错误码：** 409 用户名已被占用。

### 4.2 登录

```
POST /api/auth/login
```

**请求体（JSON）：**

```json
{
  "username": "alice",
  "password": "mypassword123"
}
```

**响应示例（200）：**

```json
{
  "token": "eyJhbGciOi...",
  "username": "alice"
}
```

### 4.3 获取当前用户信息

```
GET /api/auth/me
Authorization: Bearer <token>
```

**响应示例（200）：**

```json
{
  "id": 1,
  "username": "alice",
  "created_at": "2026-09-07T14:00:00"
}
```

### 4.4 我的分享列表

```
GET /api/auth/my-shares
Authorization: Bearer <token>
```

**响应示例（200）：**

```json
[
  {
    "code": "aB3xK9mZ",
    "url": "http://39.107.52.250/s/aB3xK9mZ",
    "content_type": "text",
    "preview": "Hello World",
    "file_name": null,
    "file_size": null,
    "created_at": "2026-09-07T14:00:00",
    "expires_at": null,
    "view_count": 3,
    "max_views": null
  }
]
```

> 返回最近 50 条分享，按创建时间倒序。

---

## 五、健康检查

```
GET /api/health
```

**响应示例（200）：**

```json
{
  "status": "ok",
  "app": "ClipVault"
}
```

---

## 六、前端页面

| 路径 | 说明 |
|------|------|
| `GET /` | 首页（创建分享） |
| `GET /s/{code}` | 查看分享（文本预览 / 文件下载 / 二维码） |

前端页面由 FastAPI + Jinja2 服务端渲染，静态资源托管在 `/static/` 路径下。支持移动端响应式布局。