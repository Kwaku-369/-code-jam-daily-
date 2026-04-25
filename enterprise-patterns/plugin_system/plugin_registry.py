"""
Plugin Registry — Discovery, Registration, Lifecycle, Middleware
-----------------------------------------------------------------
Features:
  - Manual registration
  - Auto-discovery from a directory (loads .py files, finds Plugin subclasses)
  - Lifecycle management: initialize → execute → shutdown
  - Middleware hooks: before/after execute
  - Health monitoring
  - Tag-based search
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable, Type
from importlib import import_module
import importlib.util
import os
import sys

from .plugin_interface import Plugin, PluginMetadata


# ---- Middleware hook type -------------------------------------------------

Hook = Callable[[dict, dict | None], dict | None]


# ---- Plugin Registry -------------------------------------------------------

@dataclass
class PluginRegistry:
    _plugins:      dict[str, Plugin] = field(default_factory=dict)
    _before_hooks: list[Hook]        = field(default_factory=list)
    _after_hooks:  list[Hook]        = field(default_factory=list)
    _configs:      dict[str, dict]   = field(default_factory=dict)

    # ---- Registration ----

    def register(self, plugin_class: Type[Plugin], config: dict | None = None) -> Plugin:
        instance = plugin_class()
        name     = instance.metadata.name
        cfg      = {**(self._configs.get(name) or {}), **(config or {})}
        instance.initialize(cfg)
        self._plugins[name] = instance
        print(f"  [Registry] Registered: {name} v{instance.metadata.version}")
        return instance

    def unregister(self, name: str):
        plugin = self._plugins.pop(name, None)
        if plugin:
            plugin.shutdown()
            print(f"  [Registry] Unregistered: {name}")

    def set_config(self, plugin_name: str, config: dict):
        """Pre-configure a plugin before registration."""
        self._configs[plugin_name] = config

    # ---- Auto-discovery ----

    def discover(self, directory: str):
        """
        Scan a directory for Python files, import them, and auto-register
        any concrete Plugin subclasses found inside.
        """
        if not os.path.isdir(directory):
            print(f"  [Discovery] Directory not found: {directory}")
            return

        for filename in os.listdir(directory):
            if not filename.endswith(".py") or filename.startswith("_"):
                continue

            filepath = os.path.join(directory, filename)
            module_name = f"_discovered_{filename[:-3]}"

            spec   = importlib.util.spec_from_file_location(module_name, filepath)
            module = importlib.util.module_from_spec(spec)
            sys.modules[module_name] = module
            spec.loader.exec_module(module)

            for attr_name in dir(module):
                attr = getattr(module, attr_name)
                if (isinstance(attr, type) and
                        issubclass(attr, Plugin) and
                        attr is not Plugin and
                        not getattr(attr, "__abstractmethods__", None)):
                    self.register(attr)

    # ---- Middleware ----

    def add_before_hook(self, hook: Hook):
        self._before_hooks.append(hook)

    def add_after_hook(self, hook: Hook):
        self._after_hooks.append(hook)

    # ---- Execution ----

    def execute(self, plugin_name: str, data: dict) -> dict:
        plugin = self._plugins.get(plugin_name)
        if plugin is None:
            raise PluginNotFoundError(f"Plugin '{plugin_name}' not registered")

        if not plugin.health_check():
            raise PluginUnhealthyError(f"Plugin '{plugin_name}' failed health check")

        # Before hooks
        ctx = {"plugin": plugin_name, "data": data}
        for hook in self._before_hooks:
            result = hook(ctx, None)
            if result:
                ctx = result

        # Execute
        output = plugin.execute(ctx.get("data", data))

        # After hooks
        for hook in self._after_hooks:
            result = hook(ctx, output)
            if result:
                output = result

        return output

    def execute_all(self, data: dict) -> dict[str, dict]:
        return {name: self.execute(name, data) for name in self._plugins}

    # ---- Query ----

    def find_by_tag(self, tag: str) -> list[Plugin]:
        return [p for p in self._plugins.values() if p.metadata.matches(tag)]

    def list_plugins(self) -> list[PluginMetadata]:
        return [p.metadata for p in self._plugins.values()]

    def health_report(self) -> dict[str, bool]:
        return {name: p.health_check() for name, p in self._plugins.items()}

    def shutdown_all(self):
        for plugin in self._plugins.values():
            plugin.shutdown()
        self._plugins.clear()


class PluginNotFoundError(Exception):
    pass

class PluginUnhealthyError(Exception):
    pass


# ---- Middleware helpers ---------------------------------------------------

def logging_hook(ctx: dict, output: dict | None) -> None:
    if output is None:
        print(f"  [Hook/Before] Plugin={ctx['plugin']} input_keys={list(ctx['data'].keys())}")
    else:
        print(f"  [Hook/After]  Plugin={ctx['plugin']} output_keys={list(output.keys())}")


def validation_hook(ctx: dict, output: dict | None) -> dict | None:
    if output is None and not ctx.get("data"):
        raise ValueError(f"Empty data passed to plugin '{ctx['plugin']}'")
    return None
