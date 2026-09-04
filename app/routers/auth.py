from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session

from .. import schemas
from ..auth import hash_password, verify_password, create_token, require_user
from ..config import settings
from ..database import get_db
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
                file_name=s.file_name,
                file_size=s.file_size,
                created_at=s.created_at,
                expires_at=s.expires_at,
                view_count=s.view_count,
                max_views=s.max_views,
            )
        )
    return result
