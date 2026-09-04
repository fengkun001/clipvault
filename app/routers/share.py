from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import update, or_
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import get_current_user
from ..config import settings
from ..database import get_db
from ..models import Share, AccessLog, User
from ..security import generate_code, generate_token
from ..services import burn_share

router = APIRouter(prefix="/api/shares", tags=["shares"])

MAX_EXPIRY_SECONDS = 365 * 86400


def _burn(db: Session, share: Share) -> None:
    """物理删除分享记录（连带磁盘文件），实现『阅后即焚』语义"""
    burn_share(db, share)


@router.post("", response_model=schemas.ShareCreated)
def create_share(
    payload: schemas.ShareCreate,
    request: Request,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user),  # 登录则关联归属，匿名照常使用
):
    if payload.expires_in is not None and not (1 <= payload.expires_in <= MAX_EXPIRY_SECONDS):
        raise HTTPException(status_code=422, detail="有效期超出允许范围")

    expires_at = None
    if payload.expires_in is not None:
        expires_at = datetime.utcnow() + timedelta(seconds=payload.expires_in)

    # 短码碰撞概率极低，但仍然重试以绝对保证唯一
    code = None
    for _ in range(5):
        candidate = generate_code(settings.CODE_LENGTH)
        if not db.query(Share.id).filter(Share.code == candidate).first():
            code = candidate
            break
    if code is None:
        raise HTTPException(status_code=500, detail="短码生成失败，请重试")

    share = Share(
        code=code,
        user_id=user.id if user else None,
        content=payload.content,
        content_type=payload.content_type,
        expires_at=expires_at,
        max_views=payload.max_views,
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
        max_views=payload.max_views,
    )


@router.get("/{code}/meta", response_model=schemas.ShareMeta)
def get_share_meta(code: str, db: Session = Depends(get_db)):
    """获取分享元信息（不消耗访问次数），用于文件下载等场景"""
    share = db.query(Share).filter(Share.code == code).first()
    if not share:
        raise HTTPException(status_code=404, detail="分享不存在或已失效")
    if share.expires_at is not None and share.expires_at < datetime.utcnow():
        _burn(db, share)
        raise HTTPException(status_code=410, detail="该分享已过期")
    if share.max_views is not None and share.view_count >= share.max_views:
        _burn(db, share)
        raise HTTPException(status_code=410, detail="该分享的访问次数已用尽")
    return schemas.ShareMeta(
        code=share.code,
        content_type=share.content_type,
        file_name=share.file_name,
        file_size=share.file_size,
        file_mime=share.file_mime,
        created_at=share.created_at,
        expires_at=share.expires_at,
        view_count=share.view_count,
        max_views=share.max_views,
    )


@router.get("/{code}", response_model=schemas.ShareContent)
def get_share_content(code: str, db: Session = Depends(get_db)):
    share = db.query(Share).filter(Share.code == code).first()
    if not share:
        raise HTTPException(status_code=404, detail="分享不存在或已失效")

    now = datetime.utcnow()
    if share.expires_at is not None and share.expires_at < now:
        _burn(db, share)
        raise HTTPException(status_code=410, detail="该分享已过期")
    if share.max_views is not None and share.view_count >= share.max_views:
        _burn(db, share)
        raise HTTPException(status_code=410, detail="该分享的访问次数已用尽")

    # 原子递增：WHERE 条件保证并发下也不会超过 max_views
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
        _burn(db, share)
        raise HTTPException(status_code=410, detail="该分享的访问次数已用尽")

    content = share.content
    new_count = old_count + 1
    burned = share.max_views is not None and new_count >= share.max_views

    db.add(AccessLog(share_id=share.id))

    if burned:
        # 最后一次阅读后立即烧毁，服务器上不再留存任何内容
        db.delete(share)
    db.commit()

    return schemas.ShareContent(
        code=share.code,
        content_type=share.content_type,
        content=content,
        created_at=share.created_at,
        expires_at=share.expires_at,
        view_count=new_count,
        max_views=share.max_views,
    )


@router.delete("/{code}", response_model=schemas.ApiResponse)
def delete_share(
    code: str,
    token: str | None = None,
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user),
):
    """销毁分享：凭 delete_token（匿名创建者）或登录身份（归属人）"""
    share = db.query(Share).filter(Share.code == code).first()
    import secrets as _secrets
    by_token = share and share.delete_token and token and _secrets.compare_digest(share.delete_token, token)
    by_owner = share and user and share.user_id == user.id
    if not share or not (by_token or by_owner):
        raise HTTPException(status_code=403, detail="无权销毁该分享")
    burn_share(db, share)
    return schemas.ApiResponse(detail="分享已销毁")

