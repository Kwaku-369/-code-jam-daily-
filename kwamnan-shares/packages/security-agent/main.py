"""
Kwamnan Rural Bank — AI Security Agent Service
===============================================
FastAPI app with APScheduler background tasks.

Schedules:
  • Threat detection  — every 60 s
  • Anomaly detection — every 5 min
  • Duplicate scan    — every 6 h (configurable)
  • Model retrain     — weekly (checked on every anomaly run)

Environment variables (see .env.example):
  SUPABASE_URL, SUPABASE_SERVICE_KEY
"""

from __future__ import annotations

import logging
import os
import sys
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from dotenv import load_dotenv
from fastapi import FastAPI
from supabase import create_client, Client

# ── env & logging ─────────────────────────────────────────────────────────────
load_dotenv()

LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=LOG_LEVEL,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)

# ── supabase client ───────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_KEY = os.environ["SUPABASE_SERVICE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# ── interval config (env-overridable) ─────────────────────────────────────────
THREAT_INTERVAL_S = int(os.environ.get("THREAT_POLL_INTERVAL_SECONDS", "60"))
ANOMALY_INTERVAL_S = int(os.environ.get("ANOMALY_POLL_INTERVAL_SECONDS", "300"))
DUPLICATE_INTERVAL_H = int(os.environ.get("DUPLICATE_SCAN_INTERVAL_HOURS", "6"))

# ── lazy-import agents (keeps startup fast if deps are slow) ──────────────────
from agents.threat_detector import ThreatDetector        # noqa: E402
from agents.anomaly_detector import AnomalyDetector      # noqa: E402
from agents.duplicate_scanner import DuplicateScanner    # noqa: E402

threat_detector = ThreatDetector(supabase)
anomaly_detector = AnomalyDetector(supabase)
duplicate_scanner = DuplicateScanner(supabase)

# ── scheduler ─────────────────────────────────────────────────────────────────
scheduler = AsyncIOScheduler(timezone="UTC")

# ── runtime state (for /health) ───────────────────────────────────────────────
_last_run: dict[str, str | None] = {
    "threat_detection": None,
    "anomaly_detection": None,
    "duplicate_scan": None,
}
_errors: dict[str, str | None] = {
    "threat_detection": None,
    "anomaly_detection": None,
    "duplicate_scan": None,
}


# ── job functions ─────────────────────────────────────────────────────────────

async def job_threat_detection() -> None:
    """APScheduler job: run rules-based threat checks."""
    try:
        count = threat_detector.run_all()
        _last_run["threat_detection"] = datetime.now(timezone.utc).isoformat()
        _errors["threat_detection"] = None
        if count:
            logger.info("Threat detection: %d new event(s) inserted.", count)
    except Exception as exc:  # noqa: BLE001
        _errors["threat_detection"] = str(exc)
        logger.error("Threat detection job failed: %s", exc, exc_info=True)


async def job_anomaly_detection() -> None:
    """APScheduler job: ML-based anomaly scoring + weekly model retrain."""
    try:
        anomaly_detector.maybe_retrain()
        count = anomaly_detector.detect()
        _last_run["anomaly_detection"] = datetime.now(timezone.utc).isoformat()
        _errors["anomaly_detection"] = None
        if count:
            logger.info("Anomaly detection: %d new event(s) inserted.", count)
    except Exception as exc:  # noqa: BLE001
        _errors["anomaly_detection"] = str(exc)
        logger.error("Anomaly detection job failed: %s", exc, exc_info=True)


async def job_duplicate_scan() -> None:
    """APScheduler job: fuzzy duplicate account detection."""
    try:
        count = duplicate_scanner.scan()
        _last_run["duplicate_scan"] = datetime.now(timezone.utc).isoformat()
        _errors["duplicate_scan"] = None
        if count:
            logger.info("Duplicate scan: %d new flag(s) inserted.", count)
    except Exception as exc:  # noqa: BLE001
        _errors["duplicate_scan"] = str(exc)
        logger.error("Duplicate scan job failed: %s", exc, exc_info=True)


# ── lifespan (startup / shutdown) ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    logger.info(
        "Kwamnan Security Agent starting — threat=%ds, anomaly=%ds, duplicates=%dh",
        THREAT_INTERVAL_S,
        ANOMALY_INTERVAL_S,
        DUPLICATE_INTERVAL_H,
    )

    scheduler.add_job(
        job_threat_detection,
        trigger=IntervalTrigger(seconds=THREAT_INTERVAL_S),
        id="threat_detection",
        name="Rules-based threat detection",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=30,
    )

    scheduler.add_job(
        job_anomaly_detection,
        trigger=IntervalTrigger(seconds=ANOMALY_INTERVAL_S),
        id="anomaly_detection",
        name="ML anomaly detection",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=60,
    )

    scheduler.add_job(
        job_duplicate_scan,
        trigger=IntervalTrigger(hours=DUPLICATE_INTERVAL_H),
        id="duplicate_scan",
        name="Duplicate account scan",
        replace_existing=True,
        max_instances=1,
        misfire_grace_time=300,
    )

    scheduler.start()
    logger.info("Scheduler started with %d job(s).", len(scheduler.get_jobs()))

    # Run initial checks without waiting for first interval tick
    await job_threat_detection()
    await job_anomaly_detection()

    yield  # ── app is running ──

    scheduler.shutdown(wait=False)
    logger.info("Scheduler shut down.")


# ── app ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Kwamnan Rural Bank — Security Agent",
    version="1.0.0",
    description="AI-powered security monitoring for Kwamnan shares trading platform.",
    lifespan=lifespan,
)


# ── routes ────────────────────────────────────────────────────────────────────

@app.get("/health", tags=["system"])
async def health() -> dict:
    """
    Health check endpoint for Railway.
    Returns scheduler status, last job run times, and any recent errors.
    """
    jobs = {
        job.id: {
            "next_run": job.next_run_time.isoformat() if job.next_run_time else None,
        }
        for job in scheduler.get_jobs()
    }

    all_healthy = all(v is None for v in _errors.values())

    return {
        "status": "healthy" if all_healthy else "degraded",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": os.environ.get("ENVIRONMENT", "production"),
        "scheduler": {
            "running": scheduler.running,
            "jobs": jobs,
        },
        "last_run": _last_run,
        "errors": _errors,
    }


@app.get("/", include_in_schema=False)
async def root():
    return {"service": "kwamnan-security-agent", "status": "running"}
