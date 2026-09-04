"""认证工具：PBKDF2 密码哈希 + JWT 令牌签发与校验"""
import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import User

# JWT 密钥：优先环境变量，否则生成一次并持久化到本地文件
_SECRET_FILE = settings.BASE_DIR / ".jwt_secret"


def _load_secret() -> str:
    env = os.environ.get("JWT_SECRET")
    if env:
        return env
    if _SECRET_FILE.exists():
        return _SECRET_FILE.read_text().strip()
    s = secrets.token_hex(32)
    _SECRET_FILE.write_text(s)
    return s


JWT_SECRET = _load_secret()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = 72

_bearer = HTTPBearer(auto_error=False)

# ---------- 密码哈希（PBKDF2-SHA256，26万轮迭代） ----------
PBKDF2_ITERATIONS = 260_000


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, iterations, salt, hash_hex = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), int(iterations))
        return secrets.compare_digest(dk.hex(), hash_hex)
    except (ValueError, AttributeError):
        return False


# ---------- JWT ----------
def create_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """从 Authorization: Bearer <token> 解析用户；未携带返回 None（匿名可用）"""
    if creds is None:
        return None
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status_code=401, detail="登录已过期，请重新登录")
    user = db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=401, detail="用户不存在")
    return user


def require_user(user: User | None = Depends(get_current_user)) -> User:
    """必须登录的场景"""
    if user is None:
        raise HTTPException(status_code=401, detail="请先登录")
    return user
