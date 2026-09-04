from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field


class ShareCreate(BaseModel):
    content: str = Field(..., min_length=1, max_length=512 * 1024)
    content_type: Literal["text", "markdown", "code", "encrypted"] = "text"
    expires_in: Optional[int] = Field(None, description="有效期（秒），None 表示永久")
    max_views: Optional[int] = Field(None, ge=1, le=100000, description="最大访问次数，None 表示不限")


class ShareCreated(BaseModel):
    code: str
    url: str
    delete_token: str
    expires_at: Optional[datetime]
    max_views: Optional[int]


class ShareContent(BaseModel):
    code: str
    content_type: str
    content: str
    created_at: datetime
    expires_at: Optional[datetime]
    view_count: int
    max_views: Optional[int]


class ShareMeta(BaseModel):
    code: str
    content_type: str
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    file_mime: Optional[str] = None
    created_at: datetime
    expires_at: Optional[datetime]
    view_count: int
    max_views: Optional[int]


class ApiResponse(BaseModel):
    detail: str


# ---------- 用户系统 ----------
class UserCreate(BaseModel):
    username: str = Field(..., min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_\u4e00-\u9fa5]+$",
                          description="3-32位字母/数字/下划线/中文")
    password: str = Field(..., min_length=6, max_length=128)


class UserLogin(BaseModel):
    username: str
    password: str


class Token(BaseModel):
    token: str
    username: str


class UserOut(BaseModel):
    id: int
    username: str
    created_at: datetime


class MyShareItem(BaseModel):
    code: str
    url: str
    content_type: str
    preview: str
    file_name: Optional[str] = None
    file_size: Optional[int] = None
    created_at: datetime
    expires_at: Optional[datetime]
    view_count: int
    max_views: Optional[int]
