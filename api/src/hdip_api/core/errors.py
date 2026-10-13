from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ProblemItem(BaseModel):
    """一条可读的业务错误。item_index 指向变更申请里的第几项（从 0 开始）。"""

    message: str
    item_index: int | None = None
    field: str | None = None


class Problem(BaseModel):
    message: str
    problems: list[ProblemItem] = []


class BusinessError(Exception):
    def __init__(
        self,
        message: str,
        status_code: int = 422,
        problems: list[ProblemItem] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.problems = problems or []


class NotFound(BusinessError):
    def __init__(self, message: str = "记录不存在") -> None:
        super().__init__(message, 404)


class Forbidden(BusinessError):
    def __init__(self, message: str) -> None:
        super().__init__(message, 403)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(BusinessError)
    async def _business(_: Request, exc: BusinessError) -> JSONResponse:
        body = Problem(message=exc.message, problems=exc.problems)
        return JSONResponse(status_code=exc.status_code, content=body.model_dump())


# 路由声明用：让 OpenAPI 里出现错误体结构
ERROR_RESPONSES: dict[int | str, dict] = {
    403: {"model": Problem},
    404: {"model": Problem},
    409: {"model": Problem},
    422: {"model": Problem},
}
