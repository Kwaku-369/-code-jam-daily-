"""
Strangler Fig Pattern — Legacy System Migration
-------------------------------------------------
Pattern: Incrementally migrate a legacy monolith to microservices by
         routing traffic through a facade. New services intercept
         specific endpoints; legacy handles the rest. Gradually squeeze
         out legacy until it's fully replaced.
Source:  Martin Fowler 2004; Azure Architecture Center; AWS Prescriptive Guidance
Sector:  Enterprise modernization, fintech core-banking migration,
         e-commerce platform re-architecture.

Migration stages:
  1. Install facade (API Gateway) in front of legacy — zero code change
  2. Build new service for ONE bounded context
  3. Route that context's traffic to new service
  4. Monitor, stabilize, then move to next context
  5. Repeat until legacy is fully replaced

Critical rule: New and legacy MUST NOT share the same database.
               Use event sync / dual writes during transition.

Tradeoffs:
  + Zero-downtime migration — system stays live throughout
  + Reversible — reroute back to legacy on failure
  + Incremental — each migration is a small, safe step
  - Facade adds latency + complexity
  - Dual writes / event sync needed for data consistency during transition
  - Long migrations (months/years) → technical debt accumulates
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable


# ---- Request / Response primitives ---------------------------------------

@dataclass
class Request:
    method: str
    path:   str
    body:   dict = field(default_factory=dict)
    headers: dict = field(default_factory=dict)


@dataclass
class Response:
    status:  int
    body:    dict = field(default_factory=dict)
    source:  str = ""     # "legacy" | "new_service" (for observability)


# ---- Legacy Monolith (stub) -----------------------------------------------

class LegacyMonolith:
    def handle(self, request: Request) -> Response:
        print(f"  [Legacy] Handling {request.method} {request.path}")
        return Response(
            status=200,
            body={"handler": "legacy", "path": request.path},
            source="legacy",
        )


# ---- New Microservices ----------------------------------------------------

class OrdersServiceV2:
    def handle(self, request: Request) -> Response:
        if request.method == "POST" and request.path == "/orders":
            print(f"  [OrdersV2] Creating order: {request.body}")
            return Response(201, {"order_id": "NEW-001", "status": "created"}, source="orders_v2")
        if request.method == "GET" and "/orders/" in request.path:
            order_id = request.path.split("/")[-1]
            return Response(200, {"order_id": order_id, "status": "shipped"}, source="orders_v2")
        return Response(404, {"error": "Not found"}, source="orders_v2")


class PaymentsServiceV2:
    def handle(self, request: Request) -> Response:
        if request.method == "POST" and request.path == "/payments":
            print(f"  [PaymentsV2] Processing payment: {request.body}")
            return Response(200, {"payment_id": "PAY-001", "status": "charged"}, source="payments_v2")
        return Response(404, {"error": "Not found"}, source="payments_v2")


# ---- Route Table (defines which contexts live in new services) ------------

@dataclass
class RouteRule:
    method:  str | None   # None = match any method
    path_prefix: str
    handler: Callable[[Request], Response]
    traffic_percent: int = 100  # Canary support: 0-100


# ---- Strangler Facade (API Gateway) ----------------------------------------

@dataclass
class StranglerFacade:
    """
    Routes traffic: new service routes take priority over legacy.
    Supports canary releases via traffic_percent.
    """
    legacy: LegacyMonolith
    routes: list[RouteRule] = field(default_factory=list)
    _migration_log: list[dict] = field(default_factory=list)

    def add_route(self, rule: RouteRule):
        self.routes.append(rule)
        print(f"  [Facade] Registered route: {rule.method or '*'} {rule.path_prefix} "
              f"→ {rule.handler.__self__.__class__.__name__} ({rule.traffic_percent}%)")

    def _should_route_new(self, rule: RouteRule) -> bool:
        """Canary: roll dice to decide if this request goes to new service."""
        import random
        return random.randint(1, 100) <= rule.traffic_percent

    def handle(self, request: Request) -> Response:
        for rule in self.routes:
            method_match = rule.method is None or rule.method == request.method
            path_match   = request.path.startswith(rule.path_prefix)
            if method_match and path_match and self._should_route_new(rule):
                response = rule.handler(request)
                self._migration_log.append({
                    "path": request.path, "routed_to": "new",
                    "service": response.source,
                })
                return response

        # Fall through to legacy
        response = self.legacy.handle(request)
        self._migration_log.append({"path": request.path, "routed_to": "legacy"})
        return response

    def migration_stats(self) -> dict:
        total = len(self._migration_log)
        new   = sum(1 for r in self._migration_log if r["routed_to"] == "new")
        return {
            "total_requests": total,
            "new_service_pct": round(new / total * 100, 1) if total else 0,
            "legacy_pct": round((total - new) / total * 100, 1) if total else 0,
        }


# ---- Data Sync — Dual Write (during transition) ---------------------------

class DualWriteAdapter:
    """
    During migration: write to BOTH legacy DB and new DB.
    New service reads from new DB; legacy reads from legacy DB.
    Remove this once legacy is fully decommissioned.
    """
    def __init__(self, legacy_repo, new_repo):
        self.legacy = legacy_repo
        self.new    = new_repo

    def save_order(self, order: dict):
        # Write to both (eventual consistency)
        self.legacy.save(order)
        self.new.save(order)
        print(f"  [DualWrite] Saved to both legacy + new: {order.get('id')}")


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    legacy   = LegacyMonolith()
    orders   = OrdersServiceV2()
    payments = PaymentsServiceV2()

    facade = StranglerFacade(legacy=legacy)

    print("=== Migration Stage 1: Route /orders to new service ===")
    facade.add_route(RouteRule(method="POST", path_prefix="/orders", handler=orders.handle, traffic_percent=100))
    facade.add_route(RouteRule(method="GET",  path_prefix="/orders", handler=orders.handle, traffic_percent=100))

    print("\n=== Migration Stage 2: Canary /payments (50% traffic) ===")
    facade.add_route(RouteRule(method="POST", path_prefix="/payments", handler=payments.handle, traffic_percent=50))

    print("\n=== Sending requests ===")
    requests = [
        Request("POST", "/orders",          {"item": "laptop", "qty": 1}),
        Request("GET",  "/orders/ORD-123",  {}),
        Request("POST", "/payments",         {"amount": 99.0}),
        Request("POST", "/payments",         {"amount": 49.0}),
        Request("GET",  "/customers/C-001",  {}),  # Not migrated yet → legacy
        Request("POST", "/invoices",         {}),  # Not migrated yet → legacy
    ]

    for req in requests:
        resp = facade.handle(req)
        print(f"    {req.method} {req.path} → {resp.status} [{resp.source}]")

    print("\n=== Migration Stats ===")
    stats = facade.migration_stats()
    for k, v in stats.items():
        print(f"  {k}: {v}")
