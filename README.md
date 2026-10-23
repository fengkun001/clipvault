# 📋 ClipVault · 云剪切板分享系统

> 轻量级、隐私优先的跨设备内容分享工具 —— 粘贴即分享，阅后即焚。

**🟢 在线演示**：[http://39.107.52.250](http://39.107.52.250)

一个类似「阅后即焚版 Pastebin」的 Web 应用：把文本或文件变成一条短链接 + 二维码，手机扫码秒取，支持有效期、访问次数限制与端到端加密。服务器**匿名化设计**，不记录任何用户身份信息。

最新版本还支持**可选描述**（列表里一眼认出内容）、**日间/夜间主题切换**，以及登录后的**多设备实时同步**（SSE 推送，无需手动刷新）。

## ✨ 功能特性

### 核心功能（MVP）
- **文本分享**：粘贴内容 → 生成 8 位短码链接 + 二维码，多设备扫码即取
- **有效期控制**：1 小时 / 24 小时 / 7 天 / 永久，**或自定义任意时长**（分钟/小时/天，最长 365 天），过期后禁止访问并自动物理删除
- **访问次数限制**：1 次 / 5 次 / 无限制，**或自定义任意次数**（1–100000），达到上限后立即烧毁（阅后即焚）
- **完全匿名**：无需注册即可使用，数据库不存 IP、不存身份，只有内容与时间
- **跨设备响应式**：同一页面自适应手机 / 平板 / 电脑浏览器
- **手动销毁**：创建者持有销毁令牌（仅存于本设备），可随时一键焚毁
- **可选标题 / 描述**：创建分享时可填一句标题，列表里一眼认出内容，不用逐个点开；加密分享的标题会与正文共用密钥一并加密
- **日间 / 夜间主题**：一键切换并记住选择，首屏由 `theme-init.js` 提前同步执行，无白屏闪烁
- **多设备实时同步**：登录后同一账号在其他设备的增删、访问次数变化会自动刷新列表（SSE 推送），无需手动刷新

### 创新点
| 创新点 | 说明 |
|---|---|
| 🪄 **内容类型自动识别** | 前端启发式打分自动区分纯文本 / Markdown / 代码，按类型选择渲染方式 |
| 📝 **Markdown 渲染 + 代码高亮** | marked.js 渲染 + highlight.js 自动语言检测 + DOMPurify 白名单清洗，双重防 XSS |
| 📎 **文件分享 + 在线预览** | 100MB 内任意文件，服务器生成随机存储名（彻底隔离用户输入，杜绝路径遍历），流式上传下载；图片/音视频直接在查看页内联预览，不双倍扣次数 |
| 🔐 **端到端加密（E2E）** | HTTPS 下用 Web Crypto API（AES-256-GCM，硬件加速）；**HTTP 下自动降级为纯 JS 实现的 AES-256-CBC + HMAC-SHA256**，非 HTTPS 环境也能加密 |
| 👤 **可选账号系统** | 注册 / 登录（JWT）后可在云端管理分享、查看访问统计；匿名使用完全不受影响 |
| 🛡️ **滑动窗口限流** | 创建 30次/10分、上传 20次/10分、读取 120次/分，纯内存实现，零外部依赖 |
| 📤 **上传进度条** | XHR 驱动的实时上传进度，大文件可视化反馈 |
| 📡 **SSE 实时同步** | 每 2 秒比对数据库聚合签名 `(COUNT, MAX(id), SUM(view_count))`，多 worker 部署下同样有效；Nginx 侧关闭缓冲、长连接不超时 |
| 🎨 **无闪烁主题** | CSS 变量 + `html[data-theme]`，初始化脚本在样式表之前同步执行，深/浅色首屏都不闪 |

### 安全设计
- **短码防猜测**：`secrets` 密码学安全随机生成 Base62 短码，8 位达 62⁸ ≈ 2.2×10¹⁴ 种组合
- **XSS 纵深防御**：后端 CSP 安全响应头 + 前端 `textContent` 渲染 + Markdown 场景 DOMPurify 清洗
- **密码安全存储**：PBKDF2-SHA256，26 万轮迭代 + 随机盐，零第三方依赖（标准库实现）
- **并发安全的计数**：`UPDATE ... WHERE view_count < max_views` 原子递增，并发下也不会突破上限
- **滑动窗口限流**：基于 IP 的内存限流，防止短码爆破和接口滥用
- **隐私友好日志**：访问日志只记录时间戳，不记录 IP
- **后台自动清理**：每 5 分钟扫描，物理删除过期和次数用尽的分享（记录 + 文件）

## 🛠 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 后端 | Python 3.10 + FastAPI | 自带 Swagger 交互式 API 文档，类型安全，异步高性能 |
| ORM / 数据库 | SQLAlchemy 2.0 + SQLite | 零配置单文件库，轻量场景够用，业务代码可无缝迁移 PostgreSQL |
| 前端 | 原生 HTML/CSS/JS（无框架） | 单页即用，库本地化（marked/highlight.js/DOMPurify/QRCode 全部自托管，无 CDN 依赖） |
| 认证 | JWT（PyJWT）+ PBKDF2 | 无状态令牌，标准算法 |
| 部署 | Nginx + systemd / Docker | 两种部署方案开箱即用 |

## 🏗 系统架构

```
 浏览器（PC / 手机）
    │  HTTPS
    ▼
 Nginx (80) ──反向代理──► uvicorn :8000 (FastAPI, 2 workers)
                              │
                    ┌─────────┼──────────┐
                    ▼         ▼          ▼
              静态资源    REST API     后台任务
           (static/)  (share/files/  (lifespan 启动，
                          auth)        每 5 分钟清理过期分享)
                    │
                    ▼
              SQLite (clipvault.db)     uploads/（随机名存储）
```

**一次分享的生命周期**：
```
创建 ──► 有效期内 ──► 访问计数原子 +1 ──► 达到上限/过期 ──► 物理删除（记录+文件）
                └──► 手动销毁（delete_token / 登录身份）──► 物理删除
```

## 🚀 快速开始

### 本地运行

```bash
cd clipvault
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
# 打开 http://127.0.0.1:8000
```

### Docker 一键启动

```bash
docker compose up -d --build
# 打开 http://localhost:8000
```

### 云服务器部署（Ubuntu 22.04）

```bash
# 1. 上传整个 clipvault 目录到服务器
scp -r clipvault user@YOUR_SERVER_IP:/tmp/

# 2. 登录服务器执行一键部署
ssh user@YOUR_SERVER_IP
cd /tmp/clipvault && sudo bash deploy/deploy.sh
# 部署完成，浏览器访问 http://YOUR_SERVER_IP
```

> 详细步骤与常见问题见 [docs/部署指南.md](docs/部署指南.md)

## 📖 API 概览

完整交互式文档：启动后访问 **`/docs`**（FastAPI 自动生成）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/shares` | 创建文本分享（内容/类型/有效期/次数/可选标题） |
| GET | `/api/shares/{code}` | 获取内容（消耗一次访问，原子计数） |
| GET | `/api/shares/{code}/meta` | 元信息（不消耗次数） |
| DELETE | `/api/shares/{code}?token=` | 凭销毁令牌焚毁（登录态亦可） |
| POST | `/api/files` | 上传文件分享（multipart，≤100MB，可带 title） |
| GET | `/api/files/{code}/download` | 下载文件（消耗次数） |
| POST | `/api/auth/register` / `login` | 注册 / 登录（返回 JWT） |
| GET | `/api/auth/my-shares` | 我的分享列表（含访问统计与标题） |
| GET | `/api/auth/my-shares/stream` | SSE 实时推送列表变化（需登录） |

## 📁 项目结构

```
clipvault/
├── app/
│   ├── main.py          # FastAPI 入口、中间件、后台清理任务
│   ├── config.py        # 配置（环境变量注入）
│   ├── database.py      # SQLAlchemy 引擎与会话
│   ├── models.py        # User / Share / AccessLog 模型
│   ├── schemas.py       # Pydantic 请求/响应模型
│   ├── auth.py          # PBKDF2 哈希 + JWT 签发校验
│   ├── security.py      # CSP 安全响应头中间件
│   ├── ratelimit.py     # 滑动窗口限流中间件
│   ├── services.py      # burn_share 等跨模块服务
│   └── routers/
│       ├── share.py     # 文本分享 API
│       ├── files.py     # 文件上传下载 API
│       └── auth.py      # 用户注册登录 API
├── static/
│   ├── css/style.css    # 深/浅双主题变量、响应式布局
│   ├── js/
│   │   ├── theme-init.js # 首屏前同步设置主题，避免闪烁
│   │   ├── theme.js      # 主题切换按钮与持久化
│   │   ├── common.js     # 加密/解密、历史存储、authFetch
│   │   ├── index.js      # 主页：创建分享、历史列表、焚毁、SSE 同步
│   │   └── view.js       # 查看页：解密渲染、标题展示
│   └── lib/             # 自托管第三方库（零 CDN 依赖）
│       ├── e2e-fallback.js  # 纯 JS AES-256-CBC（HTTP 环境加密降级）
│       ├── qrcode.min.js    # 二维码生成
│       ├── marked.min.js    # Markdown 渲染
│       ├── purify.min.js     # XSS 过滤
│       └── highlight.min.js  # 代码高亮
├── templates/           # Jinja2 页面
├── tests/               # 集成测试脚本
├── deploy/              # nginx.conf / systemd / 一键部署脚本
├── docs/                # 完整项目文档（架构/API/部署/心得/排障）
├── Dockerfile
└── docker-compose.yml
```

## 🧪 测试

```bash
python tests/test_share.py    # 分享核心：计数/过期/焚毁/参数校验
python tests/test_files.py   # 文件：上传/下载/烧毁/文件名清洗
python tests/test_auth.py    # 用户：注册/登录/权限/归属销毁
node  tests/test_e2e.js      # E2E 加密往返与错误密钥拒绝
```

## 🆕 更新日志

### v1.2.0 · 2026-10-22

| 更新 | 说明 |
|------|------|
| 🎨 日间/夜间主题 | CSS 变量 + `html[data-theme]`，`theme-init.js` 在样式表前同步执行避免闪烁；选择持久化到 localStorage，首次访问跟随系统 |
| 🎨 移动端主题适配 | 手机端主题切换的三重屏障系统性解决：`pointerup` 绑定绕开触摸合成重复点击、`color-scheme: only light` 禁止浏览器 Auto Dark 强制反色、JS/CSS 返回 `no-store` 防止缓存旧脚本 |
| 📝 可选描述 | 创建分享可填一句描述，列表与查看页直接显示；端到端加密分享的描述与正文共用密钥加密，服务器只见密文 |
| 📡 多设备实时同步 | 新增 SSE 端点，按数据库聚合签名轮询，兼容 `--workers 2`；断线指数退避重连，界面显示同步状态 |
| 🗄️ 数据库轻量迁移 | 启动时自动为旧库补 `title` 列，无需手工改表 |
| 🐛 修复缓存导致的“改了没生效” | 页面 HTML 返回 `Cache-Control: no-store`，静态资源加版本参数 |
| 🐛 修复编辑器 BOM 引发启动失败 | 清除 `share.py` 的 UTF-8 BOM（`SyntaxError: U+FEFF`） |

### v1.1.0 · 2026-10-15

- 端到端加密在 HTTP 环境自动降级为纯 JS AES-256-CBC + HMAC
- 自定义有效期 / 访问次数
- 文件分享、图片在线预览、上传进度条
- 云端“我的分享”列表与访问统计

## 📚 更多文档

| 文档 | 说明 |
|------|------|
| [系统架构与技术选型](<docs/系统架构与技术选型理由.md>) | 技术栈对比、选型理由、分层架构、安全设计 |
| [系统设计说明](<docs/系统设计.md>) | 数据模型、核心流程、模块划分 |
| [API 接口文档](<docs/API 接口文档.md>) | 全部端点、请求/响应示例、错误码、限流规则、SSE 协议 |
| [部署步骤与环境配置](<docs/部署步骤与环境配置.md>) | 一键部署、本地开发、环境变量、运维、HTTPS 配置 |
| [部署指南](<docs/部署指南.md>) | Nginx 反代、systemd、常见运维命令 |
| [开发心得](<docs/开发心得.md>) | 乐观锁、限流实现、时序攻击防御、工程原则 |
| [技术突破](<docs/技术突破.md>) | 端到端加密、多 worker 实时同步等关键实现 |
| [部署排障报告](<docs/部署排障报告.md>) | 301 隐式重定向、僵尸进程、reload vs restart |

---

> 暑期技能提升项目 · 由濯辰开发 · FastAPI + SQLite + 原生 JS 全栈实践
