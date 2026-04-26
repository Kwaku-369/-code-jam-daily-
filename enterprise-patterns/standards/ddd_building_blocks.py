"""
Domain-Driven Design — Building Blocks
========================================
Source: "Domain-Driven Design: Tackling Complexity in the Heart of Software"
         — Eric Evans (2003); "Implementing Domain-Driven Design" — Vaughn Vernon (2013)

Building blocks:
  Entity            — has identity; mutable; equality by ID
  Value Object      — no identity; immutable; equality by value
  Aggregate         — consistency boundary; has one Aggregate Root
  Repository        — collection-like persistence abstraction
  Domain Service    — stateless logic that doesn't belong to any entity
  Application Svc   — orchestrates use cases; thin; no domain logic
  Domain Event      — something that happened; past tense; immutable
  Anti-Corruption Layer — translates external models to your domain model

Applied to ML/AI:
  Entity:       MLModel, Experiment, FeatureSet, InferenceJob
  Value Object: ModelVersion, HyperParameter, Metric, EmbeddingVector
  Aggregate:    ExperimentAggregate (root: Experiment; contains: Runs, Metrics)
  Repository:   ExperimentRepository, ModelRepository
  Domain Svc:   ModelEvaluationService, FeatureEngineeringService
  ACL:          VertexAIAdapter, TritonAdapter (translate cloud APIs → domain)
  Domain Event: ModelPromoted, ExperimentCompleted, FeatureSetPublished
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
import uuid


# ============================================================================
# VALUE OBJECTS — immutable; equality by value; no identity
# ============================================================================

@dataclass(frozen=True)
class ModelVersion:
    major: int
    minor: int
    patch: int = 0

    def __str__(self) -> str:
        return f"{self.major}.{self.minor}.{self.patch}"

    def is_newer_than(self, other: "ModelVersion") -> bool:
        return (self.major, self.minor, self.patch) > (other.major, other.minor, other.patch)


@dataclass(frozen=True)
class HyperParameter:
    name:  str
    value: Any

    def __post_init__(self):
        if not self.name:
            raise ValueError("HyperParameter name cannot be empty")


@dataclass(frozen=True)
class Metric:
    name:  str
    value: float
    step:  int = 0

    def is_better_than(self, other: "Metric", higher_is_better: bool = True) -> bool:
        if self.name != other.name:
            raise ValueError(f"Cannot compare metrics with different names: {self.name} vs {other.name}")
        return self.value > other.value if higher_is_better else self.value < other.value


@dataclass(frozen=True)
class GPUSpec:
    """Value Object representing GPU resource requirements."""
    count:   int
    memory_gb: int
    type:    str = "A100"    # A100 | H100 | V100 | T4

    def total_vram_gb(self) -> int:
        return self.count * self.memory_gb


# ============================================================================
# DOMAIN EVENTS — past tense; immutable; things that happened
# ============================================================================

@dataclass(frozen=True)
class DomainEvent:
    event_id:  str      = field(default_factory=lambda: str(uuid.uuid4()))
    occurred:  datetime = field(default_factory=datetime.utcnow)


@dataclass(frozen=True)
class ExperimentStarted(DomainEvent):
    experiment_id: str = ""
    model_name:    str = ""


@dataclass(frozen=True)
class RunCompleted(DomainEvent):
    experiment_id: str = ""
    run_id:        str = ""
    best_metric:   float = 0.0


@dataclass(frozen=True)
class ModelPromoted(DomainEvent):
    model_id:  str = ""
    version:   str = ""
    from_env:  str = ""
    to_env:    str = ""


# ============================================================================
# ENTITIES — have identity; mutable; equality by ID
# ============================================================================

@dataclass
class ExperimentRun:
    """Entity — a single training run within an experiment."""
    run_id:      str = field(default_factory=lambda: str(uuid.uuid4()))
    status:      str = "created"   # created | running | completed | failed
    hyperparams: list[HyperParameter] = field(default_factory=list)
    metrics:     list[Metric]         = field(default_factory=list)
    started_at:  datetime | None      = None
    ended_at:    datetime | None      = None

    def start(self):
        if self.status != "created":
            raise ValueError(f"Cannot start run in status '{self.status}'")
        self.status     = "running"
        self.started_at = datetime.utcnow()

    def log_metric(self, name: str, value: float, step: int = 0):
        self.metrics.append(Metric(name=name, value=value, step=step))

    def complete(self):
        self.status   = "completed"
        self.ended_at = datetime.utcnow()

    def best_metric(self, name: str, higher_is_better: bool = True) -> Metric | None:
        matching = [m for m in self.metrics if m.name == name]
        if not matching:
            return None
        return max(matching, key=lambda m: m.value if higher_is_better else -m.value)

    def __eq__(self, other):
        return isinstance(other, ExperimentRun) and self.run_id == other.run_id

    def __hash__(self):
        return hash(self.run_id)


# ============================================================================
# AGGREGATE — consistency boundary; protect invariants
# ============================================================================

@dataclass
class ExperimentAggregate:
    """
    Aggregate Root: Experiment.
    Invariants enforced:
      - Cannot add runs to a completed experiment
      - Only one run can be 'running' at a time
      - Best run is always derivable from completed runs
    """
    experiment_id:   str = field(default_factory=lambda: str(uuid.uuid4()))
    name:            str = ""
    model_name:      str = ""
    status:          str = "open"    # open | completed | archived
    runs:            list[ExperimentRun] = field(default_factory=list)
    gpu_spec:        GPUSpec | None = None
    _events:         list[DomainEvent] = field(default_factory=list, repr=False)

    def start_run(self, hyperparams: list[HyperParameter]) -> ExperimentRun:
        if self.status != "open":
            raise ValueError(f"Cannot add runs to experiment in status '{self.status}'")
        if any(r.status == "running" for r in self.runs):
            raise ValueError("Another run is already in progress")
        run = ExperimentRun(hyperparams=hyperparams)
        run.start()
        self.runs.append(run)
        self._events.append(ExperimentStarted(experiment_id=self.experiment_id, model_name=self.model_name))
        return run

    def complete_run(self, run_id: str):
        run = self._find_run(run_id)
        run.complete()
        best = run.best_metric("val_accuracy")
        score = best.value if best else 0.0
        self._events.append(RunCompleted(experiment_id=self.experiment_id, run_id=run_id, best_metric=score))

    def close(self):
        if any(r.status == "running" for r in self.runs):
            raise ValueError("Cannot close experiment with active runs")
        self.status = "completed"

    def best_run(self, metric: str = "val_accuracy", higher: bool = True) -> ExperimentRun | None:
        completed = [r for r in self.runs if r.status == "completed"]
        if not completed:
            return None
        return max(completed, key=lambda r: (r.best_metric(metric) or Metric(metric, -1e9 if higher else 1e9)).value
                    if higher else -(r.best_metric(metric) or Metric(metric, 1e9)).value)

    def pull_events(self) -> list[DomainEvent]:
        events, self._events = self._events, []
        return events

    def _find_run(self, run_id: str) -> ExperimentRun:
        run = next((r for r in self.runs if r.run_id == run_id), None)
        if not run:
            raise ValueError(f"Run '{run_id}' not found")
        return run


# ============================================================================
# REPOSITORY — collection abstraction; implementation in outer layers
# ============================================================================

class ExperimentRepository(ABC):
    @abstractmethod
    def save(self, experiment: ExperimentAggregate) -> None: ...

    @abstractmethod
    def find_by_id(self, experiment_id: str) -> ExperimentAggregate | None: ...

    @abstractmethod
    def find_by_model(self, model_name: str) -> list[ExperimentAggregate]: ...


class InMemoryExperimentRepository(ExperimentRepository):
    def __init__(self):
        self._store: dict[str, ExperimentAggregate] = {}

    def save(self, exp: ExperimentAggregate):
        self._store[exp.experiment_id] = exp

    def find_by_id(self, experiment_id: str) -> ExperimentAggregate | None:
        return self._store.get(experiment_id)

    def find_by_model(self, model_name: str) -> list[ExperimentAggregate]:
        return [e for e in self._store.values() if e.model_name == model_name]


# ============================================================================
# DOMAIN SERVICE — stateless logic spanning multiple aggregates
# ============================================================================

class ModelEvaluationService:
    """
    Domain Service: compares runs across experiments to select champion.
    This logic doesn't belong to any single entity — it's a cross-cutting concern.
    """
    def select_champion(
        self,
        experiments: list[ExperimentAggregate],
        metric: str = "val_accuracy",
    ) -> tuple[ExperimentAggregate | None, ExperimentRun | None]:
        best_exp, best_run, best_score = None, None, -float("inf")
        for exp in experiments:
            run = exp.best_run(metric)
            if run:
                m = run.best_metric(metric)
                if m and m.value > best_score:
                    best_score = m.value
                    best_exp, best_run = exp, run
        return best_exp, best_run


# ============================================================================
# ANTI-CORRUPTION LAYER — protect domain from external/legacy models
# ============================================================================

class VertexAIModelACL:
    """
    Anti-Corruption Layer: translates Vertex AI's model format into our domain.
    External changes to Vertex AI API only affect this class — not the domain.
    """

    @staticmethod
    def from_vertex_model(vertex_model: dict) -> MLModel:
        """Translate Vertex AI Model resource dict → domain MLModel."""
        from .clean_architecture import MLModel, ModelId
        return MLModel(
            model_id=ModelId(vertex_model.get("name", "").split("/")[-1]),
            name=vertex_model.get("displayName", ""),
            version=vertex_model.get("versionId", "1"),
            framework=vertex_model.get("containerSpec", {}).get("imageUri", "unknown"),
            status="registered",
        )

    @staticmethod
    def to_vertex_deploy_config(model: "MLModel", gpu_spec: GPUSpec | None = None) -> dict:
        """Translate domain model → Vertex AI deployment config dict."""
        config: dict = {
            "model":        f"projects/PROJECT/locations/us-central1/models/{model.model_id.value}",
            "displayName":  model.name,
            "machineSpec":  {"machineType": "n1-standard-4"},
        }
        if gpu_spec:
            config["machineSpec"]["acceleratorType"]  = f"NVIDIA_{gpu_spec.type}"
            config["machineSpec"]["acceleratorCount"]  = gpu_spec.count
        return config


# Avoid circular import — define MLModel reference for ACL
class MLModel:
    def __init__(self, model_id, name, version, framework, status="registered"):
        self.model_id  = model_id
        self.name      = name
        self.version   = version
        self.framework = framework
        self.status    = status


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    repo = InMemoryExperimentRepository()
    eval_svc = ModelEvaluationService()

    # Create and run experiment
    exp = ExperimentAggregate(
        name="BERT fine-tune v3",
        model_name="bert-classifier",
        gpu_spec=GPUSpec(count=4, memory_gb=80, type="A100"),
    )

    run1 = exp.start_run([HyperParameter("lr", 1e-4), HyperParameter("epochs", 10)])
    run1.log_metric("val_accuracy", 0.87, step=5)
    run1.log_metric("val_accuracy", 0.91, step=10)
    exp.complete_run(run1.run_id)

    run2 = exp.start_run([HyperParameter("lr", 5e-5), HyperParameter("epochs", 20)])
    run2.log_metric("val_accuracy", 0.93, step=10)
    run2.log_metric("val_accuracy", 0.95, step=20)
    exp.complete_run(run2.run_id)

    repo.save(exp)

    best_exp, best_run = eval_svc.select_champion([exp])
    print(f"Champion run: {best_run.run_id}")
    print(f"Best accuracy: {best_run.best_metric('val_accuracy').value:.4f}")
    print(f"GPU spec: {exp.gpu_spec.count}x {exp.gpu_spec.type} ({exp.gpu_spec.total_vram_gb()}GB VRAM)")

    events = exp.pull_events()
    print(f"\nDomain events emitted: {len(events)}")
    for e in events:
        print(f"  {type(e).__name__}: {e.__dict__}")

    # Value object comparisons
    v1 = ModelVersion(2, 1, 0)
    v2 = ModelVersion(2, 0, 5)
    print(f"\n{v1} newer than {v2}: {v1.is_newer_than(v2)}")

    # ACL translation
    vertex_raw = {"name": "projects/123/models/my-model", "displayName": "My Model", "versionId": "3"}
    domain_model = VertexAIModelACL.from_vertex_model(vertex_raw)
    print(f"\nACL translated: {domain_model.name} v{domain_model.version}")
    deploy_cfg = VertexAIModelACL.to_vertex_deploy_config(domain_model, GPUSpec(2, 40, "A100"))
    print(f"Deploy config accelerator: {deploy_cfg['machineSpec'].get('acceleratorType')}")
