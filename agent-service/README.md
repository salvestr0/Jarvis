# Jarvis Hermes Agent Service

A stateless Vercel Python function that runs one bounded Hermes `AIAgent` turn.
It has exactly five registered finance tools, all of which call the authenticated
narrow capability endpoint in the main Jarvis Next.js application.

Hermes is pinned as a Git submodule at release `v2026.8.31`; it is imported from
source because the official project does not publish a supported installable
wheel. Python dependencies are exported from that release's locked environment.

## Environment

- `AGENT_SERVICE_SECRET` — shared random secret, at least 32 characters
- `JARVIS_CAPABILITY_URL` — HTTPS origin of the main Jarvis app
- `DEEPSEEK_API_KEY` — model-provider credential
- `AGENT_MODEL` — optional; only `deepseek-chat` is accepted

## Checks

```bash
python -m unittest discover -s tests -v
python -m compileall -q api jarvis_agent
```
