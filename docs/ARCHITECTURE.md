# ClipVault 系统架构与技术选型

## 一、系统概述

ClipVault 是一个**轻量级匿名云剪切板分享系统**，支持文本、Markdown、代码、文件（图片/音视频等）的临时分享。核心功能包括：短链生成、阅后即焚、有效期控制、访问次数限制、端到端加密（可选），以及用户系统（可选登录）。

**设计原则：** 匿名优先、隐私无害、部署简单、源码透明。

---

## 二、技术栈总览

| 层级 | 技术 | 版本 | 选型理由 |
|------|------|------|----------|
| **Web 框架** | FastAPI | 0.115 | 异步原生支持、自动 OpenAPI 文档、Pydantic 类型校验、性能接近 Node.js |
| **ASGI 服务器** | Uvicorn | 0.34 | FastAPI 官方推荐，支持多 worker、--proxy-headers |
| **ORM** | SQLAlchemy | 2.0 | Python 生态最成熟的 ORM，2.0 风格查询语法 |
| **数据库** | SQLite | - | 零配置、单文件、免运维；项目规模下性能完全够用 |
| **模板引擎** | Jinja2 | 3.1 | FastAPI 内置支持，服务端渲染前端页面 |
| **密码哈希** | PBKDF2-SHA256 | - | Python 标准库 `hashlib` 原生实现，26万轮迭代，无额外依赖 |
| **JWT** | PyJWT | 2.13 | 轻量、无状态、适合可选登录场景 |
| **文件处理** | aiofiles + python-multipart | - | 异步文件读写 + multipart/form-data 解析 |
| **反向代理** | Nginx | 1.18 | 生产环境标配：静态资源缓存、连接复用、限流、HTTPS 终结 |
| **进程管理** | systemd | - | Linux 标准服务管理器，开机自启、崩溃重启 |

---

## 三、为什么选择这个技术栈

### 3.1 为什么是 FastAPI 而不是 Flask/Django

| 维度 | FastAPI | Flask | Django |
|------|---------|-------|--------|
| 异步支持 | 原生 async/await | 需扩展 | 3.1+ 支持 |
| 自动 API 文档 | Swagger + ReDoc，零配置 | 需插件 | 需 DRF |
| 类型校验 | Pydantic 自动校验 | 手动 | Serializer |
| 学习曲线 | 中 | 低 | 高 |
| 本项目匹配度 | ★★★★★ | ★★★★ | ★★ |

**决策：** 项目需要异步文件上传（大文件流式写入），且需要自动生成 API 文档用于前后端联调。FastAPI 的 Pydantic 模型在请求校验阶段就能拦截非法输入，省去大量手写校验代码。Django 太"重"——ORM、模板、中间件全家桶对一个小型工具来说过度设计了。

### 3.2 为什么是 SQLite 而不是 PostgreSQL/MySQL

**这是项目中最容易在面试时被质疑的选型，以下是我的完整论证：**

1. **部署复杂度**：SQLite 零配置，`pip install` 完就能跑。PostgreSQL 需要安装、建库、配用户权限、开端口——对"一个人 20 小时"的项目预算来说，运维成本不值得。
2. **性能边界**：SQLite 在单表 10 万行以内、并发写入 < 50 QPS 时性能不输 PostgreSQL。本项目是匿名分享工具，单机部署，并发量远低于这个阈值。
3. **数据安全**：单文件数据库，备份只需 `cp clipvault.db clipvault.db.bak`。没有独立的数据库进程，不存在"数据库挂了但应用还活着"的故障模式。
4. **迁移成本**：SQLAlchemy 抽象了数据库差异。如果未来用户量增长到需要 PostgreSQL，只需改一行 `DATABASE_URL` 环境变量，ORM 代码无需修改。

**一句话总结：** 用 SQLite 不是"偷懒"，而是在项目当前阶段做了正确的工程取舍——用最小的运维成本满足所有需求，同时保留了未来升级的平滑路径。

### 3.3 为什么是服务端渲染（Jinja2）而不是前后端分离（React/Vue）

1. **项目性质**：ClipVault 是一个工具型应用，页面数少（首页 + 查看页），交互简单（表单 + 二维码 + 下载），不需要 SPA 的客户端路由和状态管理。
2. **SEO 与分享体验**：分享链接被爬虫抓取时，服务端渲染可直接返回内容预览（Open Graph 标签），而 SPA 需要 SSR 中间层。
3. **开发效率**：一个人全栈开发，前后端分离意味着需要维护两套构建工具链、处理 CORS、管理 API 版本。服务端渲染一个 `pip install` 全搞定。
4. **首屏速度**：服务端渲染的 HTML 直出，无白屏等待，对移动端弱网环境更友好。

### 3.4 为什么是 PBKDF2 而不是 bcrypt/argon2

- **bcrypt** 需要安装 `bcrypt` 包，在 Windows 上编译依赖 C 扩展，经常出问题
- **argon2** 依赖更重
- **PBKDF2-SHA256** 是 Python 标准库 `hashlib` 内置算法，零额外依赖，26 万轮迭代已足够安全

对于非金融级应用，PBKDF2 是"够用且不惹麻烦"的最优解。

---

## 四、系统架构

### 4.1 部署拓扑

```
互联网（公网 IP: 39.107.52.250）
    │
    ▼
┌─────────────────────────────────┐
│  Nginx (port 80)                │
│  ┌─ location /           → 反代 │
│  └─ location /api/files  → 反代 │  proxy_read_timeout 300s
│     client_max_body_size 100m   │  proxy_buffering off
└───────────┬─────────────────────┘
            │ 127.0.0.1:8000
            ▼
┌─────────────────────────────────┐
│  Uvicorn (2 workers)            │
│  --proxy-headers                │
│  --host 127.0.0.1               │  ← 不直接暴露公网
│                                 │
│  ┌───────────────────────────┐  │
│  │  FastAPI 应用              │  │
│  │  ├─ RateLimitMiddleware    │  │
│  │  ├─ SecurityHeaders        │  │
│  │  ├─ routers/share.py       │  │
│  │  ├─ routers/files.py       │  │
│  │  ├─ routers/auth.py        │  │
│  │  ├─ StaticFiles (/static)  │  │
│  │  └─ Jinja2 Templates       │  │
│  └───────────┬───────────────┘  │
│              │                   │
│  ┌───────────▼───────────────┐  │
│  │  SQLite (clipvault.db)     │  │
│  │  + uploads/ 目录           │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

### 4.2 分层架构

```
┌──────────────────────────────────────┐
│  前端层（templates/ + static/）       │
│  Jinja2 SSR + 原生 JS + QRCode + 代码高亮 │
├──────────────────────────────────────┤
│  路由层（app/routers/）               │
│  share.py  files.py  auth.py          │
├──────────────────────────────────────┤
│  中间件层                              │
│  RateLimitMiddleware  SecurityHeaders  │
├──────────────────────────────────────┤
│  业务逻辑层（app/services.py）          │
│  阅后即焚 过期清理 文件管理             │
├──────────────────────────────────────┤
│  认证层（app/auth.py）                 │
│  PBKDF2 密码哈希  JWT 签发/校验        │
├──────────────────────────────────────┤
│  数据层（app/models.py）               │
│  SQLAlchemy ORM  →  SQLite            │
│  + uploads/ 文件系统                   │
└──────────────────────────────────────┘
```

### 4.3 数据模型

```
┌──────────┐       ┌──────────────────┐       ┌────────────┐
│   User   │       │      Share       │       │ AccessLog  │
├──────────┤       ├──────────────────┤       ├────────────┤
│ id (PK)  │──┐    │ id (PK)          │──┐    │ id (PK)    │
│ username │  │    │ code (唯一索引)    │  │    │ share_id   │
│ pwd_hash │  │    │ user_id (FK) ────┘  │    │ accessed_at│
│ crt_at   │  │    │ content_type      │    └────────────┘
└──────────┘  │    │ content (text)     │
              └────│ file_path          │    ← 服务器内部存储路径
                   │ file_name          │    ← 原始文件名（展示）
                   │ file_size          │
                   │ file_mime          │
                   │ delete_token       │    ← 创建者凭此销毁
                   │ expires_at         │    ← NULL = 永久
                   │ max_views          │    ← NULL = 不限
                   │ view_count         │    ← 原子递增
                   │ created_at         │
                   └───────────────────┘
```

**设计要点：**

- `user_id` 可为 NULL：匿名分享是核心功能，登录是可选的
- `delete_token` 与 `user_id` 双通道鉴权：匿名创建者凭 token 删，登录用户凭身份删
- `file_path` 存储的是服务器生成的 UUID 文件名，与用户原始文件名完全隔离，杜绝路径遍历攻击
- `AccessLog` 不记录 IP：隐私优先，只记录访问时间和次数

---

## 五、安全设计

### 5.1 纵深防御体系

| 层级 | 措施 | 防御目标 |
|------|------|----------|
| 传输层 | Nginx 反代、未来配 HTTPS | 中间人攻击 |
| 网络层 | 应用只监听 127.0.0.1 | 公网直接访问 |
| 应用层 | CSP / X-Content-Type-Options / X-Frame-Options / Referrer-Policy | XSS、点击劫持 |
| 输入层 | Pydantic 类型校验、文件名清洗、路径隔离 | 注入、路径遍历 |
| 输出层 | `textContent` 渲染（非 innerHTML）、DOMPurify 净化 | XSS |
| 数据层 | SQLAlchemy 参数化查询（非字符串拼接） | SQL 注入 |
| 认证层 | PBKDF2 26万轮 + JWT + `secrets.compare_digest` | 密码破解、时序攻击 |
| 频率层 | 滑动窗口限流（按 IP + 端点） | 暴力攻击、资源滥用 |
| 业务层 | 短码 `secrets.choice` 而非自增 ID | 遍历猜测 |
| 运维层 | 应用以 www-data 用户运行、最小权限 | 提权攻击 |

### 5.2 短码安全设计

- **生成方式**：`secrets.choice`（密码学安全随机），非 `random.choice`
- **字母表**：Base62（a-z, A-Z, 0-9），62⁸ ≈ 2.18 × 10¹⁴ 种组合
- **碰撞处理**：重试 5 次，极端情况下返回 500
- **为什么不自增**：自增 ID 可被遍历猜测，短码必须不可预测

### 5.3 阅后即焚的并发安全

关键代码（share.py 第 111-124 行）：

```python
result = db.execute(
    update(Share)
    .where(
        Share.id == share.id,
        or_(Share.max_views.is_(None), Share.view_count < Share.max_views),
    )
    .values(view_count=Share.view_count + 1)
)
if result.rowcount == 0:
    # 并发下另一个请求已经消耗了最后一次
    _burn(db, share)
```

`WHERE view_count < max_views` 在数据库层面保证了原子性——两个并发请求同时到达时，只有第一个能成功递增，第二个的 `rowcount` 为 0，触发焚毁。这是基于 **乐观锁（Optimistic Locking）** 的并发控制，无需显式事务或行锁。

---

## 六、关键设计决策

### 6.1 惰性删除 + 定时清理

过期分享不会在每个请求时检查所有记录，而是：
- **惰性删除**：访问时检查，过期当场焚毁
- **定时清理**：每 300 秒后台任务清理一次

这样避免了"为每条过期记录开一个定时器"的资源浪费。

### 6.2 文件下载的"最后一次"处理

阅后即焚的文件下载：使用 Starlette 的 `BackgroundTask`，在响应发送完成后再清理磁盘文件，避免 Windows 下的文件占用冲突。

### 6.3 安全响应头中间件

```python
@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; ..."
    )
    return response
```

CSP 策略是 XSS 防御的"最后一道防线"——即使前端代码有漏洞，CSP 也能阻止恶意脚本执行。