"""院区、部门、服务单元的代码分配与拼音码（迁移 0015）。

- 代码由系统按规则发号：院区 C + 3 位、部门 D + 6 位、服务单元 SU + 6 位数字。
  表单在“保存到申请”时为要新建的对象预留代码（同一次保存用同一个请求键，重试拿回同一个号），
  之后预演、提交、确认都用这个号；号码不回收，撤销或退回留下空号。
- 新建对象（含拆分 / 合并的后继、组织变更新设的部门）只能用已预留的同类型代码（apply 检查）；
  同一个预留代码同时只能由一张进行中的申请（草稿 / 已提交）用来新建（workflow 检查）。
- 拼音码是名称的拼音首字母（大写字母与数字），检索用、不唯一；
  表单生成并可改，未给出时这里按名称生成。
"""

import re
from typing import Literal

from pypinyin import Style, lazy_pinyin
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from hdip_api.core.errors import BusinessError
from hdip_api.models import AppUser, CodeReservation

ObjectType = Literal["campus", "department", "service_unit"]

# 类型 → (前缀, 数字位数, 序列, 中文名)
RULES: dict[str, tuple[str, int, str, str]] = {
    "campus": ("C", 3, "campus_code_seq", "院区"),
    "department": ("D", 6, "department_code_seq", "部门"),
    "service_unit": ("SU", 6, "service_unit_code_seq", "服务单元"),
}


def rule_text(object_type: str) -> str:
    prefix, width, _, label = RULES[object_type]
    return f"{label}代码为 {prefix} 加 {width} 位数字（如 {prefix}{'1'.zfill(width)}）"


def reserve(
    s: Session, user: AppUser, object_type: ObjectType, request_key: str, count: int
) -> list[str]:
    """为一次保存预留 count 个代码；同一请求键已预留的槽位原样返回，不足的再发号。"""
    prefix, width, seq, label = RULES[object_type]
    have = {
        r.slot: r.code
        for r in s.scalars(
            select(CodeReservation).where(
                CodeReservation.request_key == request_key,
                CodeReservation.object_type == object_type,
            )
        )
    }
    out: list[str] = []
    for slot in range(count):
        if slot in have:
            out.append(have[slot])
            continue
        n = s.scalar(text(f"SELECT nextval('{seq}')"))
        if n is None or n >= 10**width:
            raise BusinessError(f"{label}代码已用尽（{prefix} 加 {width} 位数字），请联系管理员")
        code = f"{prefix}{n:0{width}d}"
        s.add(
            CodeReservation(
                object_type=object_type,
                code=code,
                request_key=request_key,
                slot=slot,
                reserved_by=user.id,
            )
        )
        out.append(code)
    s.flush()
    return out


def is_reserved(s: Session, object_type: str, code: str) -> bool:
    return (
        s.scalar(
            select(CodeReservation.id).where(
                CodeReservation.code == code, CodeReservation.object_type == object_type
            )
        )
        is not None
    )


# ------------------------------------------------------------------ 拼音码
_KEEP = re.compile(r"[^A-Z0-9]")


def pinyin_of(name: str) -> str | None:
    """名称的拼音首字母：汉字取首字母（按词语读音，如“银行”取 YH），字母数字原样大写，其余丢弃。"""
    letters = "".join(lazy_pinyin(name, style=Style.FIRST_LETTER)).upper()
    code = _KEEP.sub("", letters)[:64]
    return code or None


# ------------------------------------------------------------------ 脚本数据（走查库、样例导入）
_CREATES = {
    "campus.create": "campus",
    "department.create": "department",
    "service_unit.create": "service_unit",
}


def _created(items: list[dict]) -> list[tuple[str, str]]:
    out = []
    for i in items:
        k = i.get("kind")
        if k in _CREATES:
            out.append((_CREATES[k], i["code"]))
        elif k == "service_unit.split":
            out += [("service_unit", x["code"]) for x in i["successors"]]
        elif k == "service_unit.merge":
            out.append(("service_unit", i["successor"]["code"]))
    return out


def issue_for_script(
    s: Session, user: AppUser, items: list[dict], key_prefix: str, known: dict[str, str]
) -> list[dict]:
    """脚本里的新建对象先用可读的临时代码（如 XNK、资料包的 D0001），这里换成系统分配的代码。

    每个临时代码用固定的请求键（key_prefix:类型:临时代码）取号，脚本重跑拿回同一个号；
    known 收集“临时代码 → 正式代码”，供后续批次引用。
    """
    for object_type, temp in _created(items):
        if temp not in known:
            key = f"{key_prefix}:{object_type}:{temp}"
            [known[temp]] = reserve(s, user, object_type, key, 1)  # type: ignore[arg-type]

    def walk(x, key: str = ""):
        if isinstance(x, dict):
            return {k: walk(v, k) for k, v in x.items()}
        if isinstance(x, list):
            return [walk(v, key) for v in x]
        # 只换引用院区 / 部门 / 服务单元的字段（code、department_code、parent_code…），
        # 外部代码、名称、说明里碰巧相同的字符串不动
        if isinstance(x, str) and key in _REF_KEYS:
            return known.get(x, x)
        return x

    return walk(items)


_REF_KEYS = {
    "code",
    "codes",
    "campus_code",
    "department_code",
    "service_unit_code",
    "parent_code",
    "from_code",
    "to_code",
}
