"""
NVIDIA GPU Compute Pipeline — cuML / RAPIDS
=============================================
Source: NVIDIA RAPIDS docs; github.com/rapidsai/cuml; developer.nvidia.com/rapids
Cloud:  NVIDIA DGX, AWS P4/P5, GCP A2/A3, Azure NC/ND series

RAPIDS provides GPU-accelerated equivalents of:
  cuDF   ≈ pandas     (GPU DataFrame)
  cuML   ≈ sklearn    (GPU ML)
  cuGraph ≈ networkx  (GPU graph analytics)
  cuSpatial ≈ geopandas (GPU spatial)

Zero-code-change acceleration via:
  %load_ext cuml.accel           (Jupyter)
  python -m cuml.accel script.py  (CLI)

Install: conda install -c rapidsai -c conda-forge rapids cuda-version=12.0
         OR: pip install cudf-cu12 cuml-cu12 --extra-index-url=https://pypi.nvidia.com

Speedups vs. CPU sklearn:
  RandomForest:   10-50x  |  KMeans:   30-100x
  PCA:            25-50x  |  DBSCAN:   60-200x
  Linear models:  15-40x  |  UMAP:     40-100x
"""

from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Any

import numpy as np


# ---- GPU availability check -----------------------------------------------

def gpu_available() -> bool:
    """Check if a CUDA GPU is accessible."""
    try:
        import subprocess
        result = subprocess.run(["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                                capture_output=True, text=True, timeout=5)
        return result.returncode == 0 and bool(result.stdout.strip())
    except Exception:
        return False


def rapids_available() -> bool:
    try:
        import cudf  # noqa: F401
        return True
    except ImportError:
        return False


# ---- Adaptive DataFrame (GPU if available, CPU fallback) ------------------

class AdaptiveDataFrame:
    """
    Uses cuDF when GPU/RAPIDS is available, falls back to pandas.
    DDD: Value Object wrapper for the data.
    12-Factor: no hardcoded GPU requirement.
    """
    def __init__(self, data: Any, force_cpu: bool = False):
        self._use_gpu = rapids_available() and not force_cpu
        if self._use_gpu:
            import cudf
            self._df = cudf.DataFrame(data) if not hasattr(data, "to_cudf") else data
        else:
            import pandas as pd
            self._df = pd.DataFrame(data) if not hasattr(data, "to_pandas") else data

    @property
    def df(self):
        return self._df

    def to_numpy(self) -> np.ndarray:
        if self._use_gpu:
            return self._df.to_numpy()
        return self._df.to_numpy()

    def filter(self, condition):
        return self._df[condition]

    def fillna(self, value):
        return self._df.fillna(value)

    @property
    def on_gpu(self) -> bool:
        return self._use_gpu

    def __repr__(self):
        device = "GPU (cuDF)" if self._use_gpu else "CPU (pandas)"
        return f"AdaptiveDataFrame[{device}, shape={self._df.shape}]"


# ---- GPU-accelerated ML Pipeline -----------------------------------------

@dataclass
class GPUPipelineConfig:
    n_estimators:    int   = field(default_factory=lambda: int(os.getenv("RF_N_ESTIMATORS", "100")))
    max_depth:       int   = field(default_factory=lambda: int(os.getenv("RF_MAX_DEPTH", "10")))
    random_state:    int   = 42
    force_cpu:       bool  = field(default_factory=lambda: os.getenv("FORCE_CPU", "false") == "true")
    kmeans_clusters: int   = field(default_factory=lambda: int(os.getenv("KMEANS_CLUSTERS", "8")))


class GPUMLPipeline:
    """
    Unified ML pipeline with GPU acceleration (cuML) and CPU fallback (sklearn).
    All interfaces are scikit-learn compatible — swap GPU/CPU transparently.

    Clean Architecture: this is an infrastructure adapter.
    12-Factor: GPU use is controlled by FORCE_CPU env var.
    """

    def __init__(self, config: GPUPipelineConfig | None = None):
        self.config    = config or GPUPipelineConfig()
        self._use_gpu  = rapids_available() and not self.config.force_cpu
        self._mode     = "GPU (cuML)" if self._use_gpu else "CPU (sklearn)"
        print(f"[GPUMLPipeline] Mode: {self._mode}")

    # ---- Preprocessing ----------------------------------------------------

    def preprocess(self, data: dict | Any) -> tuple:
        """
        Convert raw data to feature matrix.
        Returns (X, y) as numpy arrays ready for training.
        """
        adf = AdaptiveDataFrame(data, force_cpu=not self._use_gpu)
        print(f"[GPUMLPipeline] {adf}")
        return adf.to_numpy(), None

    def train_test_split(self, X: np.ndarray, y: np.ndarray, test_size: float = 0.2):
        if self._use_gpu:
            from cuml.model_selection import train_test_split
        else:
            from sklearn.model_selection import train_test_split
        return train_test_split(X, y, test_size=test_size, random_state=self.config.random_state)

    def scale(self, X_train: np.ndarray, X_test: np.ndarray):
        if self._use_gpu:
            from cuml.preprocessing import StandardScaler
        else:
            from sklearn.preprocessing import StandardScaler
        scaler = StandardScaler()
        X_train_scaled = scaler.fit_transform(X_train)
        X_test_scaled  = scaler.transform(X_test)
        return X_train_scaled, X_test_scaled, scaler

    def pca(self, X: np.ndarray, n_components: int = 50):
        if self._use_gpu:
            from cuml.decomposition import PCA
        else:
            from sklearn.decomposition import PCA
        return PCA(n_components=n_components).fit_transform(X)

    # ---- Classification ---------------------------------------------------

    def train_random_forest(self, X_train: np.ndarray, y_train: np.ndarray):
        if self._use_gpu:
            from cuml.ensemble import RandomForestClassifier
        else:
            from sklearn.ensemble import RandomForestClassifier
        model = RandomForestClassifier(
            n_estimators=self.config.n_estimators,
            max_depth=self.config.max_depth,
            random_state=self.config.random_state,
        )
        model.fit(X_train, y_train)
        print(f"[GPUMLPipeline] RandomForest trained ({self._mode})")
        return model

    def train_logistic_regression(self, X_train: np.ndarray, y_train: np.ndarray):
        if self._use_gpu:
            from cuml.linear_model import LogisticRegression
        else:
            from sklearn.linear_model import LogisticRegression
        model = LogisticRegression(max_iter=1000, random_state=self.config.random_state)
        model.fit(X_train, y_train)
        return model

    # ---- Clustering -------------------------------------------------------

    def kmeans(self, X: np.ndarray) -> np.ndarray:
        if self._use_gpu:
            from cuml.cluster import KMeans
        else:
            from sklearn.cluster import KMeans
        model = KMeans(n_clusters=self.config.kmeans_clusters,
                       random_state=self.config.random_state)
        return model.fit_predict(X)

    def dbscan(self, X: np.ndarray, eps: float = 0.5, min_samples: int = 5) -> np.ndarray:
        if self._use_gpu:
            from cuml.cluster import DBSCAN
        else:
            from sklearn.cluster import DBSCAN
        return DBSCAN(eps=eps, min_samples=min_samples).fit_predict(X)

    # ---- Nearest Neighbors ------------------------------------------------

    def nearest_neighbors(self, X: np.ndarray, n_neighbors: int = 10):
        if self._use_gpu:
            from cuml.neighbors import NearestNeighbors
        else:
            from sklearn.neighbors import NearestNeighbors
        nn = NearestNeighbors(n_neighbors=n_neighbors)
        nn.fit(X)
        return nn

    # ---- Dimensionality reduction -----------------------------------------

    def umap(self, X: np.ndarray, n_components: int = 2):
        """UMAP for 2D/3D visualization — 40-100x faster on GPU."""
        if self._use_gpu:
            from cuml.manifold import UMAP
        else:
            try:
                from umap import UMAP
            except ImportError:
                from sklearn.manifold import TSNE as UMAP  # fallback
        return UMAP(n_components=n_components).fit_transform(X)

    # ---- Evaluation -------------------------------------------------------

    def evaluate(self, model, X_test: np.ndarray, y_test: np.ndarray) -> dict:
        if self._use_gpu:
            from cuml.metrics import accuracy_score, f1_score
        else:
            from sklearn.metrics import accuracy_score, f1_score
        preds = model.predict(X_test)
        return {
            "accuracy": float(accuracy_score(y_test, preds)),
            "f1":       float(f1_score(y_test, preds, average="weighted")),
            "mode":     self._mode,
        }


# ---- Batch GPU inference pipeline (for large offline datasets) -----------

class GPUBatchInferencePipeline:
    """
    Process large datasets in GPU batches.
    Pattern: combines Triton or NIM for model + cuDF for data preprocessing.
    Sector: offline scoring, feature generation, embedding large corpora.
    """

    def __init__(self, inference_fn, batch_size: int = 256, use_gpu_df: bool = True):
        self._infer     = inference_fn
        self.batch_size = batch_size
        self._use_gpu   = use_gpu_df and rapids_available()

    def process(self, data: list[Any]) -> list[Any]:
        results = []
        for i in range(0, len(data), self.batch_size):
            batch = data[i:i + self.batch_size]
            try:
                batch_result = self._infer(batch)
                results.extend(batch_result if isinstance(batch_result, list) else [batch_result])
                print(f"  [GPUBatch] Processed {min(i + self.batch_size, len(data))}/{len(data)}")
            except Exception as exc:
                print(f"  [GPUBatch] Batch {i//self.batch_size} failed: {exc}")
                results.extend([None] * len(batch))
        return results


# ---------------------------------------------------------------------------
# Usage example (CPU fallback — runs without GPU)
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"GPU available:   {gpu_available()}")
    print(f"RAPIDS available: {rapids_available()}")

    print("\n=== GPU ML Pipeline (CPU fallback) ===")
    pipeline = GPUMLPipeline(GPUPipelineConfig(n_estimators=10, force_cpu=True))

    # Generate synthetic data
    np.random.seed(42)
    X = np.random.rand(1000, 10).astype(np.float32)
    y = (X[:, 0] + X[:, 1] > 1.0).astype(np.int32)

    X_train, X_test, y_train, y_test = pipeline.train_test_split(X, y)
    X_train_s, X_test_s, _           = pipeline.scale(X_train, X_test)
    model  = pipeline.train_random_forest(X_train_s, y_train)
    metrics = pipeline.evaluate(model, X_test_s, y_test)

    print(f"\nResults: accuracy={metrics['accuracy']:.4f}, f1={metrics['f1']:.4f} [{metrics['mode']}]")

    print("\n=== Batch Inference ===")
    def mock_model(batch): return [f"pred_{i}" for i in range(len(batch))]
    batcher = GPUBatchInferencePipeline(mock_model, batch_size=3)
    results = batcher.process(list(range(7)))
    print(f"  Results: {results}")
