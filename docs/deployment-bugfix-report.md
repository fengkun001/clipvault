# ClipVault 部署排障报告

> 项目：ClipVault（匿名分享工具）\
> 服务器：阿里云 ECS，Ubuntu 22.04，2核2G\
> 部署架构：Nginx（80）→ 反向代理 → Uvicorn（127.0.0.1:8000）\
> 日期：2026-09-07

***

## 一、问题概述

项目部署到服务器后，**文本分享功能正常，但文件上传功能全部失败**。浏览器端表现为"网络错误，上传失败"，无论上传什么类型的文件、多大尺寸，均无法成功。

***

## 二、故障一：文件上传 301 重定向死循环

### 2.1 现象

- 浏览器上传文件 → XHR 报"网络错误"

- 服务器端 `curl` 走 Nginx（80 端口）上传 → 返回 `301 Moved Permanently`，Location 指向 `/api/files/`（加斜杠）

- 服务器端 `curl` 直连应用（8000 端口）上传 → 正常返回 `200 OK`

### 2.2 排查过程

**第一层：排除应用层**

```bash
# 直连应用，200 OK —— 应用本身没问题
curl -s -w "HTTP:%{http_code}\n" -F "file=@/tmp/small.txt" http://127.0.0.1:8000/api/files
# → HTTP:200
```

**第二层：确认 Nginx 是 301 的来源**

```bash
curl -v -F "file=@/tmp/small.txt" http://127.0.0.1/api/files 2>&1
```

响应头中 `Server: nginx/1.18.0 (Ubuntu)` 而非 `Server: uvicorn`，说明 301 是 Nginx 自己发出的，**请求根本没有到达应用层**。

**第三层：检查 Nginx 配置**

```bash
sudo nginx -T 2>/dev/null | grep -nE "return|rewrite"
# → 零匹配。配置中没有任何显式的重定向规则。
```

此时矛盾出现：Nginx 发出了 301，但配置里没有任何 `return` 或 `rewrite` 指令。

**第四层：对比 Nginx 访问日志与应用日志**

```bash
sudo tail -5 /var/log/nginx/access.log
# → 127.0.0.1 - - [07/Sep/2026:14:34:42 +0800] "POST /api/files HTTP/1.1" 301 178

journalctl -u clipvault -n 20 --no-pager
# → 没有对应的 POST /api/files 记录
```

Nginx 的 access.log 记录了 301，但应用日志里**完全没有这条请求**——再次确认请求被 Nginx 拦截，未到达应用。

**第五层：定位根因——Nginx 隐式目录规范化重定向**

Nginx 配置中有一个关键的 `location` 块：

```nginx
location /api/files/ {    # ← 注意末尾的斜杠
    proxy_pass http://127.0.0.1:8000;
    ...
}
```

而应用的路由定义是 `POST /api/files`（不带斜杠）。当请求 `POST /api/files` 到达 Nginx 时：

1. `location /api/files/` **不匹配**（前缀匹配，`/api/files` 长度 10，`/api/files/` 长度 11，不够长）
2. 请求落入 `location /`（兜底匹配）
3. Nginx 检测到存在一个以 `/` 结尾的 `location /api/files/`，且请求 URI `/api/files` 恰好是其去掉末尾 `/` 的形式
4. **触发 Nginx 内置的目录规范化重定向**：`301 → Location: /api/files/`

这是 Nginx 源码级行为，极其隐蔽——不需要任何 `return` 或 `rewrite` 指令，Nginx 在内部自动完成。

浏览器收到 301 后的行为链条：

```
浏览器 POST /api/files
  → Nginx 301 → Location: /api/files/
    → 浏览器跟随 301，将 POST 改为 GET（HTTP 规范要求）
      → Nginx GET /api/files/ → 代理到应用
        → 应用返回 307（Starlette 的 trailing slash redirect）
          → 浏览器 GET /api/files（回到起点）
            → 无限循环 → 浏览器放弃 → 报"网络错误"
```

### 2.3 修复

```diff
- location /api/files/ {
+ location /api/files {
```

去掉 location 末尾的 `/`，使 `POST /api/files` 精确匹配，Nginx 的隐式目录重定向机制不再触发。

### 2.4 为什么文本分享（/api/shares）不受影响

因为 Nginx 配置中**不存在** `location /api/shares/` 块——没有以 `/` 结尾的同名前缀 location，隐式重定向不会触发。`POST /api/shares` 正常落入 `location /` 并代理到应用。

***

## 三、故障二：僵尸进程导致请求间歇性失败

### 3.1 现象

在排查故障一的过程中，直连 8000 端口的上传测试**时好时坏**——有时返回 200，有时返回 301。

### 3.2 排查过程

**检查端口占用：**

```bash
sudo ss -tlnp | grep 8000
```

输出显示 8000 端口上同时绑定了**三个进程**：

```
LISTEN 127.0.0.1:8000  users:(("python3",pid=2126),("python3",pid=2125),("uvicorn",pid=689))
```

其中 pid 689 是 9 月 4 日手动启动的旧 uvicorn 进程，从未被 systemd 管理：

```bash
cat /proc/689/cmdline | tr '\0' ' '
# → /opt/clipvault/venv/bin/python3 /opt/clipvault/venv/bin/uvicorn \
#   app.main:app --host 127.0.0.1 --port 8000 --workers 2 --proxy-headers
```

### 3.3 根因分析

Uvicorn 的多 worker 模式使用 `SO_REUSEPORT` 套接字选项，允许多个进程绑定同一端口。内核将入站连接**随机分发**给这三个进程：

- 分到新进程（pid 2125/2126，跑当前代码）→ 200 ✓

- 分到旧进程（pid 689，跑旧代码，旧代码路由不同）→ 301/307 ✗

每次请求有约 1/3 的概率落入旧进程，导致间歇性故障。

### 3.4 为什么旧进程的日志不在 journalctl 里

旧进程是手动启动的（非 systemd 管理），其 stdout/stderr 输出到了启动它的终端会话，而非 systemd journal。因此 `journalctl -u clipvault` 看不到旧进程产生的任何日志——这进一步增加了排查难度。

### 3.5 修复

**即时修复：**

```bash
sudo systemctl stop clipvault
sudo fuser -k 8000/tcp    # 杀掉所有占用 8000 的进程
sudo systemctl start clipvault
```

**工程化防御（写入部署脚本）：**

```bash
# deploy.sh 中新增：部署前清理所有残留的 8000 端口进程
fuser -k 8000/tcp 2>/dev/null || true
systemctl enable clipvault
systemctl restart clipvault
```

确保每次部署都是"干净启动"，僵尸进程从此无法存活。

***

## 四、故障三：Nginx 配置未生效（reload vs restart）

### 4.1 现象

修改了 Nginx 配置文件后执行 `systemctl reload nginx`，但问题依旧。`nginx -T` 显示配置已更新，但实际运行的仍是旧配置。

### 4.2 根因

`systemctl reload nginx` 在某些情况下不会完全重新加载配置——特别是当 worker 进程持有旧连接时，新配置可能延迟生效或根本不生效。

### 4.3 修复

```diff
- systemctl reload nginx
+ # 用 restart 而非 reload：确保运行中的配置与磁盘一致，避免"改了配置没生效"
+ systemctl restart nginx
```

`restart` 会彻底终止所有 worker 进程并重新启动，保证内存中的配置与磁盘文件完全一致。

***

## 五、跨平台兼容性：Windows 换行符问题

### 5.1 现象

在 Windows 上编辑的 `deploy.sh` 上传到 Linux 服务器后执行报错：

```
$'\r': command not found
```

### 5.2 根因

Windows 使用 CRLF（`\r\n`）换行，Linux 使用 LF（`\n`）。bash 将 `\r` 解释为命令名的一部分，导致语法错误。

### 5.3 修复

部署脚本中已加入预处理步骤：

```bash
sed -i 's/\r$//' deploy/deploy.sh deploy/clipvault.service deploy/nginx.conf
```

***

## 六、工程规范总结

### 6.1 分层诊断方法论

本次排障严格遵循了"分层隔离"原则，每次只改变一个变量：

```
浏览器 → [Nginx:80] → [Uvicorn:8000] → 应用代码
          ↑ 测试点3      ↑ 测试点2       ↑ 测试点1
```

| 测试 | 操作           | 结果       | 结论              |
| -- | ------------ | -------- | --------------- |
| 1  | curl 直连 8000 | 200      | 应用无问题           |
| 2  | curl 连 80    | 301      | 问题在 Nginx 层     |
| 3  | 检查 Nginx 日志  | 有 301 记录 | Nginx 自己产生的 301 |
| 4  | 检查应用日志       | 无对应请求    | 请求未到达应用         |

**关键原则：先证明"谁没病"，再聚焦"谁有病"。** 不猜测，用证据说话。

### 6.2 防御性部署清单

每次部署应确保：

- [ ] 部署前清理目标端口上的所有残留进程（`fuser -k`）

- [ ] 使用 `restart` 而非 `reload` 使配置生效

- [ ] 处理跨平台换行符差异

- [ ] 部署后执行端到端验证（curl 模拟真实请求）

- [ ] 检查 `ss -tlnp` 确认端口占用状态符合预期

### 6.3 配置即代码

所有部署配置（Nginx、systemd、部署脚本）均纳入 Git 版本管理。任何修改都经过"本地修改 → 提交 → 推送 → 服务器拉取 → 部署"的完整链路，确保：

- 可追溯：每次变更都有 commit 记录

- 可复现：新服务器可一键部署

- 可回滚：出问题随时 revert

***

## 七、心得体会

### 7.1 关于 Nginx

Nginx 是一个高度工程化的软件，但它的某些"智能"行为（如隐式目录重定向）在特定场景下会变成陷阱。理解工具的内部机制比记住配置语法更重要——同样的 `location /api/files/` 配置，在静态文件服务中是正确写法，在反向代理场景下就是致命 Bug。

### 7.2 关于进程管理

`SO_REUSEPORT` 是一把双刃剑——它让多进程负载均衡成为可能，但也让僵尸进程难以被发现。**永远不要让手动启动的进程和 systemd 管理的进程共存于同一端口。** 部署脚本中的 `fuser -k` 是最后一道防线。

### 7.3 关于排障心态

最危险的不是找不到 Bug，而是"以为找到了 Bug"。本次排查中，我一度确信 301 是旧配置未 reload 导致的，但 `restart` 后问题依旧——这个假设被推翻。只有持续用证据检验假设，才能逼近真相。

### 7.4 关于工程素养

三个 Bug 的修复都做到了"治本"而非"治标"：

- 不是手动改服务器配置，而是修改部署脚本和配置模板

- 不是手动杀进程，而是在部署脚本中加入防御逻辑

- 不是记录一条"注意事项"，而是将修复写入代码仓库

**"修一次"是运维，"修到不会再犯"才是工程。**

***

## 八、附录：关键命令速查

```bash
# 端口占用诊断
sudo ss -tlnp | grep <port>

# 进程启动命令回溯
cat /proc/<pid>/cmdline | tr '\0' ' '

# Nginx 完整配置查看
sudo nginx -T 2>/dev/null

# Nginx 最近错误日志
sudo tail -20 /var/log/nginx/error.log

# 应用日志（systemd 管理）
journalctl -u clipvault -n 50 --no-pager

# 清理端口占用
sudo fuser -k <port>/tcp

# 分层验证
curl -s -w "HTTP:%{http_code}\n" -F "file=@/tmp/test.txt" http://127.0.0.1:8000/api/files   # 直连应用
curl -s -w "HTTP:%{http_code}\n" -F "file=@/tmp/test.txt" http://127.0.0.1/api/files        # 经 Nginx
```

<br />
