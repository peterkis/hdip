from fastapi import APIRouter
from sqlalchemy import select

from hdip_api.core.auth import CurrentUser
from hdip_api.core.db import SessionDep
from hdip_api.core.permissions import permissions_of
from hdip_api.models import AppUser, OptionItem
from hdip_api.schemas.read import OptionOut, UserOut

router = APIRouter(tags=["meta"])


def _user_out(user: AppUser) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        roles=user.roles,
        permissions=sorted(permissions_of(user)),
    )


@router.get("/me", response_model=UserOut, operation_id="getMe")
def me(user: CurrentUser) -> UserOut:
    return _user_out(user)


@router.get("/users", response_model=list[UserOut], operation_id="listUsers")
def users(session: SessionDep) -> list[UserOut]:
    """开发期身份切换用：列出启用的用户。"""
    rows = session.scalars(select(AppUser).where(AppUser.is_active).order_by(AppUser.id))
    return [_user_out(u) for u in rows]


@router.get("/options", response_model=list[OptionOut], operation_id="listOptions")
def options(session: SessionDep, category: str | None = None) -> list[OptionOut]:
    q = (
        select(OptionItem)
        .where(OptionItem.is_active)
        .order_by(OptionItem.category, OptionItem.sort_order)
    )
    if category:
        q = q.where(OptionItem.category == category)
    return [OptionOut.model_validate(o, from_attributes=True) for o in session.scalars(q)]
