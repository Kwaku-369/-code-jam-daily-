"""
Example Plugins — Notification Suite
--------------------------------------
Three concrete plugin implementations of NotificationPlugin:
  - SlackPlugin
  - EmailPlugin
  - PagerDutyPlugin (critical alerts)
"""

from __future__ import annotations
from typing import Any

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from plugin_interface import NotificationPlugin, PluginMetadata


class SlackPlugin(NotificationPlugin):
    _webhook: str = ""

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="slack",
            version="1.0.0",
            description="Send messages to Slack channels via webhook",
            author="platform-team",
            tags=("notification", "slack", "messaging"),
        )

    def initialize(self, config: dict[str, Any]) -> None:
        self._webhook = config.get("webhook_url", "https://hooks.slack.com/stub")
        print(f"    [Slack] Initialized with webhook: {self._webhook[:40]}...")

    def notify(self, message: str, channel: str = "#general") -> bool:
        print(f"    [Slack → {channel}] {message[:80]}")
        return True   # stub: would POST to self._webhook


class EmailPlugin(NotificationPlugin):
    _smtp_host: str  = ""
    _from_addr: str  = ""

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="email",
            version="2.1.0",
            description="Send email notifications via SMTP",
            author="platform-team",
            tags=("notification", "email", "smtp"),
        )

    def initialize(self, config: dict[str, Any]) -> None:
        self._smtp_host = config.get("smtp_host", "smtp.localhost")
        self._from_addr = config.get("from", "noreply@example.com")

    def notify(self, message: str, channel: str = "ops@example.com") -> bool:
        print(f"    [Email → {channel}] FROM={self._from_addr} | {message[:60]}")
        return True


class PagerDutyPlugin(NotificationPlugin):
    _api_key:     str = ""
    _service_key: str = ""

    @property
    def metadata(self) -> PluginMetadata:
        return PluginMetadata(
            name="pagerduty",
            version="1.0.0",
            description="Trigger PagerDuty incidents for critical alerts",
            author="platform-team",
            tags=("notification", "pagerduty", "incident", "oncall"),
        )

    def initialize(self, config: dict[str, Any]) -> None:
        self._api_key     = config.get("api_key", "stub-key")
        self._service_key = config.get("service_key", "stub-service")

    def notify(self, message: str, channel: str = "critical") -> bool:
        print(f"    [PagerDuty] INCIDENT TRIGGERED: {message[:80]}")
        return True

    def health_check(self) -> bool:
        return bool(self._api_key)
