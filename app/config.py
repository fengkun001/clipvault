import os
from pathlib import Path

_BASE_DIR = Path(__file__).resolve().parent.parent


class Settings:
    BASE_DIR = _BASE_DIR
    APP_NAME = "ClipVault"
    APP_DESCRIPTION = "轻量级云剪切板分享系统"
    DATABASE_URL = os.environ.get("DATABASE_URL", f"sqlite:///{_BASE_DIR / 'clipvault.db'}")
    UPLOAD_DIR = _BASE_DIR / "uploads"
    MAX_CONTENT_LENGTH = 512 * 1024          # 文本最大 512KB
    MAX_FILE_SIZE = 100 * 1024 * 1024        # 文件最大 100MB
    CODE_LENGTH = 8                          # 短码长度，Base62 下 62^8 种组合
    BASE_URL = os.environ.get("BASE_URL", "")  # 部署时通过环境变量注入，如 http://1.2.3.4
    CLEANUP_INTERVAL = 300                    # 过期内容自动清理间隔（秒）


settings = Settings()
settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
