import re
import uuid
from datetime import datetime, timedelta
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import update, or_
from sqlalchemy.orm import Session
from starlette.background import BackgroundTask

from .. import schemas
from ..auth import get_current_user
from ..config import settings
from ..database import get_db, SessionLocal
from ..models import Share, AccessLog, User
from ..security import generate_code, generate_token
from ..services import burn_share

router = APIRouter(prefix="/api/files", tags=["files"])

CHUNK_SIZE = 1024 * 1024  # 1MB 流式读写

MAX_EXPIRY_SECONDS = 365 * 86400


def _sanitize_filename(name: str) -> str:
    """文件名清洗：去路径成分、替换非法字符，仅用于展示（存储名与用户输入完全隔离）"""
    name = (name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r'[\x00-\x1f<>:"|?*]', "_", name).strip()
    return name[:200] or "unnamed"


def _finalize_download_burn(share_id: int, file_path: str) -> None:
    """响应发送完毕后，删除数据库记录与磁盘文件（避免 Windows 下文件占用冲突）"""
    db = SessionLocal()
    try:
        share = db.get(Share, share_id)
        if share:
            db.delete(share)
            db.commit()
    finally:
        db.close()
    try:
        Path(file_path).unlink(missing_ok=True)
    except OSError:
        pass


@router.post("", response_model=schemas.ShareCreated)
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    expires_in: int | None = Form(None),
    max_views: int | None = Form(None),
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    if expires_in is not None and not (1 <= expires_in <= MAX_EXPIRY_SECONDS):
        raise HTTPException(status_code=422, detail="有效期超出允许范围")
    if max_views is not None and not (1 <= max_views <= 100000):
        raise HTTPException(status_code=422, detail="访问次数超出允许范围")

    # 存储名由服务器生成（uuid），与用户文件名完全隔离 —— 路径遍历无从谈起
    stored_name = uuid.uuid4().hex
    store_path = settings.UPLOAD_DIR / stored_name
    size = 0
    try:
        async with aiofiles.open(store_path, "wb") as f:
            while True:
                chunk = await file.read(CHUNK_SIZE)
                if not chunk:
                    break
                size += len(chunk)
                if size > settings.MAX_FILE_SIZE:
                    raise HTTPException(status_code=413, detail="文件大小超过 100MB 限制")
                await f.write(chunk)
    except HTTPException:
        store_path.unlink(missing_ok=True)
        raise
    finally:
        await file.close()

    if size == 0:
        store_path.unlink(missing_ok=True)
        raise HTTPException(status_code=422, detail="空文件无法分享")

    expires_at = None
    if expires_in is not None:
        expires_at = datetime.utcnow() + timedelta(seconds=expires_in)

    code = None
    for _ in range(5):
        candidate = generate_code(settings.CODE_LENGTH)
        if not db.query(Share.id).filter(Share.code == candidate).first():
            code = candidate
            break
    if code is None:
        store_path.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail="短码生成失败，请重试")

    share = Share(
        code=code,
        user_id=user.id if user else None,
        content_type="file",
        file_path=str(store_path),
        file_name=_sanitize_filename(file.filename),
        file_size=size,
        file_mime=file.content_type or "application/octet-stream",
        expires_at=expires_at,
        max_views=max_views,
        delete_token=generate_token(),
    )
    db.add(share)
    db.commit()
    db.refresh(share)

    base_url = settings.BASE_URL or str(request.base_url).rstrip("/")
    return schemas.ShareCreated(
        code=code,
        url=f"{base_url}/s/{code}",
        delete_token=share.delete_token,
        expires_at=expires_at,
        max_views=max_views,
    )


@router.get("/{code}/download")
def download_file(code: str, db: Session = Depends(get_db)):
    share = db.query(Share).filter(Share.code == code).first()
    if not share:
        raise HTTPException(status_code=404, detail="分享不存在或已失效")
    if share.expires_at is not None and share.expires_at < datetime.utcnow():
        burn_share(db, share)
        raise HTTPException(status_code=410, detail="该分享已过期")
    if share.max_views is not None and share.view_count >= share.max_views:
        burn_share(db, share)
        raise HTTPException(status_code=410, detail="该分享的访问次数已用尽")

    old_count = share.view_count
    result = db.execute(
        update(Share)
        .where(
            Share.id == share.id,
            or_(Share.max_views.is_(None), Share.view_count < Share.max_views),
        )
        .values(view_count=Share.view_count + 1)
        .execution_options(synchronize_session=False)
    )
    if result.rowcount == 0:
        burn_share(db, share)
        raise HTTPException(status_code=410, detail="该分享的访问次数已用尽")

    new_count = old_count + 1
    burned = share.max_views is not None and new_count >= share.max_views
    db.add(AccessLog(share_id=share.id))
    db.commit()

    response = FileResponse(
        share.file_path,
        filename=share.file_name,
        media_type=share.file_mime or "application/octet-stream",
    )
    if burned:
        # 最后一次下载：文件发送完成后再清理，保证下载不受影响
        response.headers["X-Burned"] = "true"
        response.background = BackgroundTask(
            _finalize_download_burn, share.id, share.file_path
        )
    return response
