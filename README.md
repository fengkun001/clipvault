# 📋 ClipVault · 云剪切板分享系统

> 轻量级、隐私优先的跨设备内容分享工具 —— 粘贴即分享，阅后即焚。

一个类似「阅后即焚版 Pastebin」的 Web 应用：把文本或文件变成一条短链接 + 二维码，手机扫码秒取，支持有效期、访问次数限制与端到端加密。服务器**匿名化设计**，不记录任何用户身份信息。

## ✨ 功能特性

### 核心功能（MVP）
- **文本分享**：粘贴内容 → 生成 8 位短码链接 + 二维码，多设备扫码即取
- **有效期控制**：1 小时 / 24 小时 / 7 天 / 永久，过期后禁止访问并自动物理删除
- **访问次数限制**：1 次 / 5 次 / 无限制，达到上限后立即烧毁（阅后即焚）
- **完全匿名**：无需注册即可使用，数据库不存 IP、不存身份，只有内容与时间
- **跨设备响应式**：同一页面自适应手机 / 平板 / 电脑浏览器
- **手动销毁**：创建者持有销毁令牌（仅存于本设备），可随时一键焚毁

### 创新点
| 创新点 | 说明 |
|---|---|
| 🪄 **内容类型自动识别** | 前端启发式打分自动区分纯文本 / Markdown / 代码，按类型选择渲染方式 |
| 📝 **Markdown 渲染 + 代码高亮** | marked.js 渲染 + highlight.js 自动语言检测 + DOMPurify 白名单清洗，双重防 XSS |
| 📎 **文件分享** | 100MB 内任意文件，服务器生成随机存储名（彻底隔离用户输入，杜绝路径遍历），流式上传下载 |
| 🔐 **端到端加密（E2E）** | 浏览器内 AES-256-GCM 加密，密钥只存于 URL `#` 锚点（不会发送到服务器），服务器只见密文 |
| 👤 **可选账号系统** | 注册 / 登录（JWT）后可在云端管理分享、查看访问统计；匿名使用完全不受影响 |

### 安全设计
- **短码防猜测**：`secrets` 密码学安全随机生成 Base62 短码，8 位达 62⁸ ≈ 2.2×10¹⁴ 种组合
- **XSS 纵深防御**：后端 CSP 安全响应头 + 前端 `textContent` 渲染 + Markdown 场景 DOMPurify 清洗
- **密码安全存储**：PBKDF2-SHA256，26 万轮迭代 + 随机盐，零第三方依赖（标准库实现）
- **并发安全的计数**：`UPDATE ... WHERE view_count < max_views` 原子递增，并发下也不会突破上限
- **隐私友好日志**：访问日志只记录时间戳，不记录 IP

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
| POST | `/api/shares` | 创建文本分享（内容/类型/有效期/次数） |
| GET | `/api/shares/{code}` | 获取内容（消耗一次访问，原子计数） |
| GET | `/api/shares/{code}/meta` | 元信息（不消耗次数） |
| DELETE | `/api/shares/{code}?token=` | 凭销毁令牌焚毁（登录态亦可） |
| POST | `/api/files` | 上传文件分享（multipart，≤100MB） |
| GET | `/api/files/{code}/download` | 下载文件（消耗次数） |
| POST | `/api/auth/register` / `login` | 注册 / 登录（返回 JWT） |
| GET | `/api/auth/my-shares` | 我的分享列表（含访问统计） |

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
│   ├── security.py      # 短码/令牌生成（secrets）
│   ├── services.py      # burn_share 等跨模块服务
│   └── routers/
│       ├── share.py     # 文本分享 API
│       ├── files.py     # 文件上传下载 API
│       └── auth.py      # 用户注册登录 API
├── static/              # 前端（自托管库，零 CDN）
├── templates/           # Jinja2 页面
├── tests/               # 集成测试脚本
├── deploy/              # nginx.conf / systemd / 一键部署脚本
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

## 📚 更多文档

- [系统设计与技术选型](docs/系统设计.md)
- [部署指南（含 HTTPS 配置）](docs/部署指南.md)
- [开发心得与问题解决记录](docs/开发心得.md)

---

> 暑期技能提升项目 · FastAPI + SQLite + 原生 JS 全栈实践
