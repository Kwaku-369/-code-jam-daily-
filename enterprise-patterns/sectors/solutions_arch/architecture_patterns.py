"""
Solutions Architecture Patterns
----------------------------------
Patterns for designing large-scale, production-grade systems.
Focus: system design, API gateway, multi-tenancy, observability, caching.

Covered:
  1. API Gateway               — routing, auth, rate-limiting facade
  2. Multi-Tenant Isolation    — tenant-aware data segregation strategies
  3. Cache-Aside Pattern       — lazy cache population
  4. Write-Through Cache       — synchronous cache updates
  5. Observability: Metrics    — RED method (Rate, Errors, Duration)
  6. Feature Flags             — runtime feature toggles

Sector:  Solutions architecture, cloud design, platform teams.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Callable
from enum import Enum
import threading
import time
import uuid


# ---- 1. API Gateway -------------------------------------------------------

@dataclass
class APIRequest:
    method:    str
    path:      str
    headers:   dict = field(default_factory=dict)
    body:      dict = field(default_factory=dict)
    tenant_id: str  = ""
    request_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])


@dataclass
class APIResponse:
    status: int
    body:   dict = field(default_factory=dict)
    headers: dict = field(default_factory=dict)


Middleware = Callable[[APIRequest], APIRequest | None]
Handler    = Callable[[APIRequest], APIResponse]


@dataclass
class APIGateway:
    """
    Chain-of-responsibility API gateway.
    Middleware: auth → rate-limit → transform → route → handler
    """
    _routes:     dict[str, Handler]    = field(default_factory=dict)
    _middleware: list[Middleware]      = field(default_factory=list)
    _metrics:    "MetricsCollector | None" = None

    def use(self, middleware: Middleware):
        self._middleware.append(middleware)

    def route(self, path: str, handler: Handler):
        self._routes[path] = handler

    def handle(self, request: APIRequest) -> APIResponse:
        start = time.monotonic()

        # Run middleware chain
        for mw in self._middleware:
            result = mw(request)
            if isinstance(result, APIResponse):
                return result
            if result is not None:
                request = result

        # Route
        handler = self._routes.get(request.path)
        if handler is None:
            resp = APIResponse(404, {"error": f"No route: {request.method} {request.path}"})
        else:
            try:
                resp = handler(request)
            except Exception as exc:
                resp = APIResponse(500, {"error": str(exc)})

        duration_ms = (time.monotonic() - start) * 1000
        if self._metrics:
            self._metrics.record(request.path, resp.status, duration_ms)

        return resp


def bearer_auth_middleware(valid_tokens: set) -> Middleware:
    def mw(req: APIRequest):
        token = req.headers.get("Authorization", "").removeprefix("Bearer ").strip()
        if token not in valid_tokens:
            return APIResponse(401, {"error": "Unauthorized"})
        return req
    return mw


def request_id_middleware(req: APIRequest) -> APIRequest:
    req.headers["X-Request-Id"] = req.request_id
    return req


# ---- 2. Multi-Tenant Isolation --------------------------------------------

class TenantIsolationStrategy(str, Enum):
    SHARED_DB    = "shared_db"        # All tenants in one DB, tenant_id column
    SCHEMA_PER   = "schema_per"       # Separate schema per tenant
    DB_PER       = "db_per"           # Separate database per tenant (highest isolation)


@dataclass
class TenantContext:
    tenant_id:   str
    plan:        str   = "free"       # free | pro | enterprise
    data_region: str   = "us-east-1"


class TenantRouter:
    """
    Routes operations to the correct tenant-specific resource.
    Shared DB: appends tenant_id to all queries.
    DB-per-tenant: returns the tenant's own connection.
    """
    def __init__(self, strategy: TenantIsolationStrategy):
        self.strategy = strategy
        self._tenant_dbs: dict[str, str] = {}  # tenant_id → connection_string

    def register_tenant(self, tenant: TenantContext, connection: str = ""):
        if self.strategy == TenantIsolationStrategy.DB_PER:
            self._tenant_dbs[tenant.tenant_id] = connection or f"db://{tenant.tenant_id}"

    def get_connection(self, tenant_id: str) -> str:
        if self.strategy == TenantIsolationStrategy.DB_PER:
            conn = self._tenant_dbs.get(tenant_id)
            if not conn:
                raise ValueError(f"No database registered for tenant {tenant_id}")
            return conn
        return "shared_db"   # Same DB for all tenants

    def scope_query(self, query: str, tenant_id: str) -> str:
        """For SHARED_DB: add tenant_id filter to prevent data leakage."""
        if self.strategy == TenantIsolationStrategy.SHARED_DB:
            return f"{query} AND tenant_id = '{tenant_id}'"
        return query


# ---- 3 & 4. Cache-Aside + Write-Through Cache ------------------------------

@dataclass
class CacheEntry:
    value:      Any
    expires_at: datetime


class Cache:
    def __init__(self, default_ttl_sec: float = 300):
        self.default_ttl_sec = default_ttl_sec
        self._store: dict[str, CacheEntry] = {}
        self._lock  = threading.Lock()
        self.hits   = 0
        self.misses = 0

    def get(self, key: str) -> tuple[bool, Any]:
        with self._lock:
            entry = self._store.get(key)
            if entry and entry.expires_at > datetime.utcnow():
                self.hits += 1
                return True, entry.value
            if key in self._store:
                del self._store[key]
            self.misses += 1
            return False, None

    def set(self, key: str, value: Any, ttl_sec: float | None = None):
        ttl = ttl_sec if ttl_sec is not None else self.default_ttl_sec
        with self._lock:
            self._store[key] = CacheEntry(value, datetime.utcnow() + timedelta(seconds=ttl))

    def invalidate(self, key: str):
        self._store.pop(key, None)

    @property
    def hit_rate(self) -> float:
        total = self.hits + self.misses
        return self.hits / total if total else 0.0


class CacheAsideRepository:
    """
    Cache-Aside (Lazy Loading): read cache first → miss → load from DB → populate cache.
    Best for read-heavy workloads with infrequent updates.
    """
    def __init__(self, cache: Cache, db_fn: Callable[[str], Any]):
        self.cache = cache
        self._db   = db_fn

    def find(self, key: str) -> Any:
        hit, value = self.cache.get(key)
        if hit:
            print(f"  [Cache] HIT: {key}")
            return value
        print(f"  [Cache] MISS: {key} — loading from DB")
        value = self._db(key)
        if value is not None:
            self.cache.set(key, value)
        return value

    def update(self, key: str, value: Any):
        self._db_write(key, value)
        self.cache.invalidate(key)   # Invalidate on write

    def _db_write(self, key: str, value: Any):
        print(f"  [DB] Write: {key}")


class WriteThroughRepository:
    """
    Write-Through: write to cache AND DB synchronously.
    Best for write-heavy workloads where fresh reads are critical.
    """
    def __init__(self, cache: Cache, db_fn: Callable[[str], Any]):
        self.cache = cache
        self._db   = db_fn

    def find(self, key: str) -> Any:
        hit, value = self.cache.get(key)
        return value if hit else self._db(key)

    def save(self, key: str, value: Any, ttl: float = 300):
        self.cache.set(key, value, ttl_sec=ttl)   # Write cache first
        self._db(key)                              # Then write DB


# ---- 5. Observability — RED Metrics (Rate, Errors, Duration) ---------------

@dataclass
class MetricsCollector:
    """
    RED method: Rate, Errors, Duration per endpoint.
    In production: integrate with Prometheus / Datadog / CloudWatch.
    """
    _data: dict[str, list] = field(default_factory=dict)

    def record(self, endpoint: str, status_code: int, duration_ms: float):
        self._data.setdefault(endpoint, []).append({
            "status": status_code,
            "duration_ms": duration_ms,
            "is_error": status_code >= 400,
            "ts": datetime.utcnow(),
        })

    def report(self, endpoint: str, window_sec: int = 60) -> dict:
        cutoff  = datetime.utcnow() - timedelta(seconds=window_sec)
        records = [r for r in self._data.get(endpoint, []) if r["ts"] >= cutoff]
        if not records:
            return {"endpoint": endpoint, "rate": 0, "error_rate": 0, "p99_ms": 0}
        total    = len(records)
        errors   = sum(1 for r in records if r["is_error"])
        durations = sorted(r["duration_ms"] for r in records)
        p99_idx  = max(0, int(len(durations) * 0.99) - 1)
        return {
            "endpoint":   endpoint,
            "rate_rps":   round(total / window_sec, 2),
            "error_rate": round(errors / total, 4),
            "p50_ms":     durations[len(durations) // 2],
            "p99_ms":     durations[p99_idx],
        }


# ---- 6. Feature Flags -------------------------------------------------------

@dataclass
class FeatureFlagService:
    """
    Runtime feature toggles — no redeploy needed.
    Supports: global on/off, percentage rollout, tenant allowlist.
    In production: back with LaunchDarkly / Unleash / GrowthBook.
    """
    _flags: dict[str, dict] = field(default_factory=dict)

    def define(self, name: str, enabled: bool = False,
               rollout_pct: float = 0.0, allowlist: set | None = None):
        self._flags[name] = {
            "enabled":     enabled,
            "rollout_pct": rollout_pct,
            "allowlist":   allowlist or set(),
        }

    def is_enabled(self, name: str, user_id: str = "") -> bool:
        flag = self._flags.get(name)
        if not flag:
            return False
        if user_id in flag["allowlist"]:
            return True
        if flag["enabled"]:
            return True
        if flag["rollout_pct"] > 0 and user_id:
            # Deterministic hash-based rollout
            bucket = hash(f"{name}:{user_id}") % 100
            return bucket < flag["rollout_pct"] * 100
        return False

    def enable(self, name: str):
        if name in self._flags:
            self._flags[name]["enabled"] = True

    def disable(self, name: str):
        if name in self._flags:
            self._flags[name]["enabled"] = False


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== API Gateway ===")
    metrics = MetricsCollector()
    gw = APIGateway(_metrics=metrics)
    gw.use(request_id_middleware)
    gw.use(bearer_auth_middleware(valid_tokens={"secret-token"}))
    gw.route("/orders", lambda req: APIResponse(200, {"orders": []}))
    gw.route("/health", lambda req: APIResponse(200, {"status": "ok"}))

    r1 = gw.handle(APIRequest("GET", "/orders", headers={"Authorization": "Bearer secret-token"}))
    r2 = gw.handle(APIRequest("GET", "/orders", headers={}))
    r3 = gw.handle(APIRequest("GET", "/unknown", headers={"Authorization": "Bearer secret-token"}))
    print(f"  Auth OK:    {r1.status}")
    print(f"  No Auth:    {r2.status}")
    print(f"  Not Found:  {r3.status}")

    print("\n=== Cache-Aside ===")
    cache = Cache(default_ttl_sec=10)
    fake_db = {"user:1": {"name": "Alice"}, "user:2": {"name": "Bob"}}
    repo = CacheAsideRepository(cache, lambda k: fake_db.get(k))
    repo.find("user:1")
    repo.find("user:1")   # Cache hit
    print(f"  Hit rate: {cache.hit_rate:.0%}")

    print("\n=== Feature Flags ===")
    flags = FeatureFlagService()
    flags.define("new_checkout", enabled=False, rollout_pct=0.5, allowlist={"alice"})
    print(f"  alice: {flags.is_enabled('new_checkout', 'alice')}")
    print(f"  bob:   {flags.is_enabled('new_checkout', 'bob')}")
    flags.enable("new_checkout")
    print(f"  bob (global on): {flags.is_enabled('new_checkout', 'bob')}")
