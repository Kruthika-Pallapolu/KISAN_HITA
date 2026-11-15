
import asyncio
import base64
import binascii
import time
from typing import Optional

from fastapi import (
    APIRouter,
    HTTPException,
    Request,
    UploadFile,
    File,
    Form,
    WebSocket,
    WebSocketDisconnect,
    status,
    Depends,
)

from ..models.schemas import STTRequest, STTResponse, TTSRequest, TTSResponse
from ..auth import (
    current_session,
    current_farmer_session,
    _valid_session,
    require_same_origin,
)
from ..rate_limit import enforce_rate_limit
from ..services.gnani_voice import (
    get_voice_provider,
    GNANI_LANG_MAP,
    DormantGnaniVoiceProvider,
    detect_audio_mime,
)
from ..config import settings

router = APIRouter(prefix="/api/voice", tags=["voice"])

MAX_AUDIO_BYTES = 10 * 1024 * 1024
MAX_WS_AUDIO_BYTES = 5 * 1024 * 1024
WS_SESSION_TIMEOUT_SECONDS = 60.0
WS_INACTIVITY_TIMEOUT_SECONDS = 15.0


def validate_audio_format(audio_bytes: bytes) -> str:
    """Validates and returns the MIME type detected from the audio container."""
    if len(audio_bytes) < 44:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audio input is too short or corrupted (minimum 44 bytes required).",
        )

    try:
        detected_mime = detect_audio_mime(audio_bytes)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    if detected_mime == "audio/webm":
        raise HTTPException(
            status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            detail="WebM recordings are not supported by Prisma v3.0. Record MP4, WAV, MP3, AAC, OGG, or FLAC audio.",
        )
    return detected_mime


def validate_language_code(language: str) -> str:
    """Validates language against the 7 supported Indic languages."""
    lang = (language or "").strip()[:2].lower()

    if lang not in settings.SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Unsupported language code '{language}'. "
                f"Supported: {settings.SUPPORTED_LANGUAGES}"
            ),
        )

    return lang


@router.post("/stt", response_model=STTResponse)
async def speech_to_text(
    req: STTRequest,
    account_id: str = Depends(current_session),
):
    """
    Speech-to-Text inference endpoint.
    Accepts base64 encoded audio and target language.
    """
    validate_language_code(req.language)

    if not req.audio_base64:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Audio input is empty or missing.",
        )

    clean_b64 = req.audio_base64

    if "," in clean_b64:
        clean_b64 = clean_b64.split(",", 1)[1]

    if len(clean_b64) > (MAX_AUDIO_BYTES * 4 // 3 + 1024):
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Audio payload exceeds maximum permitted size of "
                f"{MAX_AUDIO_BYTES // (1024 * 1024)}MB."
            ),
        )

    try:
        audio_bytes = base64.b64decode(clean_b64, validate=True)
    except (binascii.Error, ValueError):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid base64 audio payload.",
        )

    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=(
                f"Audio payload exceeds maximum permitted size of "
                f"{MAX_AUDIO_BYTES // (1024 * 1024)}MB."
            ),
        )

    validate_audio_format(audio_bytes)

    try:
        provider = get_voice_provider("stt", req.language)
        return await provider.speech_to_text(audio_bytes, req.language)
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Speech-to-text processing failed.",
        )


@router.post("/stt/upload", response_model=STTResponse)
async def speech_to_text_upload(
    request: Request,
    file: UploadFile = File(...),
    language: str = Form("en"),
    duration_seconds: Optional[float] = Form(None),
    account_id: str = Depends(current_farmer_session),
):
    """
    Direct multipart/form-data upload for audio files from microphone recording.
    Enforces chunked reading to prevent memory exhaustion.
    """
    validate_language_code(language)

    content = bytearray()
    chunk_size = 64 * 1024

    while True:
        chunk = await file.read(chunk_size)

        if not chunk:
            break

        content.extend(chunk)

        if len(content) > MAX_AUDIO_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=(
                    f"Uploaded audio file exceeds maximum permitted size of "
                    f"{MAX_AUDIO_BYTES // (1024 * 1024)}MB."
                ),
            )

    audio_bytes = bytes(content)

    if not audio_bytes or len(audio_bytes) < 44:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Uploaded audio file is empty or corrupted.",
        )

    validate_audio_format(audio_bytes)

    if duration_seconds is not None and (duration_seconds <= 0 or duration_seconds > 30):
        raise HTTPException(
            status_code=422,
            detail="Audio recordings must be longer than zero and no more than 30 seconds.",
        )

    enforce_rate_limit(request, "voice-stt-ip", 60, 60)
    enforce_rate_limit(None, "voice-stt", 20, 60, account_id)

    try:
        provider = get_voice_provider("stt", language)
        return await provider.speech_to_text(audio_bytes, language)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Speech recognition failed.",
        )


@router.post("/tts", response_model=TTSResponse)
async def text_to_speech(
    req: TTSRequest,
    request: Request,
    account_id: str = Depends(current_farmer_session),
):
    """
    Text-to-Speech inference endpoint.
    Reuses the application-level HTTP client for Timbre requests.
    """
    validate_language_code(req.language)

    enforce_rate_limit(request, "voice-tts-ip", 30, 60)
    enforce_rate_limit(None, "voice-tts", 20, 60, account_id)

    clean_text = (
        req.text.replace("*", "")
        .replace("#", "")
        .replace("`", "")
        .strip()
    )

    if not clean_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text input for speech synthesis cannot be empty.",
        )

    if len(req.text) > 2000:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Text length exceeds maximum allowed limit of 2000 characters.",
        )

    speed = req.speed if req.speed is not None else 1.0

    if speed < 0.5 or speed > 2.0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Speech speed must be between 0.5 and 2.0.",
        )

    try:
        provider = get_voice_provider("tts")

        if isinstance(provider, DormantGnaniVoiceProvider) and not 0.85 <= speed <= 1.15:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Timbre v3.0 speech speed must be between 0.85 and 1.15.",
            )

        shared_client = getattr(
            request.app.state,
            "gnani_tts_client",
            None,
        )

        return await provider.text_to_speech(
            text=clean_text,
            language=req.language,
            voice=req.voice,
            speed=speed,
            http_client=shared_client,
        )

    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(e),
        )
    except RuntimeError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(e),
        )
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Text-to-speech synthesis failed.",
        )


@router.websocket("/ws/stt")
async def websocket_stt_stream(
    websocket: WebSocket,
    language: str = "en",
):
    """
    Streaming Speech-to-Text WebSocket endpoint.
    Accepts streamed binary audio chunks and performs batch recognition upon EOS/STOP.
    """
    try:
        require_same_origin(websocket)  # type: ignore[arg-type]
    except HTTPException:
        await websocket.close(code=4403)
        return

    session = _valid_session(websocket)  # type: ignore[arg-type]

    if not session or not session["account_id"]:
        await websocket.close(code=4401)
        return

    await websocket.accept()

    lang_clean = (language or "").strip()[:2].lower()

    if lang_clean not in settings.SUPPORTED_LANGUAGES:
        await websocket.send_json(
            {
                "status": "error",
                "message": (
                    f"Unsupported language '{language}'. "
                    f"Supported: {settings.SUPPORTED_LANGUAGES}"
                ),
            }
        )
        await websocket.close(code=status.WS_1003_UNSUPPORTED_DATA)
        return

    try:
        provider = get_voice_provider("stt", lang_clean)
    except RuntimeError as exc:
        await websocket.send_json({"status": "error", "message": str(exc)})
        await websocket.close(code=status.WS_1011_INTERNAL_ERROR)
        return
    accumulated_bytes = bytearray()
    start_time = time.time()

    try:
        while True:
            if time.time() - start_time > WS_SESSION_TIMEOUT_SECONDS:
                await websocket.send_json(
                    {
                        "status": "error",
                        "message": "Maximum WebSocket session duration (60s) exceeded.",
                    }
                )
                break

            try:
                data = await asyncio.wait_for(
                    websocket.receive(),
                    timeout=WS_INACTIVITY_TIMEOUT_SECONDS,
                )
            except asyncio.TimeoutError:
                await websocket.send_json(
                    {
                        "status": "error",
                        "message": "Session closed due to inactivity.",
                    }
                )
                break

            if "bytes" in data and data["bytes"]:
                accumulated_bytes.extend(data["bytes"])

                if len(accumulated_bytes) > MAX_WS_AUDIO_BYTES:
                    await websocket.send_json(
                        {
                            "status": "error",
                            "message": (
                                f"Streamed audio exceeded maximum limit of "
                                f"{MAX_WS_AUDIO_BYTES // (1024 * 1024)}MB."
                            ),
                        }
                    )
                    break

                await websocket.send_json(
                    {
                        "status": "listening",
                        "transcription_mode": "batch_on_eos",
                        "bytes_received": len(accumulated_bytes),
                    }
                )

            elif "text" in data:
                text_msg = (data["text"] or "").strip().upper()

                if text_msg in ("EOS", "STOP"):
                    if len(accumulated_bytes) >= 44:
                        try:
                            validate_audio_format(bytes(accumulated_bytes))

                            res = await provider.speech_to_text(
                                bytes(accumulated_bytes),
                                lang_clean,
                            )

                            await websocket.send_json(
                                {
                                    "status": "completed",
                                    "transcription_mode": "batch_on_eos",
                                    "transcript": res.transcript,
                                    "confidence": res.confidence,
                                    "is_mock": False,
                                }
                            )
                        except Exception as exc:
                            await websocket.send_json(
                                {
                                    "status": "error",
                                    "transcription_mode": "batch_on_eos",
                                    "message": str(exc),
                                }
                            )
                    else:
                        await websocket.send_json(
                            {
                                "status": "error",
                                "transcription_mode": "batch_on_eos",
                                "message": "Empty or insufficient audio stream received.",
                            }
                        )

                    break

    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.send_json(
                {
                    "status": "error",
                    "message": "WebSocket streaming error occurred.",
                }
            )
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


@router.get("/config")
async def get_voice_config(
    account_id: str = Depends(current_farmer_session),
):
    """Returns voice configuration and credit protection status."""
    prisma_enabled = (
        settings.GNANI_LIVE_ENABLED
        and settings.GNANI_PRISMA_ENABLED
    )
    timbre_enabled = (
        settings.GNANI_LIVE_ENABLED
        and settings.GNANI_TIMBRE_ENABLED
    )

    if prisma_enabled and timbre_enabled:
        provider = "gnani_prisma_v3_and_timbre_v3"
    elif prisma_enabled:
        provider = "gnani_prisma_v3"
    elif timbre_enabled:
        provider = "gnani_timbre_v3"
    else:
        provider = "gnani_voice_providers_disabled"

    return {
        "live_enabled": settings.GNANI_LIVE_ENABLED,
        "allow_paid_live_calls": settings.GNANI_ALLOW_PAID_LIVE_CALLS,
        "prisma_enabled": prisma_enabled,
        "timbre_enabled": timbre_enabled,
        "provider": provider,
        "credits_protected": True,
        "gemini_stt_enabled": False,
        "stt_engine": (
            "Gnani Prisma v3.0; English hands-free uses browser SpeechRecognition"
            if prisma_enabled
            else "Gnani Prisma v3.0 is disabled; English browser SpeechRecognition remains available"
        ),
        "tts_engine": (
            "Gnani Timbre v3.0 WAV"
            if timbre_enabled
            else "Gnani Timbre v3.0 is disabled"
        ),
        "available_voices": [],
        "supported_languages": settings.SUPPORTED_LANGUAGES,
        "browser_speech_fallback_active": False,
    }
