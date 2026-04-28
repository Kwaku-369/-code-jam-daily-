"""
Duplicate Account Scanner — periodic fuzzy matching on the profiles table.

Uses rapidfuzz for name similarity and exact/normalised matching on
phone, email, and national ID to identify probable duplicate accounts.
Findings are written to the duplicate_flags table.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from itertools import combinations
from typing import Any

from rapidfuzz import fuzz
from supabase import Client

logger = logging.getLogger(__name__)

# ── thresholds ────────────────────────────────────────────────────────────────
NAME_SIMILARITY_THRESHOLD = 88      # rapidfuzz score 0–100
PHONE_MATCH = True                  # exact after normalisation
EMAIL_MATCH = True                  # exact after normalisation
ID_MATCH = True                     # exact national ID match

# A pair must hit at least this many signals to be flagged
MIN_SIGNALS_TO_FLAG = 1


# ── normalisation helpers ─────────────────────────────────────────────────────

def _normalise_phone(phone: str | None) -> str | None:
    if not phone:
        return None
    digits = re.sub(r"\D", "", phone)
    # Strip leading country code for Ghana (+233 / 233) → 0XXXXXXXXX
    if digits.startswith("233") and len(digits) == 12:
        digits = "0" + digits[3:]
    return digits or None


def _normalise_email(email: str | None) -> str | None:
    if not email:
        return None
    return email.strip().lower()


def _normalise_name(name: str | None) -> str | None:
    if not name:
        return None
    return " ".join(name.strip().lower().split())


# ── duplicate scanner class ───────────────────────────────────────────────────

class DuplicateScanner:
    """
    Pulls all profiles, computes pairwise similarity, and inserts findings
    into the duplicate_flags table.
    """

    def __init__(self, supabase: Client) -> None:
        self.db = supabase

    # ── data fetching ─────────────────────────────────────────────────────────

    def _fetch_profiles(self) -> list[dict[str, Any]]:
        resp = (
            self.db.table("profiles")
            .select("id, full_name, email, phone, national_id, created_at")
            .execute()
        )
        return resp.data or []

    def _existing_flags(self) -> set[frozenset[str]]:
        """Return set of already-flagged profile ID pairs."""
        resp = (
            self.db.table("duplicate_flags")
            .select("profile_id_a, profile_id_b")
            .execute()
        )
        pairs: set[frozenset[str]] = set()
        for row in resp.data or []:
            a, b = row.get("profile_id_a"), row.get("profile_id_b")
            if a and b:
                pairs.add(frozenset({a, b}))
        return pairs

    # ── comparison logic ──────────────────────────────────────────────────────

    def _compare_pair(
        self, a: dict[str, Any], b: dict[str, Any]
    ) -> dict[str, Any] | None:
        """
        Compare two profile records.  Returns a flag dict or None if below threshold.
        """
        signals: list[str] = []
        similarity_scores: dict[str, float] = {}

        # 1. Name fuzzy match
        name_a = _normalise_name(a.get("full_name"))
        name_b = _normalise_name(b.get("full_name"))
        if name_a and name_b:
            score = fuzz.token_sort_ratio(name_a, name_b)
            similarity_scores["name_similarity"] = score
            if score >= NAME_SIMILARITY_THRESHOLD:
                signals.append("name_match")

        # 2. Phone exact match (normalised)
        phone_a = _normalise_phone(a.get("phone"))
        phone_b = _normalise_phone(b.get("phone"))
        if phone_a and phone_b and phone_a == phone_b:
            signals.append("phone_match")
            similarity_scores["phone_match"] = 100.0

        # 3. Email exact match
        email_a = _normalise_email(a.get("email"))
        email_b = _normalise_email(b.get("email"))
        if email_a and email_b and email_a == email_b:
            signals.append("email_match")
            similarity_scores["email_match"] = 100.0

        # 4. National ID exact match
        nid_a = (a.get("national_id") or "").strip().upper()
        nid_b = (b.get("national_id") or "").strip().upper()
        if nid_a and nid_b and nid_a == nid_b:
            signals.append("national_id_match")
            similarity_scores["national_id_match"] = 100.0

        if len(signals) < MIN_SIGNALS_TO_FLAG:
            return None

        confidence = self._compute_confidence(signals, similarity_scores)
        return {
            "profile_id_a": a["id"],
            "profile_id_b": b["id"],
            "signals": signals,
            "similarity_scores": similarity_scores,
            "confidence": confidence,
            "threat_level": "high" if len(signals) >= 3 or "national_id_match" in signals else "medium",
            "status": "pending_review",
            "detected_at": datetime.now(timezone.utc).isoformat(),
        }

    @staticmethod
    def _compute_confidence(signals: list[str], scores: dict[str, float]) -> float:
        """
        Simple weighted confidence score 0–1.
        national_id + email are strong signals; name alone is weak.
        """
        weights = {
            "national_id_match": 0.45,
            "email_match": 0.30,
            "phone_match": 0.25,
            "name_match": 0.15,
        }
        total = sum(weights.get(s, 0.1) for s in signals)
        # Scale to max-possible weight for the given signals
        max_possible = sum(weights.values())
        return min(1.0, round(total / max_possible, 3))

    # ── main scan ─────────────────────────────────────────────────────────────

    def scan(self) -> int:
        """
        Full duplicate scan across all profiles.
        Returns the number of new duplicate_flags inserted.
        """
        logger.info("Starting duplicate account scan…")
        profiles = self._fetch_profiles()

        if len(profiles) < 2:
            logger.info("Fewer than 2 profiles — nothing to compare.")
            return 0

        existing_pairs = self._existing_flags()
        logger.info(
            "Comparing %d profiles (%d existing flags).",
            len(profiles),
            len(existing_pairs),
        )

        new_flags: list[dict[str, Any]] = []

        for a, b in combinations(profiles, 2):
            pair_key = frozenset({a["id"], b["id"]})
            if pair_key in existing_pairs:
                continue

            flag = self._compare_pair(a, b)
            if flag:
                new_flags.append(flag)
                existing_pairs.add(pair_key)  # avoid inserting twice in same run

        if not new_flags:
            logger.info("Duplicate scan complete — no new duplicates found.")
            return 0

        # Batch insert
        try:
            resp = self.db.table("duplicate_flags").insert(new_flags).execute()
            count = len(resp.data) if resp.data else 0
            logger.info("Duplicate scan inserted %d new flag(s).", count)

            # Mirror high-confidence flags into security_events for unified alerting
            critical_flags = [f for f in new_flags if f["confidence"] >= 0.7]
            if critical_flags:
                sec_events = [
                    {
                        "event_type": "duplicate_account_detected",
                        "threat_level": f["threat_level"],
                        "description": (
                            f"Probable duplicate accounts: {f['profile_id_a']} "
                            f"and {f['profile_id_b']}. "
                            f"Signals: {', '.join(f['signals'])}. "
                            f"Confidence: {f['confidence']:.0%}."
                        ),
                        "metadata": {
                            "profile_id_a": f["profile_id_a"],
                            "profile_id_b": f["profile_id_b"],
                            "signals": f["signals"],
                            "confidence": f["confidence"],
                        },
                        "detected_at": f["detected_at"],
                        "status": "open",
                    }
                    for f in critical_flags
                ]
                self.db.table("security_events").insert(sec_events).execute()
                logger.info(
                    "Mirrored %d high-confidence duplicate flag(s) to security_events.",
                    len(sec_events),
                )

            return count

        except Exception as exc:  # noqa: BLE001
            logger.error("Failed to insert duplicate flags: %s", exc, exc_info=True)
            return 0
