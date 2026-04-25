"""
Infrastructure Engineering Patterns
--------------------------------------
Patterns for platform/infra engineers building reliable systems.

Covered:
  1. Health Check Endpoint     — liveness + readiness probes (Kubernetes)
  2. Rate Limiter               — token bucket algorithm
  3. Distributed Lock           — prevent concurrent writes (Redis-style)
  4. Service Registry           — dynamic service discovery
  5. Configuration Store        — hot-reload config without restart
  6. Structured Logger          — JSON logging for log aggregation

Sector:  Platform engineering, SRE, cloud infrastructure, DevOps.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable
import threading
import time
import uuid
import json


# ---- 1. Health Check -------------------------------------------------------

@dataclass
class HealthStatus:
    healthy:    bool
    status:     str             # "healthy" | "degraded" | "unhealthy"
    checks:     dict[str, bool] = field(default_factory=dict)
    timestamp:  str = field(default_factory=lambda: datetime.utcnow().isoformat())


class HealthChecker:
    """
    Liveness:  service is running (not deadlocked)
    Readiness: service can serve traffic (dependencies available)
    """
    def __init__(self):
        self._checks: dict[str, Callable[[], bool]] = {}

    def register(self, name: str, check_fn: Callable[[], bool]):
        self._checks[name] = check_fn

    def liveness(self) -> HealthStatus:
        return HealthStatus(healthy=True, status="healthy", checks={"process": True})

    def readiness(self) -> HealthStatus:
        results = {}
        for name, fn in self._checks.items():
            try:
                results[name] = fn()
            except Exception:
                results[name] = False

        all_healthy  = all(results.values())
        some_healthy = any(results.values())
        status = "healthy" if all_healthy else ("degraded" if some_healthy else "unhealthy")

        return HealthStatus(healthy=all_healthy, status=status, checks=results)


# ---- 2. Token Bucket Rate Limiter -----------------------------------------

@dataclass
class TokenBucket:
    """
    Token bucket: allows `capacity` requests per `refill_period` seconds.
    Supports bursting (up to `capacity` tokens in the bucket at once).
    """
    capacity:       int
    refill_rate:    float       # tokens per second
    _tokens:        float = field(init=False)
    _last_refill:   float = field(init=False)
    _lock:          threading.Lock = field(default_factory=threading.Lock, init=False)

    def __post_init__(self):
        self._tokens      = float(self.capacity)
        self._last_refill = time.monotonic()

    def _refill(self):
        now     = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens      = min(self.capacity, self._tokens + elapsed * self.refill_rate)
        self._last_refill = now

    def consume(self, tokens: int = 1) -> bool:
        with self._lock:
            self._refill()
            if self._tokens >= tokens:
                self._tokens -= tokens
                return True
            return False


class RateLimiter:
    """Per-key rate limiter (e.g., per IP, per user, per API key)."""
    def __init__(self, capacity: int = 100, refill_rate: float = 10.0):
        self.capacity    = capacity
        self.refill_rate = refill_rate
        self._buckets: dict[str, TokenBucket] = {}
        self._lock = threading.Lock()

    def allow(self, key: str, tokens: int = 1) -> bool:
        with self._lock:
            if key not in self._buckets:
                self._buckets[key] = TokenBucket(self.capacity, self.refill_rate)
        return self._buckets[key].consume(tokens)


# ---- 3. Distributed Lock (Redis-style) ------------------------------------

@dataclass
class LockRecord:
    key:        str
    token:      str
    expires_at: datetime


class InMemoryLockStore:
    """Simulates Redis SET NX PX semantics."""
    def __init__(self):
        self._locks: dict[str, LockRecord] = {}
        self._lock  = threading.Lock()

    def acquire(self, key: str, token: str, ttl_sec: float = 30.0) -> bool:
        with self._lock:
            existing = self._locks.get(key)
            if existing and existing.expires_at > datetime.utcnow():
                return False   # Lock held by someone else
            self._locks[key] = LockRecord(key, token, datetime.utcnow() + timedelta(seconds=ttl_sec))
            return True

    def release(self, key: str, token: str) -> bool:
        with self._lock:
            rec = self._locks.get(key)
            if rec and rec.token == token:
                del self._locks[key]
                return True
            return False   # Not owner — don't release


class DistributedLock:
    """
    Context manager for distributed locking.
    Usage:
        with DistributedLock(store, "order:123") as lock:
            ... # critical section
    """
    def __init__(self, store: InMemoryLockStore, key: str, ttl_sec: float = 30.0):
        self.store   = store
        self.key     = key
        self.ttl_sec = ttl_sec
        self.token   = str(uuid.uuid4())
        self._held   = False

    def __enter__(self):
        self._held = self.store.acquire(self.key, self.token, self.ttl_sec)
        if not self._held:
            raise LockAcquisitionError(f"Could not acquire lock on '{self.key}'")
        return self

    def __exit__(self, *_):
        if self._held:
            self.store.release(self.key, self.token)
            self._held = False


class LockAcquisitionError(Exception):
    pass


# ---- 4. Service Registry --------------------------------------------------

@dataclass
class ServiceInstance:
    service: str
    host:    str
    port:    int
    meta:    dict      = field(default_factory=dict)
    healthy: bool      = True
    registered_at: datetime = field(default_factory=datetime.utcnow)

    @property
    def address(self) -> str:
        return f"{self.host}:{self.port}"


@dataclass
class ServiceRegistry:
    """Client-side service discovery with round-robin load balancing."""
    _instances: dict[str, list[ServiceInstance]] = field(default_factory=dict)
    _counters:  dict[str, int]                   = field(default_factory=dict)

    def register(self, instance: ServiceInstance):
        self._instances.setdefault(instance.service, []).append(instance)
        print(f"  [Registry] Registered: {instance.service} @ {instance.address}")

    def deregister(self, service: str, host: str, port: int):
        self._instances[service] = [
            i for i in self._instances.get(service, [])
            if not (i.host == host and i.port == port)
        ]

    def get(self, service: str) -> ServiceInstance | None:
        healthy = [i for i in self._instances.get(service, []) if i.healthy]
        if not healthy:
            return None
        # Round-robin
        idx = self._counters.get(service, 0) % len(healthy)
        self._counters[service] = idx + 1
        return healthy[idx]

    def all(self, service: str) -> list[ServiceInstance]:
        return self._instances.get(service, [])


# ---- 5. Hot-Reload Config Store -------------------------------------------

class ConfigStore:
    """
    In-memory config with change listeners.
    In production: back with etcd / Consul / AWS Parameter Store + polling.
    """
    def __init__(self, initial: dict | None = None):
        self._config:    dict[str, Any]         = dict(initial or {})
        self._listeners: dict[str, list[Callable]] = {}
        self._lock = threading.RLock()

    def get(self, key: str, default: Any = None) -> Any:
        return self._config.get(key, default)

    def set(self, key: str, value: Any):
        with self._lock:
            old = self._config.get(key)
            self._config[key] = value
            if old != value:
                for fn in self._listeners.get(key, []):
                    fn(key, old, value)

    def on_change(self, key: str, callback: Callable):
        self._listeners.setdefault(key, []).append(callback)

    def load_dict(self, data: dict):
        for k, v in data.items():
            self.set(k, v)


# ---- 6. Structured Logger -------------------------------------------------

class StructuredLogger:
    """
    JSON-formatted logger for aggregation with ELK / Datadog / CloudWatch.
    Fields: timestamp, level, service, message, **context
    """
    LEVELS = {"DEBUG": 0, "INFO": 1, "WARN": 2, "ERROR": 3}

    def __init__(self, service: str, min_level: str = "INFO"):
        self.service   = service
        self.min_level = self.LEVELS.get(min_level, 1)

    def _log(self, level: str, message: str, **ctx):
        if self.LEVELS.get(level, 0) < self.min_level:
            return
        record = {
            "timestamp": datetime.utcnow().isoformat(),
            "level":     level,
            "service":   self.service,
            "message":   message,
            **ctx,
        }
        print(json.dumps(record))

    def debug(self, msg: str, **ctx):  self._log("DEBUG", msg, **ctx)
    def info(self,  msg: str, **ctx):  self._log("INFO",  msg, **ctx)
    def warn(self,  msg: str, **ctx):  self._log("WARN",  msg, **ctx)
    def error(self, msg: str, **ctx):  self._log("ERROR", msg, **ctx)


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== Health Check ===")
    health = HealthChecker()
    health.register("database", lambda: True)
    health.register("redis",    lambda: True)
    health.register("kafka",    lambda: False)   # degraded
    r = health.readiness()
    print(f"  Status: {r.status} | checks: {r.checks}")

    print("\n=== Rate Limiter ===")
    limiter = RateLimiter(capacity=5, refill_rate=2.0)
    for i in range(7):
        allowed = limiter.allow("user-123")
        print(f"  Request {i+1}: {'OK' if allowed else 'RATE LIMITED'}")

    print("\n=== Distributed Lock ===")
    store = InMemoryLockStore()
    with DistributedLock(store, "payment:order-42") as lock:
        print("  Lock acquired — processing payment")
    print("  Lock released")

    print("\n=== Service Registry ===")
    registry = ServiceRegistry()
    registry.register(ServiceInstance("orders", "10.0.0.1", 8080))
    registry.register(ServiceInstance("orders", "10.0.0.2", 8080))
    for _ in range(4):
        inst = registry.get("orders")
        print(f"  Routed to: {inst.address}")

    print("\n=== Config Store ===")
    cfg = ConfigStore({"log_level": "INFO", "timeout_ms": 5000})
    cfg.on_change("timeout_ms", lambda k, old, new: print(f"  Config changed: {k}: {old} → {new}"))
    cfg.set("timeout_ms", 8000)

    print("\n=== Structured Logger ===")
    log = StructuredLogger("orders-service")
    log.info("Order placed", order_id="ORD-001", customer="alice", amount=99.0)
    log.error("Payment failed", order_id="ORD-002", error="Card declined", retry=True)
