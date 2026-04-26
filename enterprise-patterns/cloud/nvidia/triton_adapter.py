"""
NVIDIA Triton Inference Server Adapter
========================================
Source: NVIDIA Triton docs; triton-inference-server/client (GitHub)
        KServe inference protocol v2
Cloud:  NVIDIA GPU Cloud (NGC), on-prem DGX, AWS/GCP/Azure with GPU nodes

Implements: InferenceGateway port (from clean_architecture.py)
Pattern:    Adapter layer (Clean Architecture) + Humble Object

Install:  pip install tritonclient[all]
Docker:   nvcr.io/nvidia/tritonserver:24.01-py3

Model Repository Structure:
  models/
    bert-classifier/
      config.pbtxt        ← model config (data types, batch size, dynamic batching)
      1/
        model.onnx        ← version 1
      2/
        model.onnx        ← version 2
    ensemble-pipeline/
      config.pbtxt        ← ensemble scheduling
      1/ (empty for ensemble)
"""

from __future__ import annotations
import os
import numpy as np
from dataclasses import dataclass, field
from typing import Any


# ---- Config (12-Factor: from env) ----------------------------------------

@dataclass
class TritonConfig:
    url:          str  = field(default_factory=lambda: os.getenv("TRITON_URL",     "localhost:8000"))
    grpc_url:     str  = field(default_factory=lambda: os.getenv("TRITON_GRPC",   "localhost:8001"))
    use_grpc:     bool = field(default_factory=lambda: os.getenv("TRITON_GRPC_ENABLED", "false") == "true")
    timeout_sec:  int  = field(default_factory=lambda: int(os.getenv("TRITON_TIMEOUT", "30")))
    max_batch:    int  = field(default_factory=lambda: int(os.getenv("TRITON_MAX_BATCH", "32")))
    ssl:          bool = field(default_factory=lambda: os.getenv("TRITON_SSL", "false") == "true")


# ---- config.pbtxt generator -----------------------------------------------

def make_config_pbtxt(
    name: str,
    platform: str,           # "onnxruntime_onnx" | "pytorch_libtorch" | "tensorflow_graphdef"
    inputs: list[dict],      # [{"name": "input__0", "dtype": "TYPE_FP32", "dims": [1, 3, 224, 224]}]
    outputs: list[dict],
    max_batch_size: int = 8,
    dynamic_batching: bool = True,
) -> str:
    """Generate a Triton config.pbtxt for a model."""

    def fmt_tensor(t: dict) -> str:
        dims_str = ", ".join(str(d) for d in t["dims"])
        return f"""  {{
    name: "{t['name']}"
    data_type: {t['dtype']}
    dims: [{dims_str}]
  }}"""

    inputs_str  = "\n".join(f"input [\n{fmt_tensor(i)}\n]" for i in inputs)
    outputs_str = "\n".join(f"output [\n{fmt_tensor(o)}\n]" for o in outputs)

    batching = ""
    if dynamic_batching:
        batching = """
dynamic_batching {
  preferred_batch_size: [8, 16, 32]
  max_queue_delay_microseconds: 10000
}"""

    return f"""name: "{name}"
platform: "{platform}"
max_batch_size: {max_batch_size}
{inputs_str}
{outputs_str}{batching}
"""


def make_ensemble_config(
    name: str,
    pipeline: list[dict],   # [{"model": "preprocess", "input_map": {...}, "output_map": {...}}]
    inputs: list[dict],
    outputs: list[dict],
) -> str:
    """Generate config.pbtxt for a Triton ensemble (pipeline) model."""
    steps = []
    for step in pipeline:
        in_map  = "\n".join(f'      input_map  {{ key: "{k}" value: "{v}" }}' for k, v in step["input_map"].items())
        out_map = "\n".join(f'      output_map {{ key: "{k}" value: "{v}" }}' for k, v in step["output_map"].items())
        steps.append(f"""    {{
      model_name: "{step['model']}"
      model_version: -1
{in_map}
{out_map}
    }}""")

    def fmt_tensor(t: dict) -> str:
        dims_str = ", ".join(str(d) for d in t["dims"])
        return f"""  {{
    name: "{t['name']}"
    data_type: {t['dtype']}
    dims: [{dims_str}]
  }}"""

    inputs_str  = "\n".join(f"input [\n{fmt_tensor(i)}\n]" for i in inputs)
    outputs_str = "\n".join(f"output [\n{fmt_tensor(o)}\n]" for o in outputs)
    steps_str   = ",\n".join(steps)

    return f"""name: "{name}"
platform: "ensemble"
max_batch_size: 1
{inputs_str}
{outputs_str}
ensemble_scheduling {{
  step [
{steps_str}
  ]
}}
"""


# ---- Triton HTTP/gRPC adapter ---------------------------------------------

class TritonInferenceAdapter:
    """
    Humble Object wrapping tritonclient.
    Clean Architecture: this is the outermost adapter — all Triton logic lives here.
    The rest of the system never imports tritonclient directly.

    Production:
        from enterprise_patterns.cloud.nvidia.triton_adapter import TritonInferenceAdapter
        adapter = TritonInferenceAdapter(TritonConfig())

    Dev / Test:
        Use StubInferenceGateway from clean_architecture.py instead.
    """

    def __init__(self, config: TritonConfig | None = None):
        self.config = config or TritonConfig()
        self._client = None

    def _get_client(self):
        if self._client is not None:
            return self._client
        try:
            if self.config.use_grpc:
                import tritonclient.grpc as grpcclient
                self._client = grpcclient.InferenceServerClient(
                    url=self.config.grpc_url,
                    ssl=self.config.ssl,
                )
            else:
                import tritonclient.http as httpclient
                self._client = httpclient.InferenceServerClient(
                    url=self.config.url,
                    ssl=self.config.ssl,
                    connection_timeout=self.config.timeout_sec,
                    network_timeout=self.config.timeout_sec,
                )
        except ImportError:
            raise ImportError("Install tritonclient: pip install tritonclient[all]")
        return self._client

    # ---- Health -----------------------------------------------------------

    def is_live(self) -> bool:
        try:
            return self._get_client().is_server_live()
        except Exception:
            return False

    def is_ready(self) -> bool:
        try:
            return self._get_client().is_server_ready()
        except Exception:
            return False

    def is_model_ready(self, model_name: str, version: str = "") -> bool:
        try:
            return self._get_client().is_model_ready(model_name, model_version=version or "")
        except Exception:
            return False

    # ---- Metadata ---------------------------------------------------------

    def server_metadata(self) -> dict:
        return self._get_client().get_server_metadata(as_json=True)

    def model_metadata(self, model_name: str) -> dict:
        return self._get_client().get_model_metadata(model_name, as_json=True)

    def model_config(self, model_name: str) -> dict:
        return self._get_client().get_model_config(model_name, as_json=True)

    # ---- Inference --------------------------------------------------------

    def infer(
        self,
        model_name: str,
        inputs: dict[str, np.ndarray],
        outputs: list[str] | None = None,
        model_version: str = "",
    ) -> dict[str, np.ndarray]:
        """
        inputs:  {"input_name": np.ndarray, ...}
        outputs: ["output_name", ...]  — None = all outputs
        Returns: {"output_name": np.ndarray, ...}
        """
        client = self._get_client()

        if self.config.use_grpc:
            import tritonclient.grpc as grpcclient
            InferInput          = grpcclient.InferInput
            InferRequestedOutput = grpcclient.InferRequestedOutput
        else:
            import tritonclient.http as httpclient
            InferInput          = httpclient.InferInput
            InferRequestedOutput = httpclient.InferRequestedOutput

        triton_inputs = []
        for name, array in inputs.items():
            dtype_map = {
                "float32": "FP32", "float64": "FP64",
                "int32":   "INT32","int64":   "INT64",
                "int8":    "INT8", "uint8":   "UINT8",
                "bool":    "BOOL", "bytes":   "BYTES",
            }
            triton_dtype = dtype_map.get(str(array.dtype), "FP32")
            inp = InferInput(name, list(array.shape), triton_dtype)
            inp.set_data_from_numpy(array)
            triton_inputs.append(inp)

        triton_outputs = [InferRequestedOutput(n) for n in (outputs or [])]

        response = client.infer(
            model_name=model_name,
            inputs=triton_inputs,
            outputs=triton_outputs if triton_outputs else None,
            model_version=model_version,
        )

        result = {}
        output_names = outputs or [o["name"] for o in self.model_metadata(model_name).get("outputs", [])]
        for name in output_names:
            try:
                result[name] = response.as_numpy(name)
            except Exception:
                pass
        return result

    def infer_batch(
        self,
        model_name: str,
        batch_inputs: list[dict[str, np.ndarray]],
        outputs: list[str] | None = None,
    ) -> list[dict[str, np.ndarray]]:
        """Send multiple requests and collect results."""
        return [self.infer(model_name, inp, outputs) for inp in batch_inputs]

    # ---- Model management -------------------------------------------------

    def load_model(self, model_name: str):
        self._get_client().load_model(model_name)

    def unload_model(self, model_name: str):
        self._get_client().unload_model(model_name)

    def model_statistics(self, model_name: str) -> dict:
        return self._get_client().get_model_statistics(model_name, as_json=True)


# ---- Clean Architecture adapter (implements port) -------------------------

class TritonInferenceGateway:
    """
    Implements InferenceGateway port using TritonInferenceAdapter.
    This is the adapter layer in Clean Architecture.
    Use cases depend on InferenceGateway (abstract), not this class.
    """
    def __init__(self, adapter: TritonInferenceAdapter, output_name: str = "output__0"):
        self._adapter     = adapter
        self._output_name = output_name

    def predict(self, model_id: Any, inputs: dict) -> dict:
        model_name = model_id.value if hasattr(model_id, "value") else str(model_id)
        np_inputs  = {k: np.array(v, dtype=np.float32) for k, v in inputs.items()}
        results    = self._adapter.infer(model_name, np_inputs, outputs=[self._output_name])
        return {
            "output":     results.get(self._output_name, np.array([])).tolist(),
            "confidence": float(results.get(self._output_name, np.array([0.0]))[0])
                          if results.get(self._output_name) is not None else 0.0,
        }

    def health(self) -> bool:
        return self._adapter.is_live() and self._adapter.is_ready()


# ---------------------------------------------------------------------------
# Usage examples
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== config.pbtxt for ONNX classifier ===")
    cfg = make_config_pbtxt(
        name="bert-classifier",
        platform="onnxruntime_onnx",
        inputs=[{"name": "input_ids",       "dtype": "TYPE_INT64", "dims": [-1, 128]},
                {"name": "attention_mask",  "dtype": "TYPE_INT64", "dims": [-1, 128]}],
        outputs=[{"name": "logits",         "dtype": "TYPE_FP32",  "dims": [-1, 2]}],
        max_batch_size=16,
        dynamic_batching=True,
    )
    print(cfg[:400])

    print("\n=== Ensemble pipeline config ===")
    ens = make_ensemble_config(
        name="text-classify-pipeline",
        pipeline=[
            {"model": "tokenizer",   "input_map": {"raw_text": "text"},       "output_map": {"tokens": "input_ids"}},
            {"model": "bert-classifier", "input_map": {"input_ids": "input_ids"}, "output_map": {"logits": "class_logits"}},
        ],
        inputs=[{"name": "text",        "dtype": "TYPE_BYTES", "dims": [1]}],
        outputs=[{"name": "class_logits","dtype": "TYPE_FP32",  "dims": [2]}],
    )
    print(ens[:400])

    print("\n=== Triton adapter (dry run — no server needed) ===")
    config  = TritonConfig(url="localhost:8000")
    adapter = TritonInferenceAdapter(config)
    print(f"  Live:  {adapter.is_live()}")    # False without server
    print(f"  Ready: {adapter.is_ready()}")   # False without server
    print("  Production: point TRITON_URL=http://triton-server:8000 to a real server")
