# diagram-studio

Turn plain-English prompts into Mermaid and SVG system architecture diagrams, powered by a provider-agnostic LLM harness (DeepSeek, OpenAI, Claude, Gemini, Ollama, ...).

**Stack:** Django (backend, harness, persistence) + React/Vite (frontend).

## Run

```bash
# backend
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp .env.example .env        # set LLM_PROVIDER and LLM_API_KEY
.venv/bin/python manage.py migrate
.venv/bin/python manage.py runserver   # :8000

# frontend (separate terminal)
cd frontend && npm install && npm run dev   # :5173, proxies /api to :8000
```

Tests: `cd backend && .venv/bin/python manage.py test`

## Choosing a model provider

Set in `backend/.env`:

| `LLM_PROVIDER` | Default model | Notes |
|---|---|---|
| `deepseek` | deepseek-chat | |
| `openai` | gpt-4.1 | |
| `anthropic` | claude-sonnet-5-5 | Claude Messages API |
| `gemini` | gemini-2.5-flash | via Google's OpenAI-compatible endpoint |
| `ollama` | llama3.1 | local, no key; run `ollama pull llama3.1` first |
| `openrouter` | anthropic/claude-sonnet-4.5 | |
| `openai_compatible` | (set `LLM_MODEL`) | any server; set `LLM_BASE_URL` |

`LLM_MODEL` and `LLM_BASE_URL` override the defaults. Adding a provider means one line in `PRESETS` in `backend/studio/llm.py`.
Larger models give much better diagrams than small local ones.

## How the harness works

1. `POST /api/diagrams/generate/` sends the prompt (plus the current diagram when iterating) to the configured model (JSON mode where the provider supports it): `{title, explanation, code}`.
2. Output is validated: SVG is parsed and sanitized (scripts, event handlers, external refs, DOCTYPE removed); Mermaid gets a structural check.
3. Invalid output is fed back to the model for up to `HARNESS_MAX_REPAIRS` (default 2) retries.
4. Mermaid is parsed by the browser's renderer; if it fails, the UI calls `POST /api/diagrams/<id>/repair/` with the error and the model fixes it (max 2 auto-repairs).
5. Every result is stored as a new version of the diagram.

Note: the API has no authentication and CSRF is disabled for it — it is meant for local use. Add auth before exposing it.
