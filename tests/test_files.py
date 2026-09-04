"""文件分享 API 集成测试"""
import io
import json
import os
import time
import urllib.request
import uuid

BASE = os.environ.get("BASE", "http://127.0.0.1:8000")
BOUNDARY = "----ClipVaultTest" + uuid.uuid4().hex[:8]


def build_multipart(fields, file_field, filename, content: bytes):
    parts = []
    for k, v in fields.items():
        parts.append(
            f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode()
        )
    parts.append(
        f'--{BOUNDARY}\r\nContent-Disposition: form-data; name="{file_field}"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n".encode()
    )
    parts.append(content)
    parts.append(f"\r\n--{BOUNDARY}--\r\n".encode())
    return b"".join(parts)


# 1. 上传文件（max_views=2，测试下载后烧毁）
content = b"PDF-like test content \xe4\xb8\xad\xe6\x96\x87\xe6\xb5\x8b\xe8\xaf\x95 " * 100
body = build_multipart({"expires_in": "600", "max_views": "2"}, "file", "test;.txt", content)
req = urllib.request.Request(
    BASE + "/api/files", data=body, method="POST",
    headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"},
)
r = json.loads(urllib.request.urlopen(req).read())
code = r["code"]
print(f"1) uploaded: {code} token={r['delete_token'][:8]}...")

# 2. meta 应显示文件信息（不消耗次数）
m = json.loads(urllib.request.urlopen(f"{BASE}/api/shares/{code}/meta").read())
print(f"2) meta: name={m['file_name']!r} size={m['file_size']} views={m['view_count']}/{m['max_views']}")

# 3. 下载两次
for i in range(2):
    resp = urllib.request.urlopen(f"{BASE}/api/files/{code}/download")
    data = resp.read()
    burned = resp.headers.get("X-Burned")
    print(f"3.{i+1}) download: {len(data)} bytes, match={data == content}, x-burned={burned}")

time.sleep(1)  # 等待后台清理任务执行

# 4. 第三次应 404
try:
    urllib.request.urlopen(f"{BASE}/api/files/{code}/download")
    print("4) ERROR: should be 404")
except urllib.error.HTTPError as e:
    print(f"4) after burn: status={e.code}")

# 5. 超大文件拒绝（>100MB）：用 content-length 欺骗不可行，跳过——验证 0 字节文件
body2 = build_multipart({"expires_in": "600"}, "file", "empty.txt", b"")
req2 = urllib.request.Request(
    BASE + "/api/files", data=body2, method="POST",
    headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"},
)
try:
    urllib.request.urlopen(req2)
    print("5) ERROR: empty file should be rejected")
except urllib.error.HTTPError as e:
    print(f"5) empty file rejected: status={e.code}")

# 6. 恶意文件名清洗（路径遍历尝试）
body3 = build_multipart({"expires_in": "600"}, "file", "..\\..\\evil<script>.txt", b"evil")
req3 = urllib.request.Request(
    BASE + "/api/files", data=body3, method="POST",
    headers={"Content-Type": f"multipart/form-data; boundary={BOUNDARY}"},
)
r3 = json.loads(urllib.request.urlopen(req3).read())
m3 = json.loads(urllib.request.urlopen(f"{BASE}/api/shares/{r3['code']}/meta").read())
print(f"6) sanitized filename: {m3['file_name']!r}")

# 清理
import urllib.parse
req_del = urllib.request.Request(
    f"{BASE}/api/shares/{r3['code']}?token=" + urllib.parse.quote(r3["delete_token"]),
    method="DELETE",
)
resp = urllib.request.urlopen(req_del)
print(f"7) manual destroy: {resp.status} {json.loads(resp.read())['detail']}")
