import json
import os
import urllib.request

BASE = os.environ.get("BASE", "http://127.0.0.1:8000")


def api(method, path, data=None):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method,
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


# 1. 创建：max_views=3
st, r = api("POST", "/api/shares", {"content": "counter test 中文",
                                     "content_type": "text",
                                     "expires_in": 600, "max_views": 3})
code = r["code"]
print("1) created:", code)

# 2. 访问3次
for i in range(3):
    st, d = api("GET", f"/api/shares/{code}")
    print(f"2.{i+1}) visit -> status={st} view_count={d.get('view_count')} content={d.get('content')!r}")

# 3. 第4次应失败
st, d = api("GET", f"/api/shares/{code}")
print(f"3) after burn -> status={st} detail={d.get('detail')}")

# 4. XSS 测试：存储原文，API 原样返回（转义在展示层做）
st, r = api("POST", "/api/shares", {"content": "<script>alert(1)</script> & <b>bold</b>",
                                    "content_type": "text", "expires_in": 600})
xss_code = r["code"]
st, d = api("GET", f"/api/shares/{xss_code}")
print(f"4) XSS raw passthrough -> status={st} content={d.get('content')!r}")

# 5. 过期测试：创建一个 1 秒过期的
st, r = api("POST", "/api/shares", {"content": "expire test", "content_type": "text",
                                    "expires_in": 1, "max_views": None})
exp_code = r["code"]
import time
time.sleep(2)
st, d = api("GET", f"/api/shares/{exp_code}")
print(f"5) expired -> status={st} detail={d.get('detail')}")

# 6. 非法参数：expires_in 超范围
st, d = api("POST", "/api/shares", {"content": "x", "content_type": "text",
                                    "expires_in": 99999999999, "max_views": None})
print(f"6) invalid expiry -> status={st} detail={d.get('detail')}")

# 7. 空内容
st, d = api("POST", "/api/shares", {"content": "", "content_type": "text"})
print(f"7) empty content -> status={st} detail={d.get('detail')}")
