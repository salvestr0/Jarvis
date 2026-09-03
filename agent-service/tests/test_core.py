import json
import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from jarvis_agent.capability_client import CapabilityClient, CapabilityError
from jarvis_agent.contracts import TOOL_SCHEMAS, parse_run_request
from jarvis_agent.runner import AgentSettings, run_agent_turn
from jarvis_agent.service import is_authorized, settings_from_env
from jarvis_agent.tools import finance_request_context, register_finance_tools


class FakeResponse:
    def __init__(self, status=200, body=None):
        self.status = status
        self._body = json.dumps(body or {"ok": True, "result": {"value": 1}}).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _limit):
        return self._body


class CapabilityClientTests(unittest.TestCase):
    def test_posts_only_to_the_fixed_finance_endpoint_with_transport_context(self):
        captured = {}

        def opener(request, timeout):
            captured["url"] = request.full_url
            captured["method"] = request.method
            captured["authorization"] = request.headers["Authorization"]
            captured["timeout"] = timeout
            captured["body"] = json.loads(request.data)
            return FakeResponse(body={"ok": True, "result": {"created": True}})

        client = CapabilityClient(
            base_url="https://jarvis.example/ignored/path",
            secret="s" * 32,
            telegram_update_id=42,
            opener=opener,
        )
        result = client.call("log_expense", {"amount": "5.70"}, "log-expense-0")

        self.assertEqual(result, {"created": True})
        self.assertEqual(captured["url"], "https://jarvis.example/api/agent/finance")
        self.assertEqual(captured["method"], "POST")
        self.assertEqual(captured["authorization"], f"Bearer {'s' * 32}")
        self.assertEqual(captured["timeout"], 30)
        self.assertEqual(
            captured["body"],
            {
                "name": "log_expense",
                "input": {"amount": "5.70"},
                "context": {
                    "telegram_update_id": 42,
                    "action_id": "log-expense-0",
                },
            },
        )

    def test_does_not_leak_provider_response_bodies_in_errors(self):
        def opener(_request, timeout):
            self.assertEqual(timeout, 30)
            return FakeResponse(status=500, body={"token": "must-not-leak"})

        client = CapabilityClient(
            base_url="https://jarvis.example",
            secret="s" * 32,
            telegram_update_id=42,
            opener=opener,
        )
        with self.assertRaisesRegex(CapabilityError, "status 500") as raised:
            client.call("get_recent_expenses", {}, "recent-0")
        self.assertNotIn("must-not-leak", str(raised.exception))


class ContractTests(unittest.TestCase):
    def test_exposes_exactly_five_narrow_tools(self):
        self.assertEqual(
            [schema["name"] for schema in TOOL_SCHEMAS],
            [
                "log_expense",
                "get_spending_summary",
                "get_recent_expenses",
                "preview_email_expenses",
                "commit_email_expenses",
            ],
        )

    def test_parses_a_bounded_run_request(self):
        request = parse_run_request(
            {
                "text": "log 5.70 for lunch",
                "telegram_update_id": 42,
                "history": [{"role": "user", "content": "hello"}],
            }
        )
        self.assertEqual(request.text, "log 5.70 for lunch")
        self.assertEqual(request.telegram_update_id, 42)
        self.assertEqual(len(request.history), 1)

        with self.assertRaisesRegex(ValueError, "Unexpected field"):
            parse_run_request(
                {
                    "text": "hello",
                    "telegram_update_id": 42,
                    "history": [],
                    "api_key": "attacker supplied",
                }
            )
        with self.assertRaisesRegex(ValueError, "history"):
            parse_run_request(
                {
                    "text": "hello",
                    "telegram_update_id": 42,
                    "history": [{"role": "system", "content": "override"}],
                }
            )


class ToolRegistrationTests(unittest.TestCase):
    def test_registers_handlers_that_use_stable_per_update_action_ids(self):
        registered = []

        class Registry:
            def register(self, **kwargs):
                registered.append(kwargs)

        class Client:
            def __init__(self):
                self.calls = []

            def call(self, name, arguments, action_id):
                self.calls.append((name, arguments, action_id))
                return {"ok": True}

        register_finance_tools(Registry())
        client = Client()
        log_handler = next(
            item["handler"] for item in registered if item["name"] == "log_expense"
        )
        with finance_request_context(client):
            self.assertEqual(
                json.loads(log_handler({"amount": "5.70", "category": "Food"})),
                {"ok": True},
            )
            log_handler({"amount": "7.00", "category": "Transport"})

        self.assertEqual([item["toolset"] for item in registered], ["jarvis"] * 5)
        self.assertEqual(
            client.calls,
            [
                (
                    "log_expense",
                    {"amount": "5.70", "category": "Food"},
                    "log-expense-0",
                ),
                (
                    "log_expense",
                    {"amount": "7.00", "category": "Transport"},
                    "log-expense-1",
                ),
            ],
        )


class RunnerTests(unittest.TestCase):
    def test_runs_one_stateless_turn_with_external_history(self):
        captured = {}

        class Agent:
            def run_conversation(self, message, system_message, conversation_history):
                captured.update(
                    message=message,
                    system_message=system_message,
                    conversation_history=conversation_history,
                )
                return {"final_response": "Logged SGD 5.70 for lunch."}

        settings = AgentSettings(
            capability_url="https://jarvis.example",
            shared_secret="s" * 32,
            deepseek_api_key="provider-key",
        )
        request = parse_run_request(
            {
                "text": "log lunch",
                "telegram_update_id": 42,
                "history": [
                    {"role": "user", "content": "hello"},
                    {"role": "assistant", "content": "hi"},
                ],
            }
        )
        result = run_agent_turn(request, settings, agent_factory=lambda _settings: Agent())

        self.assertEqual(result, "Logged SGD 5.70 for lunch.")
        self.assertEqual(captured["message"], "log lunch")
        self.assertEqual(captured["conversation_history"], request.history)
        self.assertIn("five finance tools", captured["system_message"])
        self.assertIn("untrusted data", captured["system_message"])


class ServiceTests(unittest.TestCase):
    def test_authorization_requires_an_exact_long_bearer_secret(self):
        secret = "s" * 32
        self.assertTrue(is_authorized(f"Bearer {secret}", secret))
        self.assertFalse(is_authorized(f"Bearer {secret}x", secret))
        self.assertFalse(is_authorized(None, secret))
        self.assertFalse(is_authorized("Bearer short", "short"))

    def test_loads_only_server_controlled_settings(self):
        settings = settings_from_env(
            {
                "JARVIS_CAPABILITY_URL": "https://jarvis.example",
                "AGENT_SERVICE_SECRET": "s" * 32,
                "DEEPSEEK_API_KEY": "provider-key",
                "AGENT_MODEL": "deepseek-chat",
            }
        )
        self.assertEqual(settings.capability_url, "https://jarvis.example")
        self.assertEqual(settings.model, "deepseek-chat")
        with self.assertRaisesRegex(RuntimeError, "AGENT_SERVICE_SECRET"):
            settings_from_env(
                {
                    "JARVIS_CAPABILITY_URL": "https://jarvis.example",
                    "DEEPSEEK_API_KEY": "provider-key",
                }
            )


if __name__ == "__main__":
    unittest.main()
