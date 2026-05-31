"""
LangChain — Memory Patterns (Short-Term, Long-Term, Hybrid, MemGPT)
---------------------------------------------------------------------
Pattern: Give agents persistent context across turns and sessions.
Source:  langchain-ai/langchain memory docs; Mem0 library; MemGPT paper (2023)
Sector:  Customer support, personalized assistants, multi-session agents.

Variants ranked by complexity:
  1. Buffer Memory       — keep last N messages (simplest)
  2. Summary Memory      — compress history into a rolling summary
  3. Vector Memory       — semantic retrieval of past interactions
  4. Hybrid STM/LTM      — recency + relevance combined
  5. MemGPT              — autonomous context management (OS-style)

Tradeoffs:
  Buffer:  fast, cheap, but context window fills up
  Summary: compact, loses detail
  Vector:  rich retrieval, needs embedding infra
  Hybrid:  best quality, most complex
  MemGPT:  autonomous but 2-3x token cost
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
import math


# ---- Shared Document primitive -------------------------------------------

@dataclass
class MemoryEntry:
    content: str
    role: str = "user"          # user | assistant | system
    metadata: dict = field(default_factory=dict)
    embedding: list[float] | None = None


# ---- 1. Buffer Memory (sliding window) -----------------------------------

@dataclass
class BufferMemory:
    """Keep the last `max_messages` message pairs."""
    max_messages: int = 20
    _buffer: list[MemoryEntry] = field(default_factory=list)

    def add(self, content: str, role: str = "user"):
        self._buffer.append(MemoryEntry(content=content, role=role))
        if len(self._buffer) > self.max_messages:
            self._buffer.pop(0)

    def load(self) -> list[dict]:
        return [{"role": e.role, "content": e.content} for e in self._buffer]

    def clear(self):
        self._buffer.clear()


# ---- 2. Summary Memory (rolling compression) -----------------------------

@dataclass
class SummaryMemory:
    """
    Compress conversation into a rolling summary.
    Replace `_summarize` with real LLM call.
    """
    summary: str = ""
    _buffer: list[MemoryEntry] = field(default_factory=list)
    compress_every: int = 10

    def _summarize(self, messages: list[MemoryEntry], existing: str) -> str:
        combined = "\n".join(f"{m.role}: {m.content}" for m in messages)
        return f"[summary] {existing} | {combined[:200]}..."   # stub

    def add(self, content: str, role: str = "user"):
        self._buffer.append(MemoryEntry(content=content, role=role))
        if len(self._buffer) >= self.compress_every:
            self.summary = self._summarize(self._buffer, self.summary)
            self._buffer.clear()

    def load(self) -> list[dict]:
        messages = []
        if self.summary:
            messages.append({"role": "system", "content": f"Summary: {self.summary}"})
        messages.extend({"role": e.role, "content": e.content} for e in self._buffer)
        return messages


# ---- Minimal cosine vector store (no deps) --------------------------------

def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    mag = math.sqrt(sum(x**2 for x in a)) * math.sqrt(sum(x**2 for x in b))
    return dot / mag if mag else 0.0

def _stub_embed(text: str) -> list[float]:
    """Replace with real embedding model call."""
    return [float(ord(c) % 10) / 10 for c in text[:16].ljust(16)]


# ---- 3. Vector Memory (semantic retrieval) --------------------------------

@dataclass
class VectorMemory:
    """Retrieve semantically similar past messages — not just recent ones."""
    k: int = 4
    _store: list[MemoryEntry] = field(default_factory=list)

    def add(self, content: str, role: str = "user", metadata: dict | None = None):
        entry = MemoryEntry(
            content=content,
            role=role,
            metadata=metadata or {},
            embedding=_stub_embed(content),
        )
        self._store.append(entry)

    def retrieve(self, query: str) -> list[dict]:
        q_emb = _stub_embed(query)
        scored = sorted(
            self._store,
            key=lambda e: _cosine(q_emb, e.embedding or []),
            reverse=True,
        )
        return [{"role": e.role, "content": e.content} for e in scored[:self.k]]

    def load(self, query: str = "") -> list[dict]:
        return self.retrieve(query) if query else [
            {"role": e.role, "content": e.content} for e in self._store[-self.k:]
        ]


# ---- 4. Hybrid STM / LTM Memory ------------------------------------------

@dataclass
class HybridMemory:
    """
    Combines:
      - Short-term: last N messages (recency)
      - Long-term:  semantic vector store (relevance)
      - Profile:    direct key-value facts (user name, preferences)
    """
    stm_window: int = 6
    ltm_k: int = 3
    _stm: list[MemoryEntry] = field(default_factory=list)
    _ltm: VectorMemory = field(default_factory=VectorMemory)
    _profile: dict[str, Any] = field(default_factory=dict)

    def remember_fact(self, key: str, value: Any):
        """Store an explicit fact (e.g. user_name, preferred_language)."""
        self._profile[key] = value

    def add(self, content: str, role: str = "user"):
        entry = MemoryEntry(content=content, role=role)
        self._stm.append(entry)
        self._ltm.add(content, role)
        if len(self._stm) > self.stm_window * 2:
            self._stm.pop(0)

    def load(self, current_query: str = "") -> list[dict]:
        messages = []
        if self._profile:
            profile_str = ", ".join(f"{k}={v}" for k, v in self._profile.items())
            messages.append({"role": "system", "content": f"User profile: {profile_str}"})

        if current_query:
            ltm_results = self._ltm.retrieve(current_query)
            if ltm_results:
                ctx = "\n".join(m["content"] for m in ltm_results[:self.ltm_k])
                messages.append({"role": "system", "content": f"Relevant past context:\n{ctx}"})

        recent = self._stm[-self.stm_window:]
        messages.extend({"role": e.role, "content": e.content} for e in recent)
        return messages


# ---- 5. MemGPT-style Autonomous Memory ------------------------------------

@dataclass
class MemGPTMemory:
    """
    OS-style memory: working memory (in-context) + archival (vector).
    Agent autonomously decides what to archive vs. keep in context.
    Source: Packer et al. 2023 "MemGPT: Towards LLMs as Operating Systems"
    """
    context_limit: int = 4096    # tokens
    _working: list[MemoryEntry] = field(default_factory=list)
    _archive: VectorMemory = field(default_factory=VectorMemory)

    def _estimate_tokens(self, messages: list[MemoryEntry]) -> int:
        return sum(len(m.content.split()) * 4 // 3 for m in messages)  # approx

    def _compress_to_archive(self):
        """Move oldest messages to vector archive."""
        evict_count = max(1, len(self._working) // 4)
        to_archive = self._working[:evict_count]
        for entry in to_archive:
            self._archive.add(entry.content, entry.role)
        self._working = self._working[evict_count:]
        print(f"[MemGPT] Archived {evict_count} messages to vector store.")

    def add(self, content: str, role: str = "user"):
        self._working.append(MemoryEntry(content=content, role=role))
        if self._estimate_tokens(self._working) > self.context_limit * 0.9:
            self._compress_to_archive()

    def load(self, current_query: str = "") -> list[dict]:
        messages = []
        if current_query:
            archived = self._archive.retrieve(current_query)
            if archived:
                ctx = "\n".join(m["content"] for m in archived[:3])
                messages.append({"role": "system", "content": f"Archived memory:\n{ctx}"})
        messages.extend({"role": e.role, "content": e.content} for e in self._working)
        return messages


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== Hybrid Memory ===")
    mem = HybridMemory()
    mem.remember_fact("user_name", "Alice")
    mem.remember_fact("language", "Python")
    mem.add("How do I sort a list?", role="user")
    mem.add("Use list.sort() or sorted(list).", role="assistant")
    mem.add("What about sorting dicts?", role="user")

    context = mem.load(current_query="sorting dictionaries")
    for msg in context:
        print(f"  [{msg['role']}] {msg['content'][:80]}")

    print("\n=== MemGPT Memory ===")
    mgpt = MemGPTMemory(context_limit=200)
    for i in range(20):
        mgpt.add(f"Message {i}: some content about topic {i % 5}", role="user")
    ctx = mgpt.load(current_query="topic 3")
    print(f"  Working memory: {len(mgpt._working)} messages")
    print(f"  Archive size: {len(mgpt._archive._store)} messages")
