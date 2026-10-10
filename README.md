# diagram-studio

Turn plain-English prompts into Mermaid and SVG system architecture diagrams, powered by a provider-agnostic LLM harness (DeepSeek, OpenAI, Claude, Gemini, Ollama, ...).

Also includes **Song Studio** (tab at the top of the app): write lyrics in one window and turn them into music in the other. See [Song Studio](#song-studio).

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

## Song Studio

Open the **Song Studio** tab (or `http://localhost:5173/#songs`). It has two windows:

1. **Lyrics**: pick a language (29 are available, including Hindi, Malayalam, Tamil, Spanish, Japanese and Arabic), a genre and a mood. Write lyrics yourself or have the LLM write or revise them. The LLM writes in the language's native script and idiom, not as a literal translation. Mark sections with `[Verse 1]`, `[Chorus]`, `[Bridge]` and so on. The gutter shows an approximate syllable count for each line so lines fit the beat.
2. **Music**: set the tempo, key and singer, then either:
   - **AI singer**: produces a full song (MP3) with a human-sounding singer performing your lyrics in the chosen language with native pronunciation (ElevenLabs Music, using a composition plan built from your sections). Needs `ELEVENLABS_API_KEY`.
   - **Studio preview**: plays instantly in the browser. It generates a backing track (drums, bass, chords, arpeggio, styled by genre) and voices each lyric line on the downbeat with highlighted, karaoke-style lines. The voice is a neural TTS voice if `TTS_PROVIDER` is set (`elevenlabs`, or `openai` with `OPENAI_API_KEY`). Otherwise it uses the best native voice the browser has for that language (Edge and Chrome "Natural" or "Google" voices sound most human). You can export the result as WAV. The preview voice speaks the lines in rhythm; it does not sing. Use the AI singer for real singing.

```bash
# backend/.env
ELEVENLABS_API_KEY=...       # sung vocals + native-sounding speech
TTS_PROVIDER=elevenlabs      # or openai; leave empty for browser voices
```

API: `GET/POST /api/songs/`, `GET/PATCH/DELETE /api/songs/<id>/`, `POST /api/songs/lyrics/`, `POST /api/songs/<id>/compose/` (returns `audio/mpeg`), `POST /api/songs/speak/`, `GET /api/songs/capabilities/`.
