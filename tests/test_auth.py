"""用户系统 API 集成测试"""
import json
import urllib.request

BASE = "http://127.0.0.1:8000"


def api(method, path, data=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}


# 1. 注册
st, r = api("POST", "/api/auth/register", {"username": "tester", "password": "secret123"})
print(f"1) register: {st} username={r.get('username')}")
token = r.get("token", "")

# 2. 重复注册 → 409
st, r = api("POST", "/api/auth/register", {"username": "tester", "password": "secret123"})
print(f"2) duplicate register: {st} detail={r.get('detail')}")

# 3. 错误密码登录 → 401
st, r = api("POST", "/api/auth/login", {"username": "tester", "password": "wrong"})
print(f"3) wrong password: {st} detail={r.get('detail')}")

# 4. 正确登录
st, r = api("POST", "/api/auth/login", {"username": "tester", "password": "secret123"})
print(f"4) login: {st}")

# 5. me（带 token）
st, r = api("GET", "/api/auth/me", token=token)
print(f"5) me: {st} username={r.get('username')}")

# 6. me（无 token → 401）
st, r = api("GET", "/api/auth/me")
print(f"6) me without token: {st} detail={r.get('detail')}")

# 7. 登录状态创建分享（关联 user）
st, r = api("POST", "/api/shares", {"content": "user-owned share", "content_type": "text", "expires_in": 600}, token=token)
print(f"7) create with token: {st} code={r.get('code')}")
code = r.get("code", "")

# 8. 匿名创建
st, r = api("POST", "/api/shares", {"content": "anon share", "content_type": "text", "expires_in": 600})
print(f"8) create anonymous: {st} code={r.get('code')}")
anon_code = r.get("code", "")

# 9. my-shares 应包含登录用户的分享，不含匿名的
st, r = api("GET", "/api/auth/my-shares", token=token)
codes = [s["code"] for s in r]
print(f"9) my-shares: {st} count={len(r)} contains_user={code in codes} contains_anon={anon_code in codes}")

# 10. 登录用户用自己的身份销毁自己的分享（DELETE 不带 token 参数）
st, r = api("DELETE", f"/api/shares/{code}", token=token)
print(f"10) destroy by owner: {st} detail={r.get('detail')}")

# 11. 匿名销毁别人的分享 → 403
st, r = api("DELETE", f"/api/shares/{anon_code}")
print(f"11) destroy without auth: {st} detail={r.get('detail')}")

# 12. 短用户名 → 422
st, r = api("POST", "/api/auth/register", {"username": "ab", "password": "secret123"})
print(f"12) short username: {st}")

# 13. 弱密码 → 422
st, r = api("POST", "/api/auth/register", {"username": "newuser_ok", "password": "123"})
print(f"13) weak password: {st}")
