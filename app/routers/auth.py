import asyncio

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import (
    hash_password,
    verify_password,
    create_token,
    require_user,
    require_token_user_id,
)
from ..config import settings
from ..database import get_db, SessionLocal
from ..models import User, Share

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/register", response_model=schemas.Token)
def register(payload: schemas.UserCreate, db: Session = Depends(get_db)):
    if db.query(User.id).filter(User.username == payload.username).first():
        raise HTTPException(status_code=409, detail="用户名已被占用")
    user = User(username=payload.username, password_hash=hash_password(payload.password))
    db.add(user)
    db.commit()
    db.refresh(user)
    return schemas.Token(token=create_token(user.id, user.username), username=user.username)


@router.post("/login", response_model=schemas.Token)
def login(payload: schemas.UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    return schemas.Token(token=create_token(user.id, user.username), username=user.username)


@router.get("/me", response_model=schemas.UserOut)
def me(user: User = Depends(require_user)):
    return schemas.UserOut(id=user.id, username=user.username, created_at=user.created_at)


@router.get("/my-shares", response_model=list[schemas.MyShareItem])
def my_shares(
    request: Request,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    shares = (
        db.query(Share)
        .filter(Share.user_id == user.id)
        .order_by(Share.created_at.desc())
        .limit(50)
        .all()
    )
    base_url = settings.BASE_URL or str(request.base_url).rstrip("/")
    result = []
    for s in shares:
        if s.content_type == "file":
            preview = f"📎 {s.file_name}"
        elif s.content_type == "encrypted":
            preview = "🔐 [端到端加密内容]"
        else:
            preview = (s.content or "")[:40]
        result.append(
            schemas.MyShareItem(
                code=s.code,
                url=f"{base_url}/s/{s.code}",
                content_type=s.content_type,
                preview=preview,
                title=s.title,
                file_name=s.file_name,
                file_size=s.file_size,
                created_at=s.created_at,
                expires_at=s.expires_at,
                view_count=s.view_count,
                max_views=s.max_views,
            )
        )
    return result


@router.get("/my-shares/stream")
async def my_shares_stream(
    request: Request,
    user_id: int = Depends(require_token_user_id),
):
    """SSE 实时同步：分享列表变化（新增/删除/被访问）时主动推送给所有登录设备。

    兼容多 worker 的关键：不使用进程内广播（多进程互相看不见），
    而是每个连接以固定间隔查询一次「聚合签名」——
    (记录数, 最大 id, view_count 总和) 任一变化即推送。
    查询使用短生命周期 Session，避免长事务占用 SQLite 写锁。
    """

    def signature() -> str:
        db = SessionLocal()
        try:
            row = db.execute(
                select(
                    func.count(Share.id),
                    func.coalesce(func.max(Share.id), 0),
                    func.coalesce(func.sum(Share.view_count), 0),
                ).where(Share.user_id == user_id)
            ).one()
            return f"{row[0]}-{row[1]}-{row[2]}"
        finally:
            db.close()

    async def event_generator():
        last_sig = None
        idle = 0
        while True:
            if await request.is_disconnected():
                break
            sig = signature()
            if sig != last_sig:
                last_sig = sig
                idle = 0
                yield f"data: {sig}\n\n"
            else:
                idle += settings.SSE_POLL_INTERVAL
                if idle >= 15:
                    idle = 0
                    yield ": ping\n\n"   # 心跳注释行，防止 Nginx 读超时断开
            await asyncio.sleep(settings.SSE_POLL_INTERVAL)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",   # 让 Nginx 不对 SSE 做缓冲
        },
    )
