"""
Vertex AI Feature Store v2 + Vector Search (Matching Engine)
=============================================================
Source: cloud.google.com/vertex-ai/docs/featurestore
        cloud.google.com/vertex-ai/docs/vector-search/overview
Install: pip install google-cloud-aiplatform

FEATURE STORE v2
----------------
Online store:  Bigtable-backed; sub-10ms feature retrieval for real-time inference
Offline store: BigQuery; used for training data generation
Feature View:  links BigQuery source to online store + defines sync schedule

VECTOR SEARCH (Matching Engine)
--------------------------------
Purpose: Approximate Nearest Neighbor (ANN) search at billion-scale
Index types:
  - Tree AH (Asymmetric Hashing): best for large datasets, low memory
  - Brute Force: exact nearest neighbor (small datasets)
Distance metrics: DOT_PRODUCT, COSINE, L2_SQUARED (Euclidean)

Pattern: Hybrid retrieval = dense (Vector Search) + sparse (BM25) combined
"""

from __future__ import annotations
import os
import json
import numpy as np
from dataclasses import dataclass, field
from typing import Any


@dataclass
class VertexConfig:
    project:   str = field(default_factory=lambda: os.getenv("GOOGLE_CLOUD_PROJECT", ""))
    location:  str = field(default_factory=lambda: os.getenv("VERTEX_LOCATION", "us-central1"))
    gcs_bucket: str = field(default_factory=lambda: os.getenv("GCS_BUCKET", ""))


# ============================================================================
# FEATURE STORE v2
# ============================================================================

class VertexFeatureStore:
    """
    Vertex AI Feature Store v2 adapter.
    Anti-Corruption Layer: translates domain feature requests → Vertex API.

    Two stores:
      Online  → real-time inference (Bigtable; low-latency lookup)
      Offline → training (BigQuery; batch reads)
    """

    def __init__(self, config: VertexConfig | None = None):
        self.config = config or VertexConfig()

    # ---- Setup (run once) ------------------------------------------------

    def create_feature_store(self, display_name: str, project: str = "") -> Any:
        """Create the Feature Store resource."""
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=project or self.config.project, location=self.config.location)
            return aiplatform.FeatureStore.create(display_name=display_name)
        except ImportError:
            print(f"[FeatureStore] Stub: create '{display_name}'")
            return {"display_name": display_name}

    def create_online_store(self, display_name: str, min_nodes: int = 1, max_nodes: int = 10) -> Any:
        """Create a Bigtable-backed online serving store."""
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)
            return aiplatform.FeatureOnlineStore.create(
                display_name=display_name,
                bigtable_config=aiplatform.FeatureOnlineStoreBigtableConfig(
                    auto_scaling=aiplatform.FeatureOnlineStoreBigtableConfig.AutoScaling(
                        min_node_count=min_nodes,
                        max_node_count=max_nodes,
                    )
                ),
            )
        except ImportError:
            print(f"[FeatureStore] Stub: create online store '{display_name}'")
            return {"display_name": display_name, "min_nodes": min_nodes, "max_nodes": max_nodes}

    def create_feature_view(
        self,
        display_name:     str,
        featurestore_id:  str,
        bq_source_uri:    str,          # "bq://project.dataset.table"
        entity_id_column: str = "entity_id",
        online_store_id:  str = "",
    ) -> Any:
        """Link a BigQuery table to a Feature View (offline + optional online)."""
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)
            return aiplatform.FeatureView.create(
                display_name=display_name,
                featurestore_id=featurestore_id,
                source_bq_uri=bq_source_uri,
                entity_id_columns=[entity_id_column],
                **({"feature_online_store_id": online_store_id} if online_store_id else {}),
            )
        except ImportError:
            print(f"[FeatureStore] Stub: create feature view '{display_name}' from {bq_source_uri}")
            return {"display_name": display_name, "source": bq_source_uri}

    # ---- Online serving (real-time inference) ----------------------------

    def fetch_features(
        self,
        entity_ids:         list[str],
        feature_view_name:  str,
        feature_names:      list[str] | None = None,
    ) -> list[dict]:
        """
        Low-latency feature lookup for online inference.
        Returns list of feature dicts, one per entity_id.
        """
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)
            result = aiplatform.FeatureStore.fetch_feature_values(
                entity_ids=entity_ids,
                feature_view_name=feature_view_name,
            )
            return result
        except ImportError:
            print(f"[FeatureStore] Stub: fetch {len(entity_ids)} entities from '{feature_view_name}'")
            return [{"entity_id": eid, "feature_stub": 0.5} for eid in entity_ids]

    # ---- Offline reading (training) ---------------------------------------

    def read_offline_features(
        self,
        bq_dataset:     str,
        table_name:     str,
        entity_ids:     list[str] | None = None,
        start_time:     str = "",
        end_time:       str = "",
    ) -> list[dict]:
        """
        Read features from BigQuery for training data generation.
        Returns list of feature rows.
        """
        print(f"[FeatureStore] Offline read: {bq_dataset}.{table_name}")
        # Production:
        # from google.cloud import bigquery
        # client = bigquery.Client(project=self.config.project)
        # query = f"SELECT * FROM `{bq_dataset}.{table_name}`"
        # if entity_ids: query += f" WHERE entity_id IN ({', '.join(repr(e) for e in entity_ids)})"
        # return [dict(row) for row in client.query(query)]
        return [{"entity_id": "stub-1", "feature_1": 0.7, "feature_2": 0.3}]


# ============================================================================
# VECTOR SEARCH (Matching Engine)
# ============================================================================

class VertexVectorSearch:
    """
    Vertex AI Vector Search adapter.
    Billion-scale approximate nearest neighbor search.

    Index formats supported for initial data upload (GCS):
      - JSONL: {"id": "1", "embedding": [0.1, 0.2, ...]}
      - CSV:   id,emb_0,emb_1,...
    """

    def __init__(self, config: VertexConfig | None = None):
        self.config = config or VertexConfig()
        self._index_endpoint = None

    # ---- Index management ------------------------------------------------

    def create_index(
        self,
        display_name:     str,
        embeddings_gcs:   str,       # gs://bucket/embeddings/ containing JSONL files
        dimensions:       int = 768,
        approx_neighbors: int = 150,
        distance_measure: str = "DOT_PRODUCT",  # DOT_PRODUCT | COSINE | L2_SQUARED
        shard_size:       str = "SHARD_SIZE_MEDIUM",
    ) -> Any:
        """
        Create a new index from embeddings stored in GCS.
        Embeddings JSONL format:  {"id": "doc-1", "embedding": [0.1, ...]}
        """
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)
            return aiplatform.MatchingEngineIndex.create_tree_ah_index(
                display_name=display_name,
                contents_delta_uri=embeddings_gcs,
                dimensions=dimensions,
                approximate_neighbors_count=approx_neighbors,
                distance_measure_type=distance_measure,
                shard_size=shard_size,
            )
        except ImportError:
            print(f"[VectorSearch] Stub: create index '{display_name}' from {embeddings_gcs} dim={dimensions}")
            return {"display_name": display_name, "dimensions": dimensions}

    def create_endpoint(self, display_name: str, public: bool = True) -> Any:
        """Create an index endpoint (where indexes are deployed)."""
        try:
            from google.cloud import aiplatform
            aiplatform.init(project=self.config.project, location=self.config.location)
            endpoint = aiplatform.MatchingEngineIndexEndpoint.create(
                display_name=display_name,
                public_endpoint_enabled=public,
            )
            self._index_endpoint = endpoint
            return endpoint
        except ImportError:
            print(f"[VectorSearch] Stub: create endpoint '{display_name}'")
            return {"display_name": display_name}

    def deploy_index(
        self,
        index:             Any,
        deployed_index_id: str,
        machine_type:      str = "n1-standard-16",
        min_replicas:      int = 1,
        max_replicas:      int = 5,
    ) -> Any:
        """Deploy an index to an endpoint to make it queryable."""
        try:
            return self._index_endpoint.deploy_index(
                index=index,
                deployed_index_id=deployed_index_id,
                machine_type=machine_type,
                min_replica_count=min_replicas,
                max_replica_count=max_replicas,
            )
        except Exception as exc:
            print(f"[VectorSearch] Stub deploy: {exc}")
            return {"deployed_index_id": deployed_index_id}

    # ---- Query -----------------------------------------------------------

    def find_neighbors(
        self,
        deployed_index_id: str,
        queries:           np.ndarray,    # shape: (n_queries, dim)
        k:                 int = 10,
        filter_tags:       list[str] | None = None,
    ) -> list[list[dict]]:
        """
        ANN query. Returns list of result lists (one per query).
        Each result: [{"id": "doc-1", "distance": 0.95}, ...]
        """
        try:
            from google.cloud import aiplatform
            if self._index_endpoint is None:
                raise RuntimeError("No endpoint configured — call create_endpoint() first")
            results = self._index_endpoint.find_neighbors(
                deployed_index_id=deployed_index_id,
                queries=queries.tolist() if isinstance(queries, np.ndarray) else queries,
                num_neighbors=k,
                **({"filter": [{"namespace": "tags", "allow_tokens": filter_tags}]}
                   if filter_tags else {}),
            )
            return [[{"id": n.id, "distance": n.distance} for n in qr] for qr in results]
        except ImportError:
            print(f"[VectorSearch] Stub: querying {len(queries)} vectors, k={k}")
            return [[{"id": f"doc-{j}", "distance": 0.9 - j * 0.05} for j in range(k)]
                    for _ in range(len(queries) if hasattr(queries, "__len__") else 1)]

    # ---- Upsert embeddings (online index update) -------------------------

    def upsert_datapoints(
        self,
        index_resource_name: str,
        datapoints: list[dict],          # [{"datapoint_id": "1", "feature_vector": [...]}]
    ) -> None:
        """Add or update vectors in an existing index (streaming update)."""
        try:
            from google.cloud import aiplatform
            index = aiplatform.MatchingEngineIndex(index_resource_name)
            index.upsert_datapoints(datapoints=datapoints)
            print(f"[VectorSearch] Upserted {len(datapoints)} datapoints")
        except ImportError:
            print(f"[VectorSearch] Stub upsert: {len(datapoints)} datapoints")

    # ---- Helper: generate embeddings JSONL for GCS upload ---------------

    @staticmethod
    def make_embeddings_jsonl(
        ids: list[str],
        embeddings: np.ndarray,
        output_path: str = "/tmp/embeddings.jsonl",
        restricts: list[dict] | None = None,
    ) -> str:
        """
        Write embeddings to JSONL for GCS upload.
        restricts: [{"namespace": "category", "allow": ["finance", "tech"]}]
        """
        with open(output_path, "w") as f:
            for i, (doc_id, emb) in enumerate(zip(ids, embeddings)):
                record: dict = {"id": doc_id, "embedding": emb.tolist()}
                if restricts:
                    record["restricts"] = restricts[i] if i < len(restricts) else []
                f.write(json.dumps(record) + "\n")
        print(f"[VectorSearch] Wrote {len(ids)} embeddings to {output_path}")
        return output_path


# ============================================================================
# Hybrid Retrieval: Vector Search + Keyword Search
# ============================================================================

class HybridRetriever:
    """
    Combines dense (Vertex Vector Search) + sparse (BM25/keyword) retrieval.
    Pattern: Reciprocal Rank Fusion (RRF) for score combination.
    Sector:  Enterprise RAG, legal search, document retrieval.
    """
    def __init__(self, vector_search: VertexVectorSearch, rrf_k: int = 60):
        self.vs    = vector_search
        self.rrf_k = rrf_k
        self._corpus: list[str] = []

    def index_corpus(self, docs: list[str], embeddings: np.ndarray, deployed_index_id: str):
        self._corpus = docs
        self._deployed_id = deployed_index_id

    def _bm25_rank(self, query: str, k: int = 10) -> list[tuple[int, float]]:
        """Stub BM25 keyword ranking (replace with rank_bm25 library)."""
        tokens = query.lower().split()
        scores = []
        for i, doc in enumerate(self._corpus):
            score = sum(doc.lower().count(t) for t in tokens)
            scores.append((i, float(score)))
        return sorted(scores, key=lambda x: -x[1])[:k]

    def _rrf_score(self, rank: int) -> float:
        return 1.0 / (self.rrf_k + rank + 1)

    def search(
        self,
        query_embedding: np.ndarray,
        query_text:      str,
        k:               int = 10,
        alpha:           float = 0.7,   # weight for dense; (1-alpha) for sparse
    ) -> list[dict]:
        """
        Hybrid search: alpha controls dense vs. sparse balance.
        alpha=1.0 = pure dense; alpha=0.0 = pure sparse.
        """
        dense_results  = self.vs.find_neighbors(
            self._deployed_id, query_embedding.reshape(1, -1), k=k
        )[0]
        sparse_results = self._bm25_rank(query_text, k=k)

        # RRF combination
        scores: dict[str, float] = {}
        for rank, r in enumerate(dense_results):
            scores[r["id"]] = scores.get(r["id"], 0) + alpha * self._rrf_score(rank)
        for rank, (idx, _) in enumerate(sparse_results):
            doc_id = str(idx)
            scores[doc_id] = scores.get(doc_id, 0) + (1 - alpha) * self._rrf_score(rank)

        sorted_ids = sorted(scores, key=scores.get, reverse=True)[:k]  # type: ignore[arg-type]
        return [{"id": doc_id, "score": scores[doc_id]} for doc_id in sorted_ids]


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    cfg = VertexConfig()
    print(f"Project:  {cfg.project or '(set GOOGLE_CLOUD_PROJECT)'}")

    print("\n=== Feature Store — fetch features (stub) ===")
    fs = VertexFeatureStore(cfg)
    features = fs.fetch_features(["user-1", "user-2"], "user-features-online")
    for f in features:
        print(f"  {f}")

    print("\n=== Vector Search — create embeddings JSONL ===")
    vs      = VertexVectorSearch(cfg)
    ids     = [f"doc-{i}" for i in range(5)]
    embeds  = np.random.rand(5, 768).astype(np.float32)
    path    = vs.make_embeddings_jsonl(ids, embeds)
    print(f"  Written to: {path}")

    print("\n=== Vector Search — query (stub) ===")
    query = np.random.rand(1, 768).astype(np.float32)
    results = vs.find_neighbors("deployed-index", query, k=3)
    for r in results[0]:
        print(f"  {r}")

    print("\n=== Hybrid Retrieval ===")
    hr = HybridRetriever(vs)
    hr._corpus = ["Python is great for ML", "NVIDIA GPU accelerates training", "Vertex AI pipelines scale easily"]
    hr._deployed_id = "stub"
    results = hr.search(query[0], "GPU machine learning", k=3)
    print(f"  Top results: {results}")
