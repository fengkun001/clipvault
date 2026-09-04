from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey

from .database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(32), unique=True, index=True, nullable=False)
    password_hash = Column(String(500), nullable=False)  # PBKDF2-SHA256，不存明文
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class Share(Base):
    __tablename__ = "shares"

    id = Column(Integer, primary_key=True, index=True)
    code = Column(String(16), unique=True, index=True, nullable=False)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)  # 匿名分享为空
    content_type = Column(String(20), default="text", nullable=False)  # text / markdown / code / encrypted / file
    content = Column(Text, nullable=True)          # 文本内容（存储原文，展示层负责转义）
    file_path = Column(String(500), nullable=True) # 文件分享：服务器内部存储路径
    file_name = Column(String(255), nullable=True) # 原始文件名（展示用）
    file_size = Column(Integer, nullable=True)
    file_mime = Column(String(100), nullable=True)
    delete_token = Column(String(64), nullable=True)  # 创建者凭此令牌删除分享
    expires_at = Column(DateTime, nullable=True)   # NULL 表示永久有效
    max_views = Column(Integer, nullable=True)    # NULL 表示不限次数
    view_count = Column(Integer, default=0, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AccessLog(Base):
    """隐私友好的访问日志：只记录时间和次数，不记录 IP 等身份信息"""

    __tablename__ = "access_logs"

    id = Column(Integer, primary_key=True, index=True)
    share_id = Column(Integer, ForeignKey("shares.id", ondelete="CASCADE"), nullable=False)
    accessed_at = Column(DateTime, default=datetime.utcnow, nullable=False)
