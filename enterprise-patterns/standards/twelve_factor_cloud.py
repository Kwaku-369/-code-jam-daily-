"""
12-Factor App + Cloud-Native ML Extension
==========================================
Source: Heroku / Adam Wiggins "The Twelve-Factor App" (2011)
        Applied to ML inference services on NVIDIA / Vertex AI / Cloud Run

ORIGINAL 12 FACTORS → CLOUD ML INTERPRETATION
----------------------------------------------
I.   Codebase        One repo per service; model code != training code
II.  Dependencies    requirements.txt / pyproject.toml; pin CUDA/cuDNN versions
III. Config          ALL secrets + endpoints in env vars (never in code)
IV.  Backing svc     Vector DB, Feature Store, Model Registry as attached resources
V.   Build/Release   Docker image (build) → versioned artifact → deployed env
VI.  Processes       Stateless inference workers; no local GPU memory state
VII. Port binding    Inference server exports HTTP/gRPC on a port
VIII.Concurrency     Scale out by adding replicas (GPU workers), not up
IX.  Disposability   Fast startup (<30s); graceful shutdown (drain in-flight)
X.   Dev/Prod parity Same container image in dev and prod (different GPU count)
XI.  Logs            Structured JSON to stdout; aggregated externally
XII. Admin           One-off training jobs as separate processes, not in API

3 ADDITIONAL ML FACTORS (2024 extension)
-----------------------------------------
XIII. Model Versioning  Models are artifacts with explicit version + lineage
XIV.  Data Contracts    Input/output schemas validated at inference boundary
XV.   Observability     Latency, throughput, GPU utilization, drift metrics
"""

from __future__ import annotations
import os
import json
from dataclasses import dataclass, field
from typing import Any
from datetime import datetime


# ============================================================================
# FACTOR III — Config (env-first; never hardcode)
# ============================================================================

@dataclass
class InferenceServiceConfig:
    """
    All config from environment variables.
    12-Factor: "strict separation of config from code."
    Defaults are dev-safe; production sets real values via env / Kubernetes Secrets.
    """
    # Inference backend
    backend:              str   = field(default_factory=lambda: os.getenv("INFERENCE_BACKEND", "triton"))
    triton_url:           str   = field(default_factory=lambda: os.getenv("TRITON_URL", "localhost:8001"))
    nim_base_url:         str   = field(default_factory=lambda: os.getenv("NIM_BASE_URL", "https://integrate.api.nvidia.com/v1"))
    nim_api_key:          str   = field(default_factory=lambda: os.getenv("NGC_API_KEY", ""))

    # Vertex AI
    vertex_project:       str   = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_PROJECT", ""))
    vertex_location:      str   = field(default_factory=lambda: os.getenv("VERTEX_LOCATION", "us-central1"))
    vertex_endpoint_id:   str   = field(default_factory=lambda: os.getenv("VERTEX_ENDPOINT_ID", ""))

    # Backing services (Factor IV)
    vector_db_url:        str   = field(default_factory=lambda: os.getenv("VECTOR_DB_URL", ""))
    feature_store_id:     str   = field(default_factory=lambda: os.getenv("FEATURE_STORE_ID", ""))
    model_registry_uri:   str   = field(default_factory=lambda: os.getenv("MODEL_REGISTRY_URI", ""))

    # Service
    port:                 int   = field(default_factory=lambda: int(os.getenv("PORT", "8080")))
    workers:              int   = field(default_factory=lambda: int(os.getenv("WORKERS", "4")))
    max_batch_size:       int   = field(default_factory=lambda: int(os.getenv("MAX_BATCH_SIZE", "32")))
    timeout_ms:           int   = field(default_factory=lambda: int(os.getenv("TIMEOUT_MS", "5000")))

    # Observability
    log_level:            str   = field(default_factory=lambda: os.getenv("LOG_LEVEL", "INFO"))
    metrics_port:         int   = field(default_factory=lambda: int(os.getenv("METRICS_PORT", "9090")))

    def validate(self):
        """Fail fast at startup if required config is missing (Factor IX: fast startup)."""
        errors = []
        if self.backend == "nim" and not self.nim_api_key:
            errors.append("NGC_API_KEY is required when INFERENCE_BACKEND=nim")
        if self.backend == "vertex" and not self.vertex_project:
            errors.append("GOOGLE_CLOUD_PROJECT is required when INFERENCE_BACKEND=vertex")
        if errors:
            raise EnvironmentError("Config validation failed:\n" + "\n".join(f"  - {e}" for e in errors))
        return self

    @classmethod
    def from_env(cls) -> "InferenceServiceConfig":
        return cls().validate()


# ============================================================================
# FACTOR VI — Processes (stateless; state in backing services)
# ============================================================================

class StatelessInferenceWorker:
    """
    Factor VI: "Execute the app as one or more stateless processes."
    No GPU memory state between requests — load model once at startup,
    then each request is independent.

    Wrong (stateful):  worker stores partial results in GPU memory between requests
    Right (stateless): each request gets a fresh forward pass; results returned immediately
    """
    def __init__(self, config: InferenceServiceConfig):
        self.config = config
        self._model = None   # Loaded once in _initialize(), never mutated

    def _initialize(self):
        """Called once at startup (Factor IX: fast startup)."""
        print(f"[Worker] Loading model from {self.config.model_registry_uri or 'stub'}")
        self._model = {"loaded": True, "backend": self.config.backend}

    def handle(self, request: dict) -> dict:
        if self._model is None:
            self._initialize()
        # Stateless: request in → response out; no side effects
        return {"result": f"[processed by {self.config.backend}]", "input_keys": list(request.keys())}


# ============================================================================
# FACTOR VIII — Concurrency (scale out, not up)
# ============================================================================

@dataclass
class HorizontalScaleSpec:
    """
    Kubernetes HPA / Vertex AI autoscaling spec.
    Factor VIII: "Scale out via the process model."
    """
    min_replicas:           int   = 1
    max_replicas:           int   = 10
    target_gpu_utilization: int   = 70    # percent
    target_rps_per_replica: int   = 50
    scale_up_cooldown_sec:  int   = 60
    scale_down_cooldown_sec: int  = 300

    def to_vertex_autoscaling(self) -> dict:
        return {
            "minReplicaCount": self.min_replicas,
            "maxReplicaCount": self.max_replicas,
            "autoscalingMetricSpecs": [{
                "metricName": "aiplatform.googleapis.com/prediction/online/accelerator/duty_cycle",
                "target": self.target_gpu_utilization,
            }],
        }

    def to_k8s_hpa(self, deployment_name: str) -> dict:
        return {
            "apiVersion": "autoscaling/v2",
            "kind":       "HorizontalPodAutoscaler",
            "metadata":   {"name": f"{deployment_name}-hpa"},
            "spec": {
                "scaleTargetRef":  {"apiVersion": "apps/v1", "kind": "Deployment", "name": deployment_name},
                "minReplicas":     self.min_replicas,
                "maxReplicas":     self.max_replicas,
                "metrics": [{
                    "type": "Resource",
                    "resource": {"name": "nvidia.com/gpu", "target": {"type": "Utilization", "averageUtilization": self.target_gpu_utilization}},
                }],
            },
        }


# ============================================================================
# FACTOR IX — Disposability (graceful shutdown)
# ============================================================================

class GracefulShutdownHandler:
    """
    Factor IX: "Maximize robustness with fast startup and graceful shutdown."
    On SIGTERM: stop accepting new requests, drain in-flight, exit.
    Critical for Kubernetes pod evictions and Vertex AI node replacements.
    """
    def __init__(self):
        self._shutting_down = False
        self._in_flight     = 0
        self._register_signals()

    def _register_signals(self):
        import signal
        signal.signal(signal.SIGTERM, self._on_sigterm)
        signal.signal(signal.SIGINT,  self._on_sigterm)

    def _on_sigterm(self, *_):
        print("[Shutdown] SIGTERM received — draining in-flight requests")
        self._shutting_down = True

    def acquire(self) -> bool:
        if self._shutting_down:
            return False
        self._in_flight += 1
        return True

    def release(self):
        self._in_flight -= 1

    def wait_drain(self, timeout_sec: float = 30.0):
        import time
        deadline = time.monotonic() + timeout_sec
        while self._in_flight > 0 and time.monotonic() < deadline:
            time.sleep(0.1)
        print(f"[Shutdown] Drained. In-flight remaining: {self._in_flight}")


# ============================================================================
# FACTOR XI — Logs as event streams (structured JSON to stdout)
# ============================================================================

class CloudLogger:
    """
    Factor XI: "Treat logs as event streams. Never write to log files."
    Writes structured JSON to stdout → aggregated by GCP Cloud Logging / Datadog.
    Format matches GCP structured logging spec.
    """
    SEVERITY = {"DEBUG": "DEBUG", "INFO": "INFO", "WARN": "WARNING", "ERROR": "ERROR", "CRITICAL": "CRITICAL"}

    def __init__(self, service: str, version: str = "1.0"):
        self.service = service
        self.version = version

    def _emit(self, severity: str, message: str, **labels):
        record = {
            "severity":  self.SEVERITY.get(severity, "INFO"),
            "message":   message,
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "serviceContext": {"service": self.service, "version": self.version},
            "labels":    labels,
        }
        print(json.dumps(record), flush=True)   # Factor XI: stdout, unbuffered

    def debug(self, msg, **kw):    self._emit("DEBUG",    msg, **kw)
    def info(self, msg, **kw):     self._emit("INFO",     msg, **kw)
    def warn(self, msg, **kw):     self._emit("WARN",     msg, **kw)
    def error(self, msg, **kw):    self._emit("ERROR",    msg, **kw)
    def critical(self, msg, **kw): self._emit("CRITICAL", msg, **kw)


# ============================================================================
# FACTOR XIII — Model Versioning (ML Extension)
# ============================================================================

@dataclass(frozen=True)
class ModelArtifact:
    """
    ML Factor XIII: models are versioned, immutable artifacts with full lineage.
    URI points to GCS / S3 / Artifact Registry — never a local path in production.
    """
    model_id:       str
    version:        str
    uri:            str      # gs://bucket/models/bert-v2.1/ or s3://...
    framework:      str      # pytorch | tensorflow | onnx | sklearn
    input_schema:   dict     # Factor XIV: explicit data contract
    output_schema:  dict
    training_job:   str = ""  # lineage: which job produced this
    dataset_hash:   str = ""  # lineage: which dataset version
    metrics:        dict = field(default_factory=dict)

    def gcs_uri(self) -> str:
        if not self.uri.startswith("gs://"):
            raise ValueError(f"Expected GCS URI, got: {self.uri}")
        return self.uri


# ============================================================================
# FACTOR XIV — Data Contracts (ML Extension)
# ============================================================================

@dataclass
class InferenceRequest:
    """
    ML Factor XIV: validate all input/output at inference boundary.
    Prevents garbage-in silently corrupting predictions.
    """
    instances: list[dict]
    parameters: dict = field(default_factory=dict)

    def validate(self, schema: dict) -> list[str]:
        """Returns list of validation errors (empty = valid)."""
        errors = []
        required = schema.get("required", [])
        for i, instance in enumerate(self.instances):
            for field_name in required:
                if field_name not in instance:
                    errors.append(f"Instance[{i}] missing required field '{field_name}'")
            for field_name, value in instance.items():
                expected_type = schema.get("properties", {}).get(field_name, {}).get("type")
                if expected_type:
                    py_type = {"string": str, "number": (int, float), "integer": int, "boolean": bool}.get(expected_type)
                    if py_type and not isinstance(value, py_type):
                        errors.append(f"Instance[{i}].{field_name}: expected {expected_type}, got {type(value).__name__}")
        return errors


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== 12-Factor Config ===")
    cfg = InferenceServiceConfig()
    print(f"  Backend:  {cfg.backend}")
    print(f"  Port:     {cfg.port}")
    print(f"  Workers:  {cfg.workers}")

    print("\n=== Autoscaling Spec ===")
    scale = HorizontalScaleSpec(min_replicas=2, max_replicas=8, target_gpu_utilization=75)
    print(json.dumps(scale.to_k8s_hpa("inference-service"), indent=2)[:300])

    print("\n=== Structured Cloud Logger ===")
    log = CloudLogger("inference-api", "2.1.0")
    log.info("Request received", model_id="bert-v2", latency_ms=12.4, gpu_util=68)
    log.warn("High latency detected", p99_ms=450, threshold_ms=400)

    print("\n=== Data Contract Validation ===")
    schema = {
        "required": ["text", "language"],
        "properties": {
            "text":     {"type": "string"},
            "language": {"type": "string"},
            "max_tokens": {"type": "integer"},
        }
    }
    req = InferenceRequest(instances=[
        {"text": "Hello world", "language": "en"},
        {"text": 123,           "language": "en"},   # wrong type
        {"language": "es"},                          # missing 'text'
    ])
    errors = req.validate(schema)
    print(f"  Validation errors ({len(errors)}):")
    for e in errors:
        print(f"    - {e}")
