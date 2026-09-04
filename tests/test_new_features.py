"""新功能验证：自定义有效期/次数 + 限流"""
import json
import os
import urllib.request
import urllib.error

BASE = os.environ.get("BASE", "http://127.0.0.1:8001")


def api(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


# 1. 自定义有效期 45 分钟 + 自定义次数 7
st, r = api("POST", "/api/shares", {"content": "custom", "expires_in": 2700, "max_views": 7})
assert st == 201 or st == 200, r
from datetime import datetime, timezone
exp = datetime.fromisoformat(r["expires_at"]).replace(tzinfo=timezone.utc)
delta = exp - datetime.now(timezone.utc)
ok = 2690 < delta.total_seconds() <= 2700
print(f"1) 自定义 45 分钟 + 7 次: status={st} 有效期差={delta.total_seconds():.0f}s {'✅' if ok else '❌'} max_views={r['max_views']}")

# 2. 自定义有效期 3 天
st, r = api("POST", "/api/shares", {"content": "c3", "expires_in": 259200})
print(f"2) 自定义 3 天: status={st} {'✅' if st in (200,201) else '❌'}")

# 3. 边界：超过 365 天应拒绝
st, r = api("POST", "/api/shares", {"content": "toolong", "expires_in": 366 * 86400})
print(f"3) 366 天拒绝: status={st} {'✅' if st == 422 else '❌'}")

# 4. 边界：max_views 超过上限应拒绝
st, r = api("POST", "/api/shares", {"content": "toomany", "max_views": 100001})
print(f"4) 次数超上限拒绝: status={st} {'✅' if st == 422 else '❌'}")

# 5. 限流：GET 接口连发 125 次，应出现 429
blocked = 0
for _ in range(125):
    req = urllib.request.Request(BASE + "/api/health")
    try:
        urllib.request.urlopen(req)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            blocked += 1
print(f"5) GET 限流: 125 次请求拦截 {blocked} 次 {'✅' if blocked >= 5 else '❌(检查规则)'}")

# 6. POST 限流：连发 32 次创建，应拦截 2 次（窗口 30 次/10分钟）
blocked = 0
for i in range(32):
    st, _ = api("POST", "/api/shares", {"content": f"rl{i}"})
    if st == 429:
        blocked += 1
print(f"6) POST 限流: 32 次创建拦截 {blocked} 次 {'✅' if blocked == 2 else '❌'}")
