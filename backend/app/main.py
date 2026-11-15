import mimetypes
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, Response, status, Request, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .database import init_db, check_database_health, check_storage_writable
from .services.gemini_service import GeminiAIService
from .routers import (
    assistant,
    crop_advisor,
    crop_health,
    market_prices,
    voice,
    weather,
    settings as settings_router,
    authentication,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One reusable connection pool for outbound Timbre requests.
    app.state.gnani_tts_client = httpx.AsyncClient(
        timeout=httpx.Timeout(60.0, connect=5.0),
        limits=httpx.Limits(
            max_connections=20,
            max_keepalive_connections=10,
            keepalive_expiry=30.0,
        ),
    )

    try:
        init_db()
        yield
    finally:
        await app.state.gnani_tts_client.aclose()


app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Voice-first AI agricultural assistant for Indian farmers",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With", "Accept"],
)

# Include all module routers
app.include_router(authentication.router)
app.include_router(assistant.router)
app.include_router(crop_advisor.router)
app.include_router(crop_health.router)
app.include_router(market_prices.router)
app.include_router(voice.router)
app.include_router(settings_router.router)
app.include_router(weather.router)



@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "gnani_live_enabled": settings.GNANI_LIVE_ENABLED,
    }


@app.get("/api/ready")
def readiness_check(response: Response):
    """
    Readiness probe for cloud orchestrators.
    Verifies database connectivity, storage writability, and configuration.
    """
    db_ok = check_database_health()
    storage_ok = check_storage_writable()
    gemini_ready = GeminiAIService.is_configured()
    is_ready = db_ok and storage_ok

    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ready" if is_ready else "degraded",
        "database": "connected" if db_ok else "unreachable",
        "storage": "writable" if storage_ok else "read_only_or_error",
        "gemini_configured": gemini_ready,
        "gnani_live_enabled": bool(settings.GNANI_LIVE_ENABLED and settings.GNANI_ALLOW_PAID_LIVE_CALLS),
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }

# Serve the production React frontend from the same Render service.
FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
FRONTEND_PUBLIC = Path(__file__).resolve().parents[2] / "frontend" / "public"


def _stream_file_range(file_path: Path, request: Request, media_type: str = "application/octet-stream") -> Response:
    """Stream a local static file supporting HTTP Byte-Range requests (206 Partial Content)."""
    file_size = file_path.stat().st_size
    range_header = request.headers.get("range")

    headers = {
        "Accept-Ranges": "bytes",
        "Content-Type": media_type,
    }

    if not range_header:
        headers["Content-Length"] = str(file_size)
        if request.method == "HEAD":
            return Response(status_code=200, headers=headers)
        def file_iterator():
            with open(file_path, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk
        return StreamingResponse(file_iterator(), status_code=200, headers=headers)

    units, sep, range_spec = range_header.strip().partition("=")
    if units.strip().lower() != "bytes" or not sep:
        headers["Content-Length"] = str(file_size)
        if request.method == "HEAD":
            return Response(status_code=200, headers=headers)
        def file_iterator():
            with open(file_path, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk
        return StreamingResponse(file_iterator(), status_code=200, headers=headers)

    if file_size == 0:
        return Response(status_code=416, headers={"Content-Range": "bytes */0", "Content-Length": "0"})

    # RFC 9110 §14.2: If multiple ranges are requested and the server does not support
    # multipart/byteranges, it must ignore the Range header field and return 200 OK with the full content.
    if "," in range_spec:
        headers["Content-Length"] = str(file_size)
        if request.method == "HEAD":
            return Response(status_code=200, headers=headers)
        def file_iterator():
            with open(file_path, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk
        return StreamingResponse(file_iterator(), status_code=200, headers=headers)

    start_str, sep, end_str = range_spec.partition("-")
    if not sep:
        headers["Content-Length"] = str(file_size)
        if request.method == "HEAD":
            return Response(status_code=200, headers=headers)
        def file_iterator():
            with open(file_path, "rb") as f:
                while chunk := f.read(65536):
                    yield chunk
        return StreamingResponse(file_iterator(), status_code=200, headers=headers)

    start_str = start_str.strip()
    end_str = end_str.strip()

    try:
        if start_str and end_str:
            start = int(start_str)
            end = min(int(end_str), file_size - 1)
        elif start_str:
            start = int(start_str)
            end = file_size - 1
        elif end_str:
            length = int(end_str)
            if length <= 0:
                return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Content-Length": "0"})
            start = max(0, file_size - length)
            end = file_size - 1
        else:
            return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Content-Length": "0"})
    except ValueError:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Content-Length": "0"})

    if start > end or start >= file_size or start < 0:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}", "Content-Length": "0"})

    content_length = end - start + 1
    headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"
    headers["Content-Length"] = str(content_length)

    if request.method == "HEAD":
        return Response(status_code=206, headers=headers)

    def range_iterator():
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    return StreamingResponse(range_iterator(), status_code=206, headers=headers)


@app.api_route("/assets/{asset_path:path}", methods=["GET", "HEAD"])
async def serve_asset_with_range(asset_path: str, request: Request):
    """Serve frontend assets with Byte-Range support for seamless video scrubbing and media seeking."""
    try:
        if FRONTEND_DIST.is_dir():
            dist_base = (FRONTEND_DIST / "assets").resolve()
            dist_file = (dist_base / asset_path).resolve()
            if dist_file.is_file() and dist_file.is_relative_to(dist_base):
                media_type = mimetypes.guess_type(str(dist_file))[0] or "application/octet-stream"
                return _stream_file_range(dist_file, request, media_type)

        if FRONTEND_PUBLIC.is_dir():
            pub_base = (FRONTEND_PUBLIC / "assets").resolve()
            pub_file = (pub_base / asset_path).resolve()
            if pub_file.is_file() and pub_file.is_relative_to(pub_base):
                media_type = mimetypes.guess_type(str(pub_file))[0] or "application/octet-stream"
                return _stream_file_range(pub_file, request, media_type)
    except (ValueError, LookupError):
        # Invalid client path (e.g. embedded null byte or malformed path specifier)
        raise HTTPException(status_code=404, detail="Asset not found")

    raise HTTPException(status_code=404, detail="Asset not found")


if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
