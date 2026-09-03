from __future__ import annotations

import json
import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from jarvis_agent.contracts import parse_run_request
from jarvis_agent.runner import run_agent_turn
from jarvis_agent.service import is_authorized, settings_from_env

logger = logging.getLogger(__name__)
app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)


@app.get("/health")
def health() -> dict[str, object]:
    return {"ok": True, "service": "jarvis-hermes-agent", "tool_count": 5}


@app.post("/run")
async def run(request: Request) -> JSONResponse:
    configured_secret = os.environ.get("AGENT_SERVICE_SECRET")
    if not is_authorized(request.headers.get("authorization"), configured_secret):
        return JSONResponse({"error": "Unauthorized."}, status_code=401)

    body = await request.body()
    if len(body) > 64 * 1024:
        return JSONResponse({"error": "Request is too large."}, status_code=413)
    try:
        payload = json.loads(body)
        run_request = parse_run_request(payload)
        settings = settings_from_env(os.environ)
    except (json.JSONDecodeError, ValueError, RuntimeError) as error:
        return JSONResponse({"error": str(error)}, status_code=400)

    try:
        response = await run_in_threadpool(run_agent_turn, run_request, settings)
        return JSONResponse({"ok": True, "response": response})
    except Exception as error:
        logger.error("Hermes agent turn failed: %s", type(error).__name__)
        return JSONResponse({"error": "Agent turn failed."}, status_code=502)
