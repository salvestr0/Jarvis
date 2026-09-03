from __future__ import annotations

import hmac
from collections.abc import Mapping

from .runner import AgentSettings


def is_authorized(authorization: str | None, configured_secret: str | None) -> bool:
    if not configured_secret or len(configured_secret) < 32 or not authorization:
        return False
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        return False
    return hmac.compare_digest(authorization[len(prefix) :], configured_secret)


def settings_from_env(environment: Mapping[str, str]) -> AgentSettings:
    required = ["JARVIS_CAPABILITY_URL", "AGENT_SERVICE_SECRET", "DEEPSEEK_API_KEY"]
    missing = [name for name in required if not environment.get(name)]
    if missing:
        raise RuntimeError(f"Missing required setting: {missing[0]}")
    if len(environment["AGENT_SERVICE_SECRET"]) < 32:
        raise RuntimeError("AGENT_SERVICE_SECRET must be at least 32 characters.")
    model = environment.get("AGENT_MODEL", "deepseek-chat")
    if model != "deepseek-chat":
        raise RuntimeError("AGENT_MODEL must be deepseek-chat for this deployment.")
    return AgentSettings(
        capability_url=environment["JARVIS_CAPABILITY_URL"],
        shared_secret=environment["AGENT_SERVICE_SECRET"],
        deepseek_api_key=environment["DEEPSEEK_API_KEY"],
        model=model,
    )
