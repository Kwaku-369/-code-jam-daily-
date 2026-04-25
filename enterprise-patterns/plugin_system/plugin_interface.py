"""
Plugin System — Interface Contracts
-------------------------------------
Pattern: Define a stable contract (ABC) that all plugins must implement.
         Core system depends on the interface, not concrete plugins.
         Plugins are discovered, registered, and composed at runtime.
Source:  Python plugin patterns; VS Code extension model; LangChain tools
Sector:  Platforms, IDEs, analytics engines, AI agent frameworks.

Design principles:
  - Open/Closed: core is closed for modification, open for extension
  - Dependency Inversion: core depends on abstraction (Plugin), not concretions
  - Liskov Substitution: any plugin can replace another with same interface
"""

from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any
import re


# ---- Plugin metadata -------------------------------------------------------

@dataclass(frozen=True)
class PluginMetadata:
    name:        str
    version:     str
    description: str
    author:      str   = ""
    tags:        tuple = ()

    def matches(self, query: str) -> bool:
        q = query.lower()
        return (
            q in self.name.lower() or
            q in self.description.lower() or
            any(q in t.lower() for t in self.tags)
        )


# ---- Base Plugin contract --------------------------------------------------

class Plugin(ABC):
    """All plugins must implement this interface."""

    @property
    @abstractmethod
    def metadata(self) -> PluginMetadata: ...

    @abstractmethod
    def initialize(self, config: dict[str, Any]) -> None:
        """Called once when the plugin is registered."""
        ...

    @abstractmethod
    def execute(self, data: dict[str, Any]) -> dict[str, Any]:
        """Main entrypoint — receives input, returns output."""
        ...

    def shutdown(self) -> None:
        """Optional cleanup on unload."""
        pass

    def health_check(self) -> bool:
        """Returns True if plugin is healthy."""
        return True


# ---- Specialized plugin types (extend as needed) -------------------------

class TransformPlugin(Plugin, ABC):
    """Plugin that transforms data (ETL, preprocessing)."""
    @abstractmethod
    def transform(self, data: Any) -> Any: ...

    def execute(self, data: dict) -> dict:
        return {"result": self.transform(data.get("input"))}


class NotificationPlugin(Plugin, ABC):
    """Plugin that sends notifications."""
    @abstractmethod
    def notify(self, message: str, channel: str = "default") -> bool: ...

    def execute(self, data: dict) -> dict:
        success = self.notify(data.get("message", ""), data.get("channel", "default"))
        return {"sent": success}


class StoragePlugin(Plugin, ABC):
    """Plugin that reads/writes persistent data."""
    @abstractmethod
    def read(self, key: str) -> Any: ...
    @abstractmethod
    def write(self, key: str, value: Any) -> bool: ...

    def execute(self, data: dict) -> dict:
        op = data.get("op", "read")
        if op == "write":
            return {"ok": self.write(data["key"], data["value"])}
        return {"value": self.read(data["key"])}


class AIPlugin(Plugin, ABC):
    """Plugin that wraps an AI model or pipeline."""
    @abstractmethod
    def infer(self, prompt: str) -> str: ...

    def execute(self, data: dict) -> dict:
        return {"response": self.infer(data.get("prompt", ""))}
