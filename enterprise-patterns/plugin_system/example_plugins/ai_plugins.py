"""
Example Plugins — AI / LLM Suite
-----------------------------------
Concrete AIPlugin implementations:
  - ClaudePlugin     (Anthropic)
  - OpenAIPlugin     (OpenAI)
  - LocalLLMPlugin   (Ollama / HuggingFace local)
  - RAGPlugin        (combines vector search + LLM)

Each wraps a real SDK — replace stubs with actual client calls.
See claude-api skill for Anthropic SDK best practices.
"""

from __future__ import annotations
from typing import Any

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from plugin_interface import AIPlugin, PluginMetadata


class ClaudePlugin(AIPlugin):
    """
    Production: from anthropic import Anthropic
    Replace _client with Anthropic() and call messages.create().
    Uses prompt caching for repeated system prompts.
    """
    _model: str = "claude-opus-4-7"
    _system: str = ""
    _client: Any = None

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="claude",
            version="1.0.0",
            description="Anthropic Claude LLM inference with prompt caching",
            author="ai-team",
            tags=("ai", "llm", "anthropic", "claude"),
        )

    def initialize(self, config: dict[str, Any]) -> None:
        self._model  = config.get("model", "claude-opus-4-7")
        self._system = config.get("system_prompt", "You are a helpful assistant.")
        api_key      = config.get("api_key", "")

        # Production init:
        # from anthropic import Anthropic
        # self._client = Anthropic(api_key=api_key)
        print(f"    [Claude] Initialized model={self._model}")

    def infer(self, prompt: str) -> str:
        # Production call with prompt caching:
        # response = self._client.messages.create(
        #     model=self._model,
        #     max_tokens=2048,
        #     system=[{"type": "text", "text": self._system,
        #              "cache_control": {"type": "ephemeral"}}],
        #     messages=[{"role": "user", "content": prompt}],
        # )
        # return response.content[0].text
        return f"[Claude stub] Response to: {prompt[:60]}"


class OpenAIPlugin(AIPlugin):
    _model: str = "gpt-4o"
    _client: Any = None

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="openai",
            version="1.0.0",
            description="OpenAI GPT inference",
            author="ai-team",
            tags=("ai", "llm", "openai", "gpt"),
        )

    def initialize(self, config: dict[str, Any]) -> None:
        self._model = config.get("model", "gpt-4o")
        api_key     = config.get("api_key", "")
        # from openai import OpenAI
        # self._client = OpenAI(api_key=api_key)
        print(f"    [OpenAI] Initialized model={self._model}")

    def infer(self, prompt: str) -> str:
        # response = self._client.chat.completions.create(
        #     model=self._model,
        #     messages=[{"role": "user", "content": prompt}],
        # )
        # return response.choices[0].message.content
        return f"[OpenAI stub] Response to: {prompt[:60]}"


class LocalLLMPlugin(AIPlugin):
    """Wraps Ollama local inference (no API key needed)."""
    _model: str = "llama3"
    _base_url: str = "http://localhost:11434"

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="local_llm",
            version="1.0.0",
            description="Local LLM inference via Ollama",
            author="ai-team",
            tags=("ai", "llm", "local", "ollama", "privacy"),
        )

    def initialize(self, config: dict[str, Any]) -> None:
        self._model    = config.get("model", "llama3")
        self._base_url = config.get("base_url", "http://localhost:11434")
        print(f"    [LocalLLM] Initialized model={self._model} at {self._base_url}")

    def infer(self, prompt: str) -> str:
        # import requests
        # resp = requests.post(f"{self._base_url}/api/generate",
        #     json={"model": self._model, "prompt": prompt, "stream": False})
        # return resp.json()["response"]
        return f"[Ollama/{self._model} stub] {prompt[:60]}"


class RAGPlugin(AIPlugin):
    """Combines vector retrieval + LLM generation."""
    _llm_plugin: AIPlugin | None = None
    _vector_store: Any = None
    _k: int = 4

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="rag",
            version="1.0.0",
            description="Retrieval-Augmented Generation plugin",
            author="ai-team",
            tags=("ai", "rag", "retrieval", "knowledge-base"),
        )

    def initialize(self, config: dict[str, Any]) -> None:
        self._k = config.get("k", 4)
        llm_cls = config.get("llm_plugin_class")
        if llm_cls:
            self._llm_plugin = llm_cls()
            self._llm_plugin.initialize(config.get("llm_config", {}))
        print(f"    [RAG] Initialized k={self._k}")

    def infer(self, prompt: str) -> str:
        # 1. Retrieve (stub)
        context = f"[retrieved context for: {prompt[:40]}]"
        # 2. Generate
        full_prompt = f"Context: {context}\n\nQuestion: {prompt}\n\nAnswer:"
        if self._llm_plugin:
            return self._llm_plugin.infer(full_prompt)
        return f"[RAG stub] {full_prompt[:80]}"
