from pathlib import Path

from sqlalchemy.orm import Session

from .models import Share


def burn_share(db: Session, share: Share) -> None:
    """物理删除分享记录及对应的磁盘文件（阅后即焚 / 过期 / 手动销毁共用）"""
    if share.file_path:
        try:
            Path(share.file_path).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(share)
    db.commit()
