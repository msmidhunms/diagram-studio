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

Tests: `cd backend && .venv/bin/python manage.py test` and `cd frontend && npm test`

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

1. `POST /api/diagrams/generate/` sends the prompt (plus the current system model when iterating) to the configured model (JSON mode where the provider supports it). It returns `{title, explanation, model}`, a structured system model of groups/trust zones, typed nodes and styled edges (`backend/studio/sysmodel.py`).
2. The model is validated (duplicate ids, dangling edges, group cycles) and then rendered without the LLM:
   - **Auto-layout:** in the browser, ELK computes positions and orthogonal edge routes and `frontend/src/autolayout.js` draws the SVG.
   - **Mermaid:** in Python (`render_mermaid.py`), stored as the version's code.

   Both views come from the same model, so switching views needs no LLM call, and each version reports which components changed.
3. Invalid output is fed back to the model for up to `HARNESS_MAX_REPAIRS` (default 2) retries.
   **Generator + critic.** Each valid draft is then reviewed by a separate critic agent (`critic.py`): deterministic checks (orphan nodes, self-loops, duplicate edges, empty groups, size) plus an LLM review of completeness, edge direction and style, grouping/trust zones, readability and, for edits, whether only the requested change was made. Major issues go back to the generator for up to `HARNESS_CRITIC_ROUNDS` (default 1) revisions; the best-reviewed draft is kept. The score and issues are stored on the version and shown in the UI. Set `HARNESS_CRITIC_ROUNDS=0` to review without revising, `-1` to turn the critic off, and `LLM_CRITIC_MODEL` to review with a different model from the same provider.
4. Mermaid is parsed by the browser's renderer; if it fails, the UI calls `POST /api/diagrams/<id>/repair/` with the error and the model fixes it (max 2 auto-repairs).
5. Every result is stored as a new version of the diagram, with its prompt and system model.

**Views:** Full, High-level, Deployment, Data flow and Sequence are derived from the same model in the browser (`frontend/src/views.js`), so switching is instant and exports follow the selected view.

**Compare versions:** pick "Compare with vN" to see added (green), removed (red) and changed (amber) components and connections on the canvas, in any view except Sequence.

**Cloud icons:** components that are managed AWS, Azure or GCP services get an `icon` key from `shared/cloud_icons.json` (shared by backend and frontend). The backend serves the artwork at `/api/icons/<key>.svg`, fetched once, sanitized and cached in `backend/.icon_cache/`, because the icon CDNs don't reliably allow browser requests. Without network access, icons fall back to a provider badge.

**Exports** (all from the system model, no LLM call): SVG, PNG, Mermaid, Draw.io, Excalidraw, PlantUML, C4 container (C4-PlantUML), D2 and the raw model JSON. Draw.io and Excalidraw files use the same ELK layout as the Auto-layout view (`frontend/src/exporters/`).


Note: the API has no authentication and CSRF is disabled for it — it is meant for local use. Add auth before exposing it.
