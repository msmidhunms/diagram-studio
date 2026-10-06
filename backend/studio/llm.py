"""Provider-agnostic LLM client.

Two adapters cover the common providers:
  - OpenAI-style chat API: OpenAI, DeepSeek, Gemini (OpenAI-compat endpoint),
    Ollama, OpenRouter, or any other compatible server.
  - Anthropic Messages API: Claude.
Both expose `complete(messages) -> str` where messages use OpenAI-style roles
(a leading "system" message is allowed).
"""
from django.conf import settings

PRESETS = {
    # provider: (adapter, base_url, default_model, needs_key)
    'openai':    ('openai', None, 'gpt-4.1', True),
    'deepseek':  ('openai', 'https://api.deepseek.com', 'deepseek-chat', True),
    'gemini':    ('openai', 'https://generativelanguage.googleapis.com/v1beta/openai/', 'gemini-2.5-flash', True),
    'ollama':    ('openai', 'http://localhost:11434/v1', 'llama3.1', False),
    'openrouter': ('openai', 'https://openrouter.ai/api/v1', 'anthropic/claude-sonnet-4.5', True),
    'anthropic': ('anthropic', None, 'claude-sonnet-5-5', True),
    # any other OpenAI-compatible server: set LLM_BASE_URL and LLM_MODEL
    'openai_compatible': ('openai', None, None, False),
}


class LLMConfigError(RuntimeError):
    pass


class OpenAIChat:
    def __init__(self, api_key, base_url, model):
        from openai import OpenAI
        self.model = model
        self.client = OpenAI(api_key=api_key or 'not-needed', base_url=base_url)

    def complete(self, messages) -> str:
        resp = self.client.chat.completions.create(
            model=self.model, messages=messages, temperature=0.2, max_tokens=8000,
            response_format={'type': 'json_object'})
        return resp.choices[0].message.content or ''


class AnthropicChat:
    def __init__(self, api_key, model):
        import anthropic
        self.model = model
        self.client = anthropic.Anthropic(api_key=api_key)

    def complete(self, messages) -> str:
        system = '\n\n'.join(m['content'] for m in messages if m['role'] == 'system')
        turns = [m for m in messages if m['role'] != 'system']
        resp = self.client.messages.create(
            model=self.model, system=system, messages=turns, max_tokens=8000, temperature=0.2)
        return ''.join(b.text for b in resp.content if b.type == 'text')


def get_llm():
    provider = settings.LLM_PROVIDER.lower()
    if provider not in PRESETS:
        raise LLMConfigError(f'Unknown LLM_PROVIDER "{provider}". Options: {", ".join(PRESETS)}')
    adapter, base_url, model, needs_key = PRESETS[provider]
    base_url = settings.LLM_BASE_URL or base_url
    model = settings.LLM_MODEL or model
    if not model:
        raise LLMConfigError('LLM_MODEL is required for this provider')
    if provider == 'openai_compatible' and not base_url:
        raise LLMConfigError('LLM_BASE_URL is required for openai_compatible')
    if needs_key and not settings.LLM_API_KEY:
        raise LLMConfigError(f'LLM_API_KEY is not set (provider: {provider})')
    if adapter == 'anthropic':
        return AnthropicChat(settings.LLM_API_KEY, model)
    return OpenAIChat(settings.LLM_API_KEY, base_url, model)
