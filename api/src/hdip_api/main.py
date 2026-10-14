from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from hdip_api.core.config import get_settings
from hdip_api.core.errors import install_error_handlers
from hdip_api.routes import changes, export, health, master, meta


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="HDIP API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    install_error_handlers(app)
    for r in (health.router, meta.router, master.router, changes.router, export.router):
        app.include_router(r, prefix="/api")
    return app


app = create_app()
