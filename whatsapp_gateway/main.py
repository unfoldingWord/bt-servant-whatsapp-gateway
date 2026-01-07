"""FastAPI application for the WhatsApp gateway."""

import logging

from fastapi import FastAPI

from whatsapp_gateway.config import config
from whatsapp_gateway.routes import health, webhooks


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    # Configure logging
    logging.basicConfig(
        level=getattr(logging, config.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )

    app = FastAPI(
        title="WhatsApp Gateway",
        description="Gateway service for WhatsApp/Meta integration with BT Servant Engine",
        version="0.1.0",
    )

    # Include routers
    app.include_router(health.router, tags=["health"])
    app.include_router(webhooks.router, tags=["webhooks"])

    return app


# For uvicorn direct invocation
app = create_app()
