"""
Anomaly Detector — ML-based detection using sklearn IsolationForest.

Scans recent transactions, engineers features, and flags those with a
low anomaly score (< -0.5) as suspicious.  The model is retrained weekly
and persisted to disk so restarts don't require a full re-fit.
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
from supabase import Client

logger = logging.getLogger(__name__)

# ── configuration ─────────────────────────────────────────────────────────────
MODELS_DIR = Path(os.environ.get("MODELS_DIR", "/app/models"))
MODEL_PATH = MODELS_DIR / "isolation_forest.joblib"
SCALER_PATH = MODELS_DIR / "scaler.joblib"
LAST_TRAINED_PATH = MODELS_DIR / "last_trained.txt"

ANOMALY_SCORE_THRESHOLD = -0.5      # below this → suspicious
RETRAIN_INTERVAL_DAYS = 7
TRAINING_LOOKBACK_DAYS = 90         # how far back to pull training data
RECENT_LOOKBACK_MINUTES = 5         # window for scoring new transactions


# ── feature engineering ───────────────────────────────────────────────────────

def _build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Derive ML features from a transactions DataFrame.

    Expected columns: user_id, amount, created_at
    Returned feature columns (all numeric):
        amount, hour_of_day, day_of_week,
        transactions_per_day, amount_zscore
    """
    df = df.copy()
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True, errors="coerce")
    df = df.dropna(subset=["created_at", "amount", "user_id"])
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0.0)

    df["hour_of_day"] = df["created_at"].dt.hour
    df["day_of_week"] = df["created_at"].dt.dayofweek
    df["date"] = df["created_at"].dt.date

    # Transactions-per-day per user
    daily_counts = (
        df.groupby(["user_id", "date"])
        .size()
        .reset_index(name="transactions_per_day")
    )
    df = df.merge(daily_counts, on=["user_id", "date"], how="left")

    # Z-score of amount per user (how unusual is this amount for this user)
    user_stats = df.groupby("user_id")["amount"].agg(["mean", "std"]).reset_index()
    user_stats.columns = ["user_id", "user_mean", "user_std"]
    df = df.merge(user_stats, on="user_id", how="left")
    df["user_std"] = df["user_std"].fillna(1.0).replace(0, 1.0)
    df["amount_zscore"] = (df["amount"] - df["user_mean"]) / df["user_std"]

    feature_cols = ["amount", "hour_of_day", "day_of_week", "transactions_per_day", "amount_zscore"]
    return df[feature_cols].fillna(0.0)


# ── persistence helpers ───────────────────────────────────────────────────────

def _days_since_last_train() -> float:
    """Return days elapsed since last model training, or infinity if never trained."""
    if LAST_TRAINED_PATH.exists():
        try:
            ts = datetime.fromisoformat(LAST_TRAINED_PATH.read_text().strip())
            return (datetime.now(timezone.utc) - ts).total_seconds() / 86400
        except Exception:  # noqa: BLE001
            pass
    return float("inf")


def _mark_trained() -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    LAST_TRAINED_PATH.write_text(datetime.now(timezone.utc).isoformat())


def _load_model() -> tuple[IsolationForest | None, StandardScaler | None]:
    if MODEL_PATH.exists() and SCALER_PATH.exists():
        try:
            model = joblib.load(MODEL_PATH)
            scaler = joblib.load(SCALER_PATH)
            logger.info("Loaded existing IsolationForest model from disk.")
            return model, scaler
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not load saved model: %s", exc)
    return None, None


def _save_model(model: IsolationForest, scaler: StandardScaler) -> None:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    joblib.dump(scaler, SCALER_PATH)
    logger.info("IsolationForest model saved to %s", MODELS_DIR)


# ── main detector class ───────────────────────────────────────────────────────

class AnomalyDetector:
    """
    Trains an IsolationForest on historical transaction data and uses it
    to flag recent transactions whose anomaly score falls below the threshold.
    """

    def __init__(self, supabase: Client) -> None:
        self.db = supabase
        self.model, self.scaler = _load_model()

    # ── training ──────────────────────────────────────────────────────────────

    def _fetch_training_data(self) -> pd.DataFrame:
        cutoff = (datetime.now(timezone.utc) - timedelta(days=TRAINING_LOOKBACK_DAYS)).isoformat()
        resp = (
            self.db.table("transactions")
            .select("id, user_id, amount, created_at")
            .gte("created_at", cutoff)
            .execute()
        )
        if not resp.data:
            return pd.DataFrame()
        return pd.DataFrame(resp.data)

    def train(self) -> bool:
        """Fetch historical data and retrain the model. Returns True on success."""
        logger.info("Starting IsolationForest training run…")
        df = self._fetch_training_data()

        if df.empty or len(df) < 50:
            logger.warning(
                "Not enough training data (%d rows). Skipping training.", len(df)
            )
            return False

        try:
            features = _build_features(df)
            if features.empty:
                logger.warning("Feature engineering produced empty dataframe.")
                return False

            scaler = StandardScaler()
            X = scaler.fit_transform(features.values)

            model = IsolationForest(
                n_estimators=100,
                contamination=0.05,   # assume ~5% anomalies
                random_state=42,
                n_jobs=-1,
            )
            model.fit(X)

            _save_model(model, scaler)
            _mark_trained()

            self.model = model
            self.scaler = scaler

            logger.info(
                "IsolationForest trained on %d transactions (features: %s).",
                len(features),
                list(features.columns),
            )
            return True

        except Exception as exc:  # noqa: BLE001
            logger.error("Model training failed: %s", exc, exc_info=True)
            return False

    def maybe_retrain(self) -> None:
        """Retrain if model is stale (> RETRAIN_INTERVAL_DAYS old) or missing."""
        if self.model is None or _days_since_last_train() >= RETRAIN_INTERVAL_DAYS:
            self.train()

    # ── scoring / detection ───────────────────────────────────────────────────

    def _fetch_recent_transactions(self) -> pd.DataFrame:
        cutoff = (
            datetime.now(timezone.utc) - timedelta(minutes=RECENT_LOOKBACK_MINUTES)
        ).isoformat()
        resp = (
            self.db.table("transactions")
            .select("id, user_id, amount, created_at")
            .gte("created_at", cutoff)
            .execute()
        )
        if not resp.data:
            return pd.DataFrame()
        return pd.DataFrame(resp.data)

    def detect(self) -> int:
        """Score recent transactions and insert anomaly events. Returns count inserted."""
        if self.model is None or self.scaler is None:
            logger.info("No model available — attempting initial training.")
            if not self.train():
                logger.warning("Anomaly detection skipped (no model).")
                return 0

        df = self._fetch_recent_transactions()
        if df.empty:
            return 0

        try:
            features = _build_features(df)
            if features.empty:
                return 0

            X = self.scaler.transform(features.values)
            scores = self.model.score_samples(X)   # lower = more anomalous

            anomaly_mask = scores < ANOMALY_SCORE_THRESHOLD
            if not anomaly_mask.any():
                return 0

            anomalous_df = df.iloc[np.where(anomaly_mask)[0]].copy()
            anomalous_df["anomaly_score"] = scores[anomaly_mask]

            events = []
            for _, row in anomalous_df.iterrows():
                events.append(
                    {
                        "event_type": "ml_anomaly_transaction",
                        "threat_level": self._score_to_level(row["anomaly_score"]),
                        "description": (
                            f"ML anomaly detected on transaction {row.get('id')} "
                            f"(score {row['anomaly_score']:.3f}). "
                            f"Amount: GHS {row.get('amount')}, user: {row.get('user_id')}."
                        ),
                        "metadata": {
                            "transaction_id": row.get("id"),
                            "amount": float(row.get("amount", 0)),
                            "anomaly_score": float(row["anomaly_score"]),
                            "threshold": ANOMALY_SCORE_THRESHOLD,
                        },
                        "user_id": row.get("user_id"),
                        "detected_at": datetime.now(timezone.utc).isoformat(),
                        "status": "open",
                    }
                )

            if events:
                resp = self.db.table("security_events").insert(events).execute()
                count = len(resp.data) if resp.data else 0
                logger.info("Anomaly detector inserted %d event(s).", count)
                return count

        except Exception as exc:  # noqa: BLE001
            logger.error("Anomaly detection scoring failed: %s", exc, exc_info=True)

        return 0

    @staticmethod
    def _score_to_level(score: float) -> str:
        """Map numeric anomaly score to a threat level string."""
        if score < -0.8:
            return "critical"
        if score < -0.65:
            return "high"
        if score < -0.5:
            return "medium"
        return "low"
