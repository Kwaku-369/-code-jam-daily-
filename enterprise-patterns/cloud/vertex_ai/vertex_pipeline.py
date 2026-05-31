"""
Vertex AI Pipelines — Component & Pipeline Patterns
=====================================================
Source: Google Cloud Vertex AI docs; KFP v2 SDK; cloud.google.com/vertex-ai/docs/pipelines
Cloud:  Google Cloud Platform (Vertex AI)

Vertex AI Pipelines = Kubeflow Pipelines v2 hosted on GCP.
Each component runs in its own container → full isolation + reproducibility.

Install:  pip install google-cloud-aiplatform kfp kfp-google-cloud

Key objects:
  @component    — decorates a Python function → containerized pipeline step
  @pipeline     — defines the DAG of components
  PipelineJob   — submits the compiled pipeline to Vertex AI

Clean Architecture: this file is the infrastructure / frameworks layer.
12-Factor:
  - Config from env (project, location, service account)
  - Artifacts (models, datasets) stored in GCS (backing service)
  - One-off training as separate processes (pipeline jobs, not inline)
"""

from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Any


# ---- Config (Factor III: env-first) --------------------------------------

@dataclass
class VertexConfig:
    project:         str  = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_PROJECT", ""))
    location:        str  = field(default_factory=lambda: os.getenv("VERTEX_LOCATION", "us-central1"))
    pipeline_root:   str  = field(default_factory=lambda: os.getenv("VERTEX_PIPELINE_ROOT", ""))
    service_account: str  = field(default_factory=lambda: os.getenv("VERTEX_SA", ""))
    network:         str  = field(default_factory=lambda: os.getenv("VPC_NETWORK", ""))
    enable_caching:  bool = field(default_factory=lambda: os.getenv("VERTEX_CACHING", "true") == "true")

    def validate(self):
        errors = []
        if not self.project:
            errors.append("GOOGLE_CLOUD_PROJECT is required")
        if not self.pipeline_root:
            errors.append("VERTEX_PIPELINE_ROOT (GCS URI) is required, e.g. gs://my-bucket/pipelines")
        if errors:
            raise EnvironmentError("Vertex config errors:\n" + "\n".join(f"  - {e}" for e in errors))
        return self


# ---- Component templates (production-ready) ------------------------------

COMPONENT_BASE_IMAGE = os.getenv("KFP_BASE_IMAGE", "python:3.11-slim")

def make_component_decorator(packages: list[str] | None = None, base_image: str = COMPONENT_BASE_IMAGE):
    """
    Returns a @component decorator factory.
    Usage:
        @make_component_decorator(["pandas", "scikit-learn"])
        def my_step(input_path: str, output_model: Output[Model]):
            ...
    """
    try:
        from kfp.v2 import dsl, compiler
        from kfp.v2.dsl import component
        return component(base_image=base_image, packages_to_install=packages or [])
    except ImportError:
        def _stub(fn):
            fn._is_component = True
            fn._packages     = packages or []
            return fn
        return _stub


# ---- Pre-built component bodies (Python functions, not decorators) --------
# These are the actual function implementations used inside @component.
# Decorate them with @component(...) in your pipeline definition files.

def data_validation_fn(
    gcs_data_uri:    str,
    schema_json:     str,
    validated_uri:   str,
    error_threshold: float = 0.01,
) -> str:
    """
    Component: Validate dataset against a JSON schema.
    Returns "passed" or raises if error_rate > threshold.
    """
    import json
    schema   = json.loads(schema_json)
    required = schema.get("required", [])

    print(f"[DataValidation] Validating {gcs_data_uri}")
    print(f"[DataValidation] Required fields: {required}")

    # Production: download from GCS, parse CSV/JSON, check each row
    # from google.cloud import storage
    # ...
    error_rate = 0.0   # stub
    if error_rate > error_threshold:
        raise ValueError(f"Validation failed: error_rate={error_rate:.4f} > {error_threshold}")

    print(f"[DataValidation] Passed: error_rate={error_rate}")
    return validated_uri


def feature_engineering_fn(
    input_gcs_uri: str,
    output_gcs_uri: str,
    features: list[str],
) -> None:
    """
    Component: Feature engineering step.
    Reads from GCS, transforms, writes back.
    """
    print(f"[FeatureEng] input={input_gcs_uri} → output={output_gcs_uri}")
    print(f"[FeatureEng] Computing features: {features}")
    # Production: cuDF for GPU acceleration, or pandas for CPU
    # import cudf; df = cudf.read_csv(input_gcs_uri); ...


def model_training_fn(
    train_gcs_uri: str,
    output_model_gcs_uri: str,
    hyperparams_json: str,
    framework: str = "sklearn",
    use_gpu: bool = False,
) -> dict:
    """
    Component: Train a model; returns metrics dict.
    """
    import json
    hp = json.loads(hyperparams_json)
    print(f"[Training] framework={framework} gpu={use_gpu} params={hp}")
    print(f"[Training] input={train_gcs_uri} → model={output_model_gcs_uri}")

    # Production with GPU (cuML):
    # if use_gpu:
    #     from cuml.ensemble import RandomForestClassifier
    # else:
    #     from sklearn.ensemble import RandomForestClassifier
    # ...

    metrics = {"accuracy": 0.94, "f1": 0.93, "framework": framework}
    print(f"[Training] Metrics: {metrics}")
    return metrics


def model_evaluation_fn(
    test_gcs_uri: str,
    model_gcs_uri: str,
    metrics_threshold: float = 0.90,
) -> bool:
    """
    Component: Evaluate model; returns True if passes threshold.
    """
    print(f"[Evaluation] model={model_gcs_uri} test={test_gcs_uri}")
    accuracy = 0.94   # stub; real: load model, run eval
    passed   = accuracy >= metrics_threshold
    print(f"[Evaluation] accuracy={accuracy:.4f} threshold={metrics_threshold} → {'PASS' if passed else 'FAIL'}")
    return passed


def model_registration_fn(
    model_gcs_uri:    str,
    display_name:     str,
    project:          str,
    location:         str,
    serving_image:    str = "us-docker.pkg.dev/vertex-ai/prediction/sklearn-cpu.1-3:latest",
) -> str:
    """
    Component: Register model in Vertex AI Model Registry.
    Returns model resource name.
    """
    print(f"[Registration] Registering {display_name} from {model_gcs_uri}")

    # Production:
    # from google.cloud import aiplatform
    # aiplatform.init(project=project, location=location)
    # model = aiplatform.Model.upload(
    #     display_name=display_name,
    #     artifact_uri=model_gcs_uri,
    #     serving_container_image_uri=serving_image,
    # )
    # return model.resource_name

    resource_name = f"projects/{project}/locations/{location}/models/stub-{display_name}"
    print(f"[Registration] Resource: {resource_name}")
    return resource_name


# ---- Pipeline definition -------------------------------------------------

class VertexMLPipeline:
    """
    Wraps the KFP pipeline and PipelineJob submission.
    Clean Architecture: infrastructure adapter.
    """

    def __init__(self, config: VertexConfig | None = None):
        self.config = config or VertexConfig()

    def compile_pipeline(self, pipeline_fn, output_path: str = "pipeline.json"):
        """Compile a @pipeline function to JSON for submission."""
        try:
            from kfp.v2 import compiler
            compiler.Compiler().compile(pipeline_func=pipeline_fn, package_path=output_path)
            print(f"[Pipeline] Compiled to {output_path}")
        except ImportError:
            print("[Pipeline] kfp not installed — skipping compilation (stub)")

    def submit(
        self,
        pipeline_path:   str,
        display_name:    str,
        parameters:      dict[str, Any] | None = None,
        sync:            bool = False,
    ) -> Any:
        """Submit a compiled pipeline JSON to Vertex AI."""
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)

            job = aiplatform.PipelineJob(
                display_name=display_name,
                template_path=pipeline_path,
                pipeline_root=self.config.pipeline_root,
                parameter_values=parameters or {},
                enable_caching=self.config.enable_caching,
            )
            job.submit(service_account=self.config.service_account or None)

            if sync:
                job.wait()
                print(f"[Pipeline] Completed: {job.state}")

            return job
        except ImportError:
            print("[Pipeline] google-cloud-aiplatform not installed (stub mode)")
            return {"status": "stub", "display_name": display_name, "params": parameters}

    def list_jobs(self, limit: int = 10) -> list[dict]:
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)
            jobs = aiplatform.PipelineJob.list(
                filter="state=PIPELINE_STATE_SUCCEEDED",
                order_by="create_time desc",
                max_results=limit,
            )
            return [{"name": j.display_name, "state": str(j.state)} for j in jobs]
        except Exception as e:
            return [{"error": str(e)}]


# ---- Batch prediction job ------------------------------------------------

class VertexBatchPredictor:
    """Submit batch prediction jobs on Vertex AI."""

    def __init__(self, config: VertexConfig | None = None):
        self.config = config or VertexConfig()

    def submit(
        self,
        model_resource_name: str,
        gcs_input_uri:       str,
        gcs_output_prefix:   str,
        machine_type:        str = "n1-standard-4",
        accelerator_type:    str = "",    # "NVIDIA_TESLA_T4" | "NVIDIA_TESLA_A100"
        accelerator_count:   int = 0,
        sync:                bool = False,
    ):
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)

            model = aiplatform.Model(model_resource_name)
            job_kwargs: dict = dict(
                instances_format="jsonl",
                predictions_format="jsonl",
                job_display_name="batch-predict",
                gcs_source=[gcs_input_uri],
                gcs_destination_prefix=gcs_output_prefix,
                machine_type=machine_type,
                sync=sync,
            )
            if accelerator_type and accelerator_count:
                job_kwargs["accelerator_type"]  = accelerator_type
                job_kwargs["accelerator_count"] = accelerator_count

            return model.batch_predict(**job_kwargs)

        except ImportError:
            print(f"[BatchPredict] Stub — would score {gcs_input_uri} → {gcs_output_prefix}")
            return {"status": "stub", "input": gcs_input_uri}


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    cfg = VertexConfig()
    print(f"Project:  {cfg.project or '(set GOOGLE_CLOUD_PROJECT)'}")
    print(f"Location: {cfg.location}")
    print(f"Root:     {cfg.pipeline_root or '(set VERTEX_PIPELINE_ROOT=gs://bucket/pipelines)'}")

    print("\n=== Pipeline steps (dry run) ===")
    result = data_validation_fn(
        gcs_data_uri="gs://my-bucket/data/train.csv",
        schema_json='{"required": ["feature_1", "label"]}',
        validated_uri="gs://my-bucket/data/train_validated.csv",
    )
    print(f"Validation: {result}")

    metrics = model_training_fn(
        train_gcs_uri="gs://my-bucket/data/train.csv",
        output_model_gcs_uri="gs://my-bucket/models/v1/",
        hyperparams_json='{"n_estimators": 100, "max_depth": 10}',
    )
    print(f"Training metrics: {metrics}")

    passed = model_evaluation_fn(
        test_gcs_uri="gs://my-bucket/data/test.csv",
        model_gcs_uri="gs://my-bucket/models/v1/",
    )
    print(f"Evaluation passed: {passed}")

    print("\n=== Batch Predictor (stub) ===")
    predictor = VertexBatchPredictor(cfg)
    predictor.submit(
        "projects/123/locations/us-central1/models/my-model",
        gcs_input_uri="gs://my-bucket/inputs/batch.jsonl",
        gcs_output_prefix="gs://my-bucket/predictions/",
        accelerator_type="NVIDIA_TESLA_A100",
        accelerator_count=2,
    )
