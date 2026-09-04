import secrets
import string

# Base62 字母表：去掉易混淆的 0/O、1/l 也可以，但 62 位全量在 8 位长度下已足够安全
_ALPHABET = string.ascii_letters + string.digits


def generate_code(length: int = 8) -> str:
    """密码学安全随机短码。62^8 ≈ 2.2 * 10^14 种组合，暴力猜测不可行"""
    return "".join(secrets.choice(_ALPHABET) for _ in range(length))


def generate_token() -> str:
    return secrets.token_urlsafe(24)


# 允许用户设置的合法有效期选项（秒），防止任意值注入
EXPIRY_CHOICES = {
    "1h": 3600,
    "24h": 86400,
    "7d": 604800,
    "forever": None,
}

VIEW_CHOICES = {
    "1": 1,
    "5": 5,
    "unlimited": None,
}
