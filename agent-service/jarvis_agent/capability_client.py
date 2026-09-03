from __future__ import annotations

import json
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit, urlunsplit
from urllib.request import Request, urlopen


class CapabilityError(RuntimeError):
    pass


class CapabilityClient:
    def __init__(
        self,
        *,
        base_url: str,
        secret: str,
        telegram_update_id: int,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        parsed = urlsplit(base_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("Capability base URL must be HTTPS.")
        if len(secret) < 32:
            raise ValueError("Capability secret must be at least 32 characters.")
        if not isinstance(telegram_update_id, int) or not 0 <= telegram_update_id <= 9_007_199_254_740_991:
            raise ValueError("Invalid Telegram update id.")
        self._url = urlunsplit((parsed.scheme, parsed.netloc, "/api/agent/finance", "", ""))
        self._secret = secret
        self._update_id = telegram_update_id
        self._opener = opener

    def call(self, name: str, arguments: dict[str, Any], action_id: str) -> Any:
        payload = json.dumps(
            {
                "name": name,
                "input": arguments,
                "context": {
                    "telegram_update_id": self._update_id,
                    "action_id": action_id,
                },
            },
            separators=(",", ":"),
        ).encode("utf-8")
        request = Request(
            self._url,
            data=payload,
            method="POST",
            headers={
                "Authorization": f"Bearer {self._secret}",
                "Content-Type": "application/json",
            },
        )
        try:
            response_context = self._opener(request, timeout=30)
            with response_context as response:
                if response.status != 200:
                    raise CapabilityError(f"Finance capability returned status {response.status}.")
                body = response.read(1_000_001)
        except HTTPError as error:
            raise CapabilityError(f"Finance capability returned status {error.code}.") from None
        except URLError:
            raise CapabilityError("Finance capability is unavailable.") from None

        if len(body) > 1_000_000:
            raise CapabilityError("Finance capability response was too large.")
        try:
            decoded = json.loads(body)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise CapabilityError("Finance capability returned malformed JSON.") from None
        if not isinstance(decoded, dict) or decoded.get("ok") is not True or "result" not in decoded:
            raise CapabilityError("Finance capability returned an invalid response.")
        return decoded["result"]
