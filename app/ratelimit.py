"""轻量内存限流中间件：滑动窗口 + 按客户端 IP 计数，单机部署足够。

真实 IP 依赖 uvicorn --proxy-headers 解析 Nginx 的 X-Forwarded-For。
"""
import time
from collections import defaultdict, deque

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class RateLimitMiddleware(BaseHTTPMiddleware):
    # (方法, 路径前缀, 窗口秒数, 窗口内最大次数, 提示语)，先匹配先生效
    RULES = [
        ("POST", "/api/files", 600, 20, "上传太频繁，请稍后再试"),
        ("POST", "/api/shares", 600, 30, "创建太频繁，请稍后再试"),
        ("POST", "/api/auth", 600, 20, "尝试太频繁，请稍后再试"),
        ("GET", "/api/", 60, 120, "请求太频繁，请稍后再试"),
    ]

    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[tuple, deque] = defaultdict(deque)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        for method, prefix, window, max_hits, msg in self.RULES:
            if request.method != method or not path.startswith(prefix):
                continue
            ip = request.client.host if request.client else "unknown"
            key = (method, prefix, ip)
            now = time.monotonic()
            q = self._hits[key]
            while q and q[0] <= now - window:
                q.popleft()
            if len(q) >= max_hits:
                return JSONResponse({"detail": msg}, status_code=429)
            q.append(now)
            break

        # 防止冷门 IP 的队列永久占用内存
        if len(self._hits) > 10000:
            cutoff = time.monotonic() - 600
            for k in [k for k, q in self._hits.items() if not q or q[-1] < cutoff]:
                del self._hits[k]

        return await call_next(request)
