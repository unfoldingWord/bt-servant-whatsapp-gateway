"""Health check endpoints."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health_check() -> dict:
    """Basic health check endpoint."""
    return {"status": "healthy"}


@router.get("/")
async def root() -> dict:
    """Root endpoint."""
    return {"service": "whatsapp-gateway", "status": "running"}
