from __future__ import annotations

import json
from collections import defaultdict
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any, Iterator, Protocol

from .contracts import TOOL_SCHEMAS


class FinanceClient(Protocol):
    def call(self, name: str, arguments: dict[str, Any], action_id: str) -> Any: ...


@dataclass
class _RequestTools:
    client: FinanceClient
    counters: dict[str, int] = field(default_factory=lambda: defaultdict(int))

    def next_action_id(self, name: str) -> str:
        index = self.counters[name]
        self.counters[name] += 1
        return f"{name.replace('_', '-')}-{index}"


_current: ContextVar[_RequestTools | None] = ContextVar("jarvis_finance_tools", default=None)


@contextmanager
def finance_request_context(client: FinanceClient) -> Iterator[None]:
    token = _current.set(_RequestTools(client=client))
    try:
        yield
    finally:
        _current.reset(token)


def _execute(name: str, arguments: dict[str, Any]) -> str:
    request = _current.get()
    if request is None:
        raise RuntimeError("Finance tool called outside an active request.")
    result = request.client.call(name, arguments, request.next_action_id(name))
    return json.dumps(result, separators=(",", ":"))


def register_finance_tools(registry: Any) -> None:
    for schema in TOOL_SCHEMAS:
        name = schema["name"]

        def handler(arguments: dict[str, Any], _name: str = name, **_kwargs: Any) -> str:
            return _execute(_name, arguments)

        registry.register(
            name=name,
            toolset="jarvis",
            schema=schema,
            handler=handler,
        )
