import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from .config import settings
from .database import Base, engine, SessionLocal
from .ratelimit import RateLimitMiddleware
from .routers import share, files, auth
from .services import burn_share

templates = Jinja2Templates(directory=str(settings.BASE_DIR / "templates"))


async def cleanup_expired():
    """后台任务：定期物理删除过期分享与超过 30 天的访问日志"""
    from .models import Share, AccessLog

    while True:
        await asyncio.sleep(settings.CLEANUP_INTERVAL)
        db = SessionLocal()
        try:
            now = datetime.utcnow()
            expired = (
                db.query(Share)
                .filter(Share.expires_at.isnot(None), Share.expires_at < now)
                .all()
            )
            for s in expired:
                burn_share(db, s)
            db.query(AccessLog).filter(
                AccessLog.accessed_at < now - timedelta(days=30)
            ).delete()
            db.commit()
            if expired:
                print(f"[cleanup] 已清理 {len(expired)} 条过期分享")
        except Exception as exc:  # 清理失败不影响主服务
            print(f"[cleanup] error: {exc}")
        finally:
            db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    Base.metadata.create_all(bind=engine)
    _migrate(engine)
    task = asyncio.create_task(cleanup_expired())
    yield
    task.cancel()


def _migrate(engine) -> None:
    """轻量迁移：为旧版本数据库补充缺失的列（SQLite ALTER TABLE 仅支持加列）"""
    from sqlalchemy import text, inspect

    inspector = inspect(engine)
    if "shares" not in inspector.get_table_names():
        return
    columns = {c["name"] for c in inspector.get_columns("shares")}
    with engine.begin() as conn:
        if "user_id" not in columns:
            conn.execute(text("ALTER TABLE shares ADD COLUMN user_id INTEGER REFERENCES users(id)"))


app = FastAPI(
    title=settings.APP_NAME,
    description=settings.APP_DESCRIPTION,
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(RateLimitMiddleware)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    """CSP 等安全响应头：XSS 纵深防御的关键一环"""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; "
        "style-src 'self' 'unsafe-inline'; "
        "connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'"
    )
    return response


app.include_router(share.router)
app.include_router(files.router)
app.include_router(auth.router)
app.mount("/static", StaticFiles(directory=str(settings.BASE_DIR / "static")), name="static")


@app.get("/", response_class=HTMLResponse)
async def index(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


@app.get("/s/{code}", response_class=HTMLResponse)
async def view_share(request: Request, code: str):
    return templates.TemplateResponse(request=request, name="view.html", context={"code": code})


@app.get("/api/health")
async def health():
    return {"status": "ok", "app": settings.APP_NAME}
