"""
LangChain — RAG Pipeline Pattern (Retrieval-Augmented Generation)
------------------------------------------------------------------
Pattern: Retrieve relevant documents from a vector store, inject them into
         the LLM context, and generate a grounded answer.
Source:  langchain-ai/langchain rag tutorial; langchain-ai/rag-from-scratch
Sector:  Enterprise knowledge bases, legal research, financial due diligence,
         customer support, internal documentation Q&A.

Pipeline stages:
  1. Indexing   — chunk documents → embed → store in vector DB
  2. Retrieval  — embed query → similarity search → top-k docs
  3. Generation — format prompt with docs → LLM → answer

Advanced variants:
  - Corrective RAG (CRAG): grade retrieved docs, web-search if low quality
  - Self-RAG: LLM decides when to retrieve vs. generate from memory
  - Adaptive RAG: route query to web / vector DB / direct LLM

Tradeoffs:
  + Grounded answers — reduces hallucination significantly
  + Easily updated by re-indexing documents
  - Retrieval quality caps answer quality (garbage in = garbage out)
  - Latency of embed + search + generate
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Protocol
import math


# ---- Minimal vector store stub -------------------------------------------

@dataclass
class Document:
    content: str
    metadata: dict = field(default_factory=dict)
    embedding: list[float] | None = None


class VectorStore(Protocol):
    def add(self, docs: list[Document]) -> None: ...
    def search(self, query_embedding: list[float], k: int) -> list[Document]: ...


@dataclass
class InMemoryVectorStore:
    """Cosine-similarity vector store — no external dependencies."""
    _docs: list[Document] = field(default_factory=list)

    def add(self, docs: list[Document]):
        self._docs.extend(docs)

    def search(self, query_embedding: list[float], k: int = 4) -> list[Document]:
        if not self._docs:
            return []
        scores = [(self._cosine(query_embedding, d.embedding or []), d) for d in self._docs]
        scores.sort(key=lambda x: x[0], reverse=True)
        return [d for _, d in scores[:k]]

    @staticmethod
    def _cosine(a: list[float], b: list[float]) -> float:
        if not a or not b or len(a) != len(b):
            return 0.0
        dot = sum(x * y for x, y in zip(a, b))
        mag = math.sqrt(sum(x**2 for x in a)) * math.sqrt(sum(x**2 for x in b))
        return dot / mag if mag else 0.0


# ---- Embedding stub -------------------------------------------------------

def stub_embed(text: str) -> list[float]:
    """Replace with: OpenAIEmbeddings, HuggingFaceEmbeddings, etc."""
    return [float(ord(c) % 10) / 10 for c in text[:16].ljust(16)]


# ---- Text splitter --------------------------------------------------------

def chunk_text(text: str, chunk_size: int = 512, overlap: int = 64) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = min(start + chunk_size, len(text))
        chunks.append(text[start:end])
        start += chunk_size - overlap
    return chunks


# ---- RAG Pipeline ---------------------------------------------------------

@dataclass
class RAGPipeline:
    vector_store: InMemoryVectorStore = field(default_factory=InMemoryVectorStore)
    k: int = 4                             # top-k documents to retrieve
    chunk_size: int = 512
    overlap: int = 64

    # ---- Indexing phase ----

    def index(self, texts: list[str], metadata: list[dict] | None = None):
        docs = []
        for i, text in enumerate(texts):
            meta = (metadata or [{}] * len(texts))[i]
            for chunk in chunk_text(text, self.chunk_size, self.overlap):
                embedding = stub_embed(chunk)
                docs.append(Document(content=chunk, metadata=meta, embedding=embedding))
        self.vector_store.add(docs)
        print(f"[Indexer] Indexed {len(docs)} chunks from {len(texts)} documents.")

    # ---- Retrieval phase ----

    def retrieve(self, query: str) -> list[Document]:
        q_emb = stub_embed(query)
        docs = self.vector_store.search(q_emb, k=self.k)
        print(f"[Retriever] Found {len(docs)} relevant chunks for: '{query[:50]}'")
        return docs

    # ---- Generation phase ----

    def _build_prompt(self, query: str, context_docs: list[Document]) -> str:
        context = "\n\n---\n\n".join(d.content for d in context_docs)
        return (
            f"Use the following context to answer the question.\n\n"
            f"Context:\n{context}\n\n"
            f"Question: {query}\n\nAnswer:"
        )

    def _generate(self, prompt: str) -> str:
        """Replace with: llm.invoke(prompt) or chain.invoke({"question": query})"""
        print("[LLM] Generating answer...")
        return f"[stub answer based on {len(prompt)} character prompt]"

    # ---- Full pipeline ----

    def query(self, question: str) -> str:
        docs   = self.retrieve(question)
        prompt = self._build_prompt(question, docs)
        return self._generate(prompt)

    # ---- CRAG variant: grade + fallback -----------------------------------

    def _grade_doc(self, doc: Document, query: str) -> bool:
        """Replace with LLM grader: is this doc relevant to the query?"""
        return True  # stub

    def query_crag(self, question: str) -> str:
        """Corrective RAG: fall back to web search if retrieved docs are low quality."""
        docs = self.retrieve(question)
        relevant = [d for d in docs if self._grade_doc(d, question)]

        if not relevant:
            print("[CRAG] No relevant docs — falling back to web search stub")
            relevant = [Document(content=f"[web search result for: {question}]")]

        prompt = self._build_prompt(question, relevant)
        return self._generate(prompt)


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    rag = RAGPipeline(k=3)

    rag.index(
        texts=[
            "LangChain is a framework for building LLM-powered applications.",
            "RAG combines retrieval with generation to ground LLM responses.",
            "LangGraph adds stateful, cyclical graph support to LangChain agents.",
        ],
        metadata=[{"source": "docs"}, {"source": "paper"}, {"source": "blog"}],
    )

    answer = rag.query("What is RAG and how does it reduce hallucination?")
    print(f"\nAnswer: {answer}")
