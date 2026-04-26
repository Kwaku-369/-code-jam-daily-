"""
NVIDIA NIM (Inference Microservices) Adapter
=============================================
Source: NVIDIA NIM docs; developer.nvidia.com/nim; NGC console
Cloud:  NVIDIA API Catalog (cloud) OR self-hosted on DGX/A100/H100

NIM provides OpenAI-compatible REST APIs for:
  - LLMs  (Llama, Mistral, DeepSeek, Nemotron)
  - Embeddings (NV-Embed)
  - Vision models (Fuyu, CLIP)
  - Code models (CodeLlama, StarCoder)

Auth: NGC_API_KEY from environment (Factor III: no hardcoded secrets)
Install: pip install openai  (NIM is OpenAI-API compatible)

Clean Architecture: This file is the outermost adapter layer.
                    Implements AIPlugin and InferenceGateway ports.
"""

from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Any, Iterator


# ---- Available NIM models (2024-2025) ------------------------------------

NIM_MODELS = {
    # LLMs
    "llama-3.1-405b":    "meta/llama-3.1-405b-instruct",
    "llama-3.1-70b":     "meta/llama-3.1-70b-instruct",
    "llama-3.1-8b":      "meta/llama-3.1-8b-instruct",
    "llama-3-70b":       "meta/llama3-70b-instruct",
    "llama-3-8b":        "meta/llama3-8b-instruct",
    "mistral-7b":        "mistralai/mistral-7b-instruct-v0.3",
    "mixtral-8x7b":      "mistralai/mixtral-8x7b-instruct-v0.1",
    "mixtral-8x22b":     "mistralai/mixtral-8x22b-instruct-v0.1",
    "deepseek-r1":       "deepseek-ai/deepseek-r1",
    "nemotron-70b":      "nvidia/llama-3.1-nemotron-70b-instruct",
    "nemotron-reward":   "nvidia/nemotron-4-340b-reward",
    # Embeddings
    "nv-embed-v1":       "nvidia/nv-embed-v1",
    "nv-embed-v2":       "nvidia/llama-3.2-nv-embedqa-1b-v2",
    # Code
    "codellama-70b":     "meta/codellama-70b",
    # Vision
    "llama-3.2-vision":  "meta/llama-3.2-90b-vision-instruct",
}


# ---- Config (12-Factor: env-first) ----------------------------------------

@dataclass
class NIMConfig:
    api_key:   str  = field(default_factory=lambda: os.getenv("NGC_API_KEY", ""))
    base_url:  str  = field(default_factory=lambda: os.getenv("NIM_BASE_URL", "https://integrate.api.nvidia.com/v1"))
    model:     str  = field(default_factory=lambda: os.getenv("NIM_MODEL", "meta/llama-3.1-8b-instruct"))
    timeout:   int  = field(default_factory=lambda: int(os.getenv("NIM_TIMEOUT", "60")))
    max_tokens: int = field(default_factory=lambda: int(os.getenv("NIM_MAX_TOKENS", "1024")))
    temperature: float = field(default_factory=lambda: float(os.getenv("NIM_TEMPERATURE", "0.7")))

    def for_self_hosted(self, host: str = "localhost", port: int = 8000) -> "NIMConfig":
        """Point to a self-hosted NIM container."""
        self.base_url = f"http://{host}:{port}/v1"
        self.api_key  = "not-required"
        return self


# ---- NIM Client (OpenAI-compatible) --------------------------------------

class NIMClient:
    """
    Wraps the OpenAI SDK pointing at NIM endpoints.
    Cloud (NVIDIA API): api_key=NGC_API_KEY, base_url=integrate.api.nvidia.com/v1
    Self-hosted:        api_key="not-required", base_url=http://localhost:8000/v1
    """

    def __init__(self, config: NIMConfig | None = None):
        self.config = config or NIMConfig()
        self._client = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=self.config.api_key or "not-required",
                base_url=self.config.base_url,
                timeout=self.config.timeout,
            )
        except ImportError:
            raise ImportError("Install openai: pip install openai")
        return self._client

    # ---- Chat completion --------------------------------------------------

    def chat(
        self,
        messages: list[dict],
        model:       str | None = None,
        max_tokens:  int | None = None,
        temperature: float | None = None,
        stream:      bool = False,
        tools:       list[dict] | None = None,
    ) -> str | Iterator[str]:
        """
        Standard chat completion — same API as OpenAI, just different base_url.

        Production example:
            client = NIMClient(NIMConfig())
            reply  = client.chat([
                {"role": "system",  "content": "You are a financial analyst."},
                {"role": "user",    "content": "Summarize Q3 earnings for NVDA."},
            ])
        """
        client = self._get_client()
        kwargs: dict[str, Any] = {
            "model":       model or self.config.model,
            "messages":    messages,
            "max_tokens":  max_tokens or self.config.max_tokens,
            "temperature": temperature if temperature is not None else self.config.temperature,
            "stream":      stream,
        }
        if tools:
            kwargs["tools"] = tools

        response = client.chat.completions.create(**kwargs)

        if stream:
            def _gen():
                for chunk in response:
                    delta = chunk.choices[0].delta.content
                    if delta:
                        yield delta
            return _gen()

        return response.choices[0].message.content

    def chat_with_tools(
        self,
        messages:  list[dict],
        tools:     list[dict],   # OpenAI tool schema
        model:     str | None = None,
    ) -> dict:
        """
        Function calling (tool use) via NIM.
        Returns the full message dict for multi-turn tool loops.
        """
        client  = self._get_client()
        response = client.chat.completions.create(
            model=model or self.config.model,
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )
        msg = response.choices[0].message
        return {
            "role":       "assistant",
            "content":    msg.content,
            "tool_calls": [tc.model_dump() for tc in (msg.tool_calls or [])],
        }

    # ---- Embeddings -------------------------------------------------------

    def embed(self, texts: list[str], model: str = "nvidia/nv-embed-v1") -> list[list[float]]:
        """
        Generate embeddings using NV-Embed.
        Returns list of float vectors, one per input text.
        """
        client   = self._get_client()
        response = client.embeddings.create(
            model=model,
            input=texts,
            encoding_format="float",
        )
        return [item.embedding for item in response.data]

    # ---- Streaming chat --------------------------------------------------

    def stream_chat(self, messages: list[dict], model: str | None = None) -> Iterator[str]:
        """Yield text tokens as they arrive — for real-time UIs."""
        return self.chat(messages, model=model, stream=True)

    # ---- Health -----------------------------------------------------------

    def health(self) -> bool:
        try:
            client = self._get_client()
            # Minimal call to check connectivity
            client.models.list()
            return True
        except Exception:
            return False

    def list_models(self) -> list[str]:
        try:
            models = self._get_client().models.list()
            return [m.id for m in models.data]
        except Exception:
            return list(NIM_MODELS.values())


# ---- Agentic RAG via NIM + NV-Embed --------------------------------------

class NIMAgenticRAG:
    """
    Full agentic RAG pipeline using NIM:
      1. Embed query with nv-embed-v1
      2. Retrieve from vector store
      3. Grade relevance (NIM LLM call)
      4. Generate answer (NIM LLM call)

    Mirrors CRAG pattern from langchain/rag_pipeline.py but
    uses NVIDIA NIM for both embedding and generation.
    """

    def __init__(self, nim_client: NIMClient, vector_store: Any = None):
        self.nim   = nim_client
        self._store = vector_store or []   # stub; replace with Pinecone/Weaviate/pgvector

    def index(self, documents: list[str]) -> None:
        embeddings = self.nim.embed(documents, model="nvidia/nv-embed-v1")
        self._store = list(zip(documents, embeddings))
        print(f"[NIM-RAG] Indexed {len(documents)} documents")

    def _retrieve(self, query: str, k: int = 4) -> list[str]:
        if not self._store:
            return []
        q_emb = self.nim.embed([query])[0]
        import math
        def cosine(a, b):
            dot = sum(x*y for x, y in zip(a, b))
            m   = math.sqrt(sum(x**2 for x in a)) * math.sqrt(sum(x**2 for x in b))
            return dot / m if m else 0.0
        scored = sorted(self._store, key=lambda x: cosine(q_emb, x[1]), reverse=True)
        return [doc for doc, _ in scored[:k]]

    def _grade(self, doc: str, query: str) -> bool:
        reply = self.nim.chat([
            {"role": "user", "content": f"Is this document relevant to the query?\nQuery: {query}\nDoc: {doc[:200]}\nAnswer YES or NO only."}
        ], max_tokens=5, temperature=0.0)
        return "YES" in (reply or "").upper()

    def query(self, question: str, use_crag: bool = True) -> str:
        docs = self._retrieve(question)
        if use_crag:
            docs = [d for d in docs if self._grade(d, question)]
        if not docs:
            docs = [f"[no relevant documents found for: {question}]"]

        context = "\n\n---\n".join(docs)
        return self.nim.chat([
            {"role": "system", "content": "Answer based on the provided context only."},
            {"role": "user",   "content": f"Context:\n{context}\n\nQuestion: {question}"},
        ])


# ---- Clean Architecture adapter ------------------------------------------

class NIMInferenceGateway:
    """Implements InferenceGateway port using NIMClient."""
    def __init__(self, client: NIMClient):
        self._client = client

    def predict(self, model_id: Any, inputs: dict) -> dict:
        model_name = model_id.value if hasattr(model_id, "value") else str(model_id)
        prompt = inputs.get("prompt") or str(inputs)
        response = self._client.chat(
            messages=[{"role": "user", "content": prompt}],
            model=NIM_MODELS.get(model_name, model_name),
        )
        return {"output": response, "confidence": 0.95}

    def health(self) -> bool:
        return self._client.health()


# ---------------------------------------------------------------------------
# Usage examples (no API call made — stubs shown)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== NIM Models Available ===")
    for alias, full_name in NIM_MODELS.items():
        print(f"  {alias:25s} → {full_name}")

    print("\n=== NIM Config (from env) ===")
    cfg = NIMConfig()
    print(f"  Model:    {cfg.model}")
    print(f"  Base URL: {cfg.base_url}")
    print(f"  API key set: {bool(cfg.api_key)}")

    print("\n=== Self-hosted NIM ===")
    self_cfg = NIMConfig().for_self_hosted("triton-host", 8000)
    print(f"  Base URL: {self_cfg.base_url}")

    print("\n=== Tool schema example ===")
    import json
    tool = {
        "type": "function",
        "function": {
            "name": "get_stock_price",
            "description": "Get current stock price for a ticker",
            "parameters": {
                "type": "object",
                "properties": {
                    "ticker": {"type": "string", "description": "Stock ticker e.g. NVDA"},
                },
                "required": ["ticker"],
            },
        },
    }
    print(json.dumps(tool, indent=2)[:300])

    print("\nProduction: set NGC_API_KEY=<your_key> and call NIMClient().chat([...])")
