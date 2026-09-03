from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class HistoryTurn:
    role: str
    content: str


@dataclass(frozen=True)
class RunRequest:
    text: str
    telegram_update_id: int
    history: list[dict[str, str]]


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object.")
    return value


def parse_run_request(value: Any) -> RunRequest:
    payload = _object(value, "request")
    unexpected = set(payload) - {"text", "telegram_update_id", "history"}
    if unexpected:
        raise ValueError(f"Unexpected field: {sorted(unexpected)[0]}")

    text = payload.get("text")
    if not isinstance(text, str) or not text.strip() or len(text) > 4_000:
        raise ValueError("text must contain between 1 and 4000 characters.")
    update_id = payload.get("telegram_update_id")
    if (
        not isinstance(update_id, int)
        or isinstance(update_id, bool)
        or not 0 <= update_id <= 9_007_199_254_740_991
    ):
        raise ValueError("telegram_update_id is invalid.")
    history_value = payload.get("history", [])
    if not isinstance(history_value, list) or len(history_value) > 20:
        raise ValueError("history must be an array of at most 20 turns.")

    history: list[dict[str, str]] = []
    expected_role = "user"
    for index, raw_turn in enumerate(history_value):
        turn = _object(raw_turn, f"history[{index}]")
        if set(turn) != {"role", "content"}:
            raise ValueError(f"history[{index}] has invalid fields.")
        role = turn.get("role")
        content = turn.get("content")
        if role != expected_role or not isinstance(content, str) or not content or len(content) > 4_000:
            raise ValueError("history must contain bounded, alternating user and assistant turns.")
        history.append({"role": role, "content": content})
        expected_role = "assistant" if expected_role == "user" else "user"

    return RunRequest(text=text.strip(), telegram_update_id=update_id, history=history)


TOOL_SCHEMAS = [
    {
        "name": "log_expense",
        "description": "Log one confirmed expense in SGD. Never use for income.",
        "parameters": {
            "type": "object",
            "properties": {
                "amount": {"type": "string", "description": "Positive SGD amount, e.g. 5.70"},
                "category": {"type": "string"},
                "note": {"type": "string"},
                "date": {"type": "string", "description": "Optional YYYY-MM-DD"},
            },
            "required": ["amount", "category"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_spending_summary",
        "description": "Get income, expense, net, and category totals for one month.",
        "parameters": {
            "type": "object",
            "properties": {"month": {"type": "string", "description": "Optional YYYY-MM"}},
            "additionalProperties": False,
        },
    },
    {
        "name": "get_recent_expenses",
        "description": "Get the most recent expense transactions.",
        "parameters": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 20}},
            "additionalProperties": False,
        },
    },
    {
        "name": "preview_email_expenses",
        "description": "Read recent transaction emails only from configured financial senders. This never writes transactions.",
        "parameters": {
            "type": "object",
            "properties": {"days": {"type": "integer", "minimum": 1, "maximum": 30}},
            "additionalProperties": False,
        },
    },
    {
        "name": "commit_email_expenses",
        "description": "After explicit confirmation in a later Telegram message, commit selected items from an email preview batch.",
        "parameters": {
            "type": "object",
            "properties": {
                "batch_id": {"type": "string", "format": "uuid"},
                "items": {
                    "type": "array",
                    "minItems": 1,
                    "maxItems": 20,
                    "items": {
                        "type": "object",
                        "properties": {
                            "index": {"type": "integer", "minimum": 0},
                            "amount": {"type": "string"},
                            "category": {"type": "string"},
                            "note": {"type": "string"},
                            "date": {"type": "string", "description": "Optional YYYY-MM-DD"},
                        },
                        "required": ["index", "amount", "category"],
                        "additionalProperties": False,
                    },
                },
            },
            "required": ["batch_id", "items"],
            "additionalProperties": False,
        },
    },
]
