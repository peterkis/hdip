"""开发期身份。

认证方案尚待确认（设计文档第 12 节）。在那之前，前端在请求头 X-HDIP-User 里带用户名，
后端只认 app_user 里存在且启用的用户。这不是安全措施，只为把“谁提交、谁确认”留痕跑通；
接入内网门户登录时只替换本文件的 current_user。
"""

from typing import Annotated

from fastapi import Depends, Header
from sqlalchemy import select

from hdip_api.core.db import SessionDep
from hdip_api.core.errors import BusinessError
from hdip_api.models import AppUser


def current_user(
    session: SessionDep,
    x_hdip_user: Annotated[str | None, Header()] = None,
) -> AppUser:
    if not x_hdip_user:
        raise BusinessError("未指定当前用户", 401)
    user = session.scalar(select(AppUser).where(AppUser.username == x_hdip_user, AppUser.is_active))
    if user is None:
        raise BusinessError(f"用户 {x_hdip_user} 不存在或已停用", 401)
    return user


CurrentUser = Annotated[AppUser, Depends(current_user)]
