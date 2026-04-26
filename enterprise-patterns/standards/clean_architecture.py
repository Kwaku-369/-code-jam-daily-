"""
Clean Architecture — Robert C. Martin ("Uncle Bob")
=====================================================
Source: "Clean Architecture: A Craftsman's Guide to Software Structure
         and Design" (2017); "Clean Code" (2008)

THE DEPENDENCY RULE
-------------------
"Source code dependencies must point only inward, toward higher-level policies."

Layer order (outermost → innermost):
  Frameworks & Drivers  ──►  Interface Adapters  ──►  Use Cases  ──►  Entities

Nothing in an inner layer knows about an outer layer.
Entities know nothing about use cases.
Use cases know nothing about controllers or gateways.

Applied to ML/AI systems:
  Frameworks: Triton, Vertex AI, LangChain, HTTP servers
  Adapters:   ModelGateway, FeatureStoreAdapter, LLMGateway
  Use Cases:  InferenceUseCase, TrainModelUseCase, RetrieveContextUseCase
  Entities:   Prediction, Model, Feature, EmbeddingVector

THE HUMBLE OBJECT PATTERN
--------------------------
Split hard-to-test logic (UI, I/O, network) from easy-to-test logic.
Applied: the LLM call (network) is isolated from the reasoning logic (pure).

SCREAMING ARCHITECTURE
-----------------------
"The architecture should scream the intent of the system."
Folder: `inference/` not `controllers/` — name by domain, not by framework.
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar
import uuid

# ============================================================================
# LAYER 1 — ENTITIES (innermost; pure domain objects, zero dependencies)
# ============================================================================

@dataclass(frozen=True)
class ModelId:
    """Value Object — identity of a model; immutable."""
    value: str

    def __post_init__(self):
        if not self.value:
            raise ValueError("ModelId cannot be empty")


@dataclass(frozen=True)
class EmbeddingVector:
    """Value Object — a float vector; immutable, equality by value."""
    values: tuple[float, ...]
    dim: int = field(init=False)

    def __post_init__(self):
        object.__setattr__(self, "dim", len(self.values))

    def cosine_similarity(self, other: "EmbeddingVector") -> float:
        if self.dim != other.dim:
            raise ValueError("Dimension mismatch")
        dot = sum(a * b for a, b in zip(self.values, other.values))
        mag_a = sum(a**2 for a in self.values) ** 0.5
        mag_b = sum(b**2 for b in other.values) ** 0.5
        return dot / (mag_a * mag_b) if mag_a and mag_b else 0.0


@dataclass
class Prediction:
    """Entity — a model inference result; has identity."""
    prediction_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    model_id:      ModelId = field(default_factory=lambda: ModelId("unknown"))
    inputs:        dict[str, Any] = field(default_factory=dict)
    outputs:       dict[str, Any] = field(default_factory=dict)
    confidence:    float = 0.0
    latency_ms:    float = 0.0

    def is_confident(self, threshold: float = 0.7) -> bool:
        return self.confidence >= threshold


@dataclass
class MLModel:
    """Entity — a trained model; has identity and lifecycle."""
    model_id:    ModelId
    name:        str
    version:     str
    framework:   str          # "pytorch" | "tensorflow" | "sklearn" | "onnx"
    status:      str = "registered"   # registered | staged | production | archived

    def promote(self) -> "MLModel":
        transitions = {"registered": "staged", "staged": "production"}
        next_status = transitions.get(self.status)
        if not next_status:
            raise ValueError(f"Cannot promote from status '{self.status}'")
        self.status = next_status
        return self

    def archive(self):
        self.status = "archived"


# ============================================================================
# LAYER 2 — USE CASES (application-specific business rules)
# ============================================================================

T = TypeVar("T")

@dataclass
class UseCaseResult(Generic[T]):
    """Uniform result wrapper — use cases always return this."""
    success: bool
    data:    T | None = None
    error:   str      = ""

    @classmethod
    def ok(cls, data: T) -> "UseCaseResult[T]":
        return cls(success=True, data=data)

    @classmethod
    def fail(cls, error: str) -> "UseCaseResult":
        return cls(success=False, error=error)


class InferenceGateway(ABC):
    """Port (interface) — defined in Use Case layer, implemented in Adapters."""
    @abstractmethod
    def predict(self, model_id: ModelId, inputs: dict) -> dict: ...

    @abstractmethod
    def health(self) -> bool: ...


class ModelRepository(ABC):
    """Port — use cases depend on this abstraction, not on any DB."""
    @abstractmethod
    def save(self, model: MLModel) -> None: ...

    @abstractmethod
    def find_by_id(self, model_id: ModelId) -> MLModel | None: ...

    @abstractmethod
    def find_by_status(self, status: str) -> list[MLModel]: ...


@dataclass
class RunInferenceUseCase:
    """
    Use Case — orchestrates inference without knowing HOW it runs.
    Clean Architecture: this class knows WHAT to do; adapters know HOW.
    """
    inference_gateway: InferenceGateway
    model_repo:        ModelRepository

    def execute(self, model_id_str: str, inputs: dict) -> UseCaseResult[Prediction]:
        model_id = ModelId(model_id_str)

        model = self.model_repo.find_by_id(model_id)
        if model is None:
            return UseCaseResult.fail(f"Model '{model_id_str}' not found")
        if model.status != "production":
            return UseCaseResult.fail(f"Model '{model_id_str}' is not in production (status={model.status})")

        if not self.inference_gateway.health():
            return UseCaseResult.fail("Inference gateway is unhealthy")

        import time
        start = time.monotonic()
        try:
            raw_outputs = self.inference_gateway.predict(model_id, inputs)
        except Exception as exc:
            return UseCaseResult.fail(f"Inference failed: {exc}")

        prediction = Prediction(
            model_id=model_id,
            inputs=inputs,
            outputs=raw_outputs,
            confidence=raw_outputs.get("confidence", 0.0),
            latency_ms=(time.monotonic() - start) * 1000,
        )
        return UseCaseResult.ok(prediction)


@dataclass
class PromoteModelUseCase:
    model_repo: ModelRepository

    def execute(self, model_id_str: str) -> UseCaseResult[MLModel]:
        model_id = ModelId(model_id_str)
        model    = self.model_repo.find_by_id(model_id)
        if model is None:
            return UseCaseResult.fail(f"Model '{model_id_str}' not found")
        try:
            model.promote()
            self.model_repo.save(model)
            return UseCaseResult.ok(model)
        except ValueError as e:
            return UseCaseResult.fail(str(e))


# ============================================================================
# LAYER 3 — INTERFACE ADAPTERS (translate between use cases and frameworks)
# ============================================================================

class InMemoryModelRepository(ModelRepository):
    """Adapter — in-memory implementation of the ModelRepository port."""
    def __init__(self):
        self._store: dict[str, MLModel] = {}

    def save(self, model: MLModel):
        self._store[model.model_id.value] = model

    def find_by_id(self, model_id: ModelId) -> MLModel | None:
        return self._store.get(model_id.value)

    def find_by_status(self, status: str) -> list[MLModel]:
        return [m for m in self._store.values() if m.status == status]


class StubInferenceGateway(InferenceGateway):
    """
    Stub adapter — Humble Object Pattern.
    The real adapter would call Triton / Vertex AI / NIM.
    This stub lets use cases be tested without network calls.
    """
    def predict(self, model_id: ModelId, inputs: dict) -> dict:
        return {"output": f"[stub prediction for {model_id.value}]", "confidence": 0.95}

    def health(self) -> bool:
        return True


# ============================================================================
# Clean Code principles applied (Martin, 2008)
# ============================================================================

class CleanCodePrinciples:
    """
    Reference card — principles from Clean Code applied to this codebase.

    1. MEANINGFUL NAMES
       Bad:  def p(m, i): ...
       Good: def run_inference(model_id, inputs): ...

    2. SMALL FUNCTIONS — one level of abstraction per function
       Bad:  def process(): fetch() + validate() + predict() + save() + notify()
       Good: orchestrate these via a Use Case with single-responsibility methods

    3. DON'T REPEAT YOURSELF (DRY)
       UseCaseResult is defined once and reused across all use cases.

    4. COMMAND-QUERY SEPARATION
       Commands mutate state (promote(), archive()) — return nothing or self.
       Queries return data (find_by_id()) — cause no side effects.

    5. ERROR HANDLING — use exceptions or Result types, never return None silently
       find_by_id returns Optional; callers check explicitly.

    6. DEPENDENCY INVERSION
       RunInferenceUseCase depends on InferenceGateway (abstract), not Triton (concrete).
       Swap Triton for Vertex AI without touching the use case.
    """


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # Wire up the application (Dependency Injection)
    repo     = InMemoryModelRepository()
    gateway  = StubInferenceGateway()
    run_uc   = RunInferenceUseCase(inference_gateway=gateway, model_repo=repo)
    promo_uc = PromoteModelUseCase(model_repo=repo)

    # Register a model
    model = MLModel(model_id=ModelId("gpt-cls-v2"), name="GPT Classifier", version="2.0", framework="pytorch")
    repo.save(model)

    # Try inference before promotion (should fail)
    r1 = run_uc.execute("gpt-cls-v2", {"text": "Hello world"})
    print(f"Before promote: {r1.success} — {r1.error}")

    # Promote: registered → staged → production
    promo_uc.execute("gpt-cls-v2")   # → staged
    promo_uc.execute("gpt-cls-v2")   # → production

    # Inference should now succeed
    r2 = run_uc.execute("gpt-cls-v2", {"text": "Hello world"})
    print(f"After promote:  {r2.success} — {r2.data.outputs}")
    print(f"Confident:      {r2.data.is_confident()}")

    # Value object equality
    v1 = EmbeddingVector((0.1, 0.9, 0.3))
    v2 = EmbeddingVector((0.1, 0.9, 0.3))
    print(f"Embeddings equal: {v1 == v2}")
    print(f"Cosine sim to self: {v1.cosine_similarity(v1):.4f}")
