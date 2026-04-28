"""
Threat Detector — rules-based security event analysis.

Polls security_events and audit_logs tables, applies heuristic rules,
and writes new threat records back to security_events.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone, timedelta
from typing import Any

from supabase import Client

logger = logging.getLogger(__name__)

# ── thresholds ────────────────────────────────────────────────────────────────
FAILED_LOGIN_WINDOW_MINUTES = 5
FAILED_LOGIN_THRESHOLD = 5          # attempts from same IP → high threat

TRANSACTION_SPIKE_MULTIPLIER = 10   # >10× user average → high threat
UNUSUAL_HOURS_START = 1             # 01:00 Ghana time (UTC+0 / WAT)
UNUSUAL_HOURS_END = 4               # 04:00

MULTI_ACCOUNT_THRESHOLD = 3         # new accounts from same IP → medium threat
MULTI_ACCOUNT_WINDOW_HOURS = 24

# ── helpers ───────────────────────────────────────────────────────────────────

def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _build_event(
    threat_type: str,
    threat_level: str,
    description: str,
    metadata: dict[str, Any],
    user_id: str | None = None,
    source_ip: str | None = None,
) -> dict[str, Any]:
    return {
        "event_type": threat_type,
        "threat_level": threat_level,
        "description": description,
        "metadata": metadata,
        "user_id": user_id,
        "source_ip": source_ip,
        "detected_at": _iso(_now_utc()),
        "status": "open",
    }


# ── main detector class ───────────────────────────────────────────────────────

class ThreatDetector:
    """
    Runs all rules-based threat checks against Supabase data.
    Each public `check_*` method returns a list of threat dicts to insert.
    `run_all()` chains them and bulk-inserts any findings.
    """

    def __init__(self, supabase: Client) -> None:
        self.db = supabase

    # ── 1. failed logins ──────────────────────────────────────────────────────

    def check_failed_logins(self) -> list[dict[str, Any]]:
        """Multiple failed logins from the same IP within the sliding window."""
        window_start = _iso(_now_utc() - timedelta(minutes=FAILED_LOGIN_WINDOW_MINUTES))

        resp = (
            self.db.table("audit_logs")
            .select("source_ip, user_id, created_at")
            .eq("action", "login_failed")
            .gte("created_at", window_start)
            .execute()
        )

        events: list[dict[str, Any]] = []
        if not resp.data:
            return events

        # Group by source IP
        by_ip: dict[str, list[dict]] = defaultdict(list)
        for row in resp.data:
            ip = row.get("source_ip")
            if ip:
                by_ip[ip].append(row)

        for ip, attempts in by_ip.items():
            if len(attempts) >= FAILED_LOGIN_THRESHOLD:
                user_ids = list({a.get("user_id") for a in attempts if a.get("user_id")})
                events.append(
                    _build_event(
                        threat_type="brute_force_login",
                        threat_level="high",
                        description=(
                            f"{len(attempts)} failed login attempts from {ip} "
                            f"in the last {FAILED_LOGIN_WINDOW_MINUTES} minutes."
                        ),
                        metadata={
                            "attempt_count": len(attempts),
                            "window_minutes": FAILED_LOGIN_WINDOW_MINUTES,
                            "affected_user_ids": user_ids,
                        },
                        source_ip=ip,
                    )
                )
                logger.warning("Brute-force detected from IP %s (%d attempts)", ip, len(attempts))

        return events

    # ── 2. new country login ──────────────────────────────────────────────────

    def check_new_country_logins(self) -> list[dict[str, Any]]:
        """Login from a country not seen in the user's last 30 days."""
        window_start = _iso(_now_utc() - timedelta(minutes=FAILED_LOGIN_WINDOW_MINUTES))
        history_start = _iso(_now_utc() - timedelta(days=30))

        recent_resp = (
            self.db.table("audit_logs")
            .select("user_id, source_ip, country_code, created_at")
            .eq("action", "login_success")
            .gte("created_at", window_start)
            .execute()
        )

        events: list[dict[str, Any]] = []
        if not recent_resp.data:
            return events

        for login in recent_resp.data:
            uid = login.get("user_id")
            country = login.get("country_code")
            if not uid or not country:
                continue

            history_resp = (
                self.db.table("audit_logs")
                .select("country_code")
                .eq("user_id", uid)
                .eq("action", "login_success")
                .gte("created_at", history_start)
                .neq("country_code", country)
                .execute()
            )

            known_countries = {r["country_code"] for r in (history_resp.data or []) if r.get("country_code")}

            # If user has login history but this country is brand new
            if history_resp.data is not None and country not in known_countries and len(history_resp.data) > 0:
                # Verify they have ANY older logins (to avoid flagging brand-new users)
                prior_resp = (
                    self.db.table("audit_logs")
                    .select("country_code")
                    .eq("user_id", uid)
                    .eq("action", "login_success")
                    .lt("created_at", window_start)
                    .limit(1)
                    .execute()
                )
                if prior_resp.data:
                    events.append(
                        _build_event(
                            threat_type="new_country_login",
                            threat_level="medium",
                            description=f"User {uid} logged in from new country: {country}.",
                            metadata={
                                "new_country": country,
                                "known_countries": list(known_countries),
                                "login_ip": login.get("source_ip"),
                            },
                            user_id=uid,
                            source_ip=login.get("source_ip"),
                        )
                    )
                    logger.info("New country login for user %s from %s", uid, country)

        return events

    # ── 3. transaction spike ──────────────────────────────────────────────────

    def check_transaction_spikes(self) -> list[dict[str, Any]]:
        """Single transaction >10× the user's 30-day average amount."""
        window_start = _iso(_now_utc() - timedelta(minutes=FAILED_LOGIN_WINDOW_MINUTES))
        history_start = _iso(_now_utc() - timedelta(days=30))

        recent_resp = (
            self.db.table("transactions")
            .select("id, user_id, amount, created_at")
            .gte("created_at", window_start)
            .execute()
        )

        events: list[dict[str, Any]] = []
        if not recent_resp.data:
            return events

        # Cache averages to avoid N+1 queries for the same user
        avg_cache: dict[str, float] = {}

        for txn in recent_resp.data:
            uid = txn.get("user_id")
            amount = txn.get("amount")
            if not uid or amount is None:
                continue

            if uid not in avg_cache:
                avg_resp = (
                    self.db.table("transactions")
                    .select("amount")
                    .eq("user_id", uid)
                    .gte("created_at", history_start)
                    .lt("created_at", window_start)
                    .execute()
                )
                amounts = [r["amount"] for r in (avg_resp.data or []) if r.get("amount") is not None]
                avg_cache[uid] = sum(amounts) / len(amounts) if amounts else 0.0

            avg = avg_cache[uid]
            if avg > 0 and float(amount) > avg * TRANSACTION_SPIKE_MULTIPLIER:
                events.append(
                    _build_event(
                        threat_type="transaction_spike",
                        threat_level="high",
                        description=(
                            f"Transaction of GHS {amount:.2f} by user {uid} is "
                            f"{float(amount)/avg:.1f}× their 30-day average of GHS {avg:.2f}."
                        ),
                        metadata={
                            "transaction_id": txn.get("id"),
                            "amount": float(amount),
                            "user_average_30d": round(avg, 2),
                            "multiplier": round(float(amount) / avg, 2),
                        },
                        user_id=uid,
                    )
                )
                logger.warning(
                    "Transaction spike for user %s: GHS %.2f vs avg GHS %.2f",
                    uid, amount, avg,
                )

        return events

    # ── 4. unusual hours ──────────────────────────────────────────────────────

    def check_unusual_hours(self) -> list[dict[str, Any]]:
        """Transactions between 01:00–04:00 Ghana time (UTC+0 / WAT)."""
        window_start = _iso(_now_utc() - timedelta(minutes=FAILED_LOGIN_WINDOW_MINUTES))

        resp = (
            self.db.table("transactions")
            .select("id, user_id, amount, created_at")
            .gte("created_at", window_start)
            .execute()
        )

        events: list[dict[str, Any]] = []
        if not resp.data:
            return events

        for txn in resp.data:
            created_raw = txn.get("created_at")
            if not created_raw:
                continue
            try:
                # Parse ISO timestamp; Ghana is UTC+0 (WAT = GMT)
                dt = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                hour = dt.hour
            except (ValueError, AttributeError):
                continue

            if UNUSUAL_HOURS_START <= hour < UNUSUAL_HOURS_END:
                events.append(
                    _build_event(
                        threat_type="unusual_hours_transaction",
                        threat_level="medium",
                        description=(
                            f"Transaction of GHS {txn.get('amount')} by user {txn.get('user_id')} "
                            f"at {hour:02d}:00 (unusual hours {UNUSUAL_HOURS_START}–{UNUSUAL_HOURS_END})."
                        ),
                        metadata={
                            "transaction_id": txn.get("id"),
                            "amount": txn.get("amount"),
                            "hour_utc": hour,
                        },
                        user_id=txn.get("user_id"),
                    )
                )

        return events

    # ── 5. multiple new accounts from same IP ─────────────────────────────────

    def check_mass_account_creation(self) -> list[dict[str, Any]]:
        """Multiple new accounts created from the same IP within 24 hours."""
        window_start = _iso(_now_utc() - timedelta(hours=MULTI_ACCOUNT_WINDOW_HOURS))

        resp = (
            self.db.table("audit_logs")
            .select("source_ip, user_id, created_at")
            .eq("action", "account_created")
            .gte("created_at", window_start)
            .execute()
        )

        events: list[dict[str, Any]] = []
        if not resp.data:
            return events

        by_ip: dict[str, list[dict]] = defaultdict(list)
        for row in resp.data:
            ip = row.get("source_ip")
            if ip:
                by_ip[ip].append(row)

        for ip, creations in by_ip.items():
            if len(creations) >= MULTI_ACCOUNT_THRESHOLD:
                user_ids = [r.get("user_id") for r in creations]
                events.append(
                    _build_event(
                        threat_type="mass_account_creation",
                        threat_level="medium",
                        description=(
                            f"{len(creations)} new accounts created from IP {ip} "
                            f"in the last {MULTI_ACCOUNT_WINDOW_HOURS}h."
                        ),
                        metadata={
                            "account_count": len(creations),
                            "user_ids": user_ids,
                            "window_hours": MULTI_ACCOUNT_WINDOW_HOURS,
                        },
                        source_ip=ip,
                    )
                )
                logger.warning("Mass account creation from IP %s (%d accounts)", ip, len(creations))

        return events

    # ── 6. insert helpers ─────────────────────────────────────────────────────

    def _dedup_events(self, events: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Skip inserting if an identical open event (same type + same IP/user)
        was already created within the last 10 minutes to avoid alert storms.
        """
        if not events:
            return events

        dedup_window = _iso(_now_utc() - timedelta(minutes=10))
        unique: list[dict[str, Any]] = []

        for ev in events:
            check = (
                self.db.table("security_events")
                .select("id")
                .eq("event_type", ev["event_type"])
                .eq("status", "open")
                .gte("detected_at", dedup_window)
            )
            if ev.get("source_ip"):
                check = check.eq("source_ip", ev["source_ip"])
            if ev.get("user_id"):
                check = check.eq("user_id", ev["user_id"])

            existing = check.limit(1).execute()
            if not existing.data:
                unique.append(ev)

        return unique

    def _insert_events(self, events: list[dict[str, Any]]) -> int:
        """Insert deduplicated events and return count inserted."""
        to_insert = self._dedup_events(events)
        if not to_insert:
            return 0

        resp = self.db.table("security_events").insert(to_insert).execute()
        count = len(resp.data) if resp.data else 0
        if count:
            logger.info("Inserted %d new threat event(s) into security_events.", count)
        return count

    # ── public entry point ────────────────────────────────────────────────────

    def run_all(self) -> int:
        """Run all threat checks and persist findings. Returns count inserted."""
        all_events: list[dict[str, Any]] = []

        checks = [
            ("failed_logins", self.check_failed_logins),
            ("new_country_logins", self.check_new_country_logins),
            ("transaction_spikes", self.check_transaction_spikes),
            ("unusual_hours", self.check_unusual_hours),
            ("mass_account_creation", self.check_mass_account_creation),
        ]

        for name, fn in checks:
            try:
                found = fn()
                if found:
                    logger.info("Check '%s' found %d event(s).", name, len(found))
                all_events.extend(found)
            except Exception as exc:  # noqa: BLE001
                logger.error("Threat check '%s' failed: %s", name, exc, exc_info=True)

        return self._insert_events(all_events)
