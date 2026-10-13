from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from hdip_api.core.config import get_settings
from hdip_api.routes import health


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="HDIP API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router, prefix="/api")
    return app


app = create_app()
