"""
Saga Pattern — Distributed Transactions
-----------------------------------------
Pattern: Manage long-running distributed transactions across microservices
         using a sequence of local transactions with compensating actions.
Source:  Garcia-Molina & Salem 1987; microservices.io/patterns/data/saga
Sector:  E-commerce order flows, fintech transfers, travel booking.

Two flavors:
  1. Choreography  — each service publishes events; others react (decoupled)
  2. Orchestration — a central Saga Orchestrator drives the workflow (auditable)

Steps vs. Compensations:
  Step T1: Create order       | Compensation C1: Cancel order
  Step T2: Reserve inventory  | Compensation C2: Release inventory
  Step T3: Charge payment     | Compensation C3: Refund payment
  Step T4: Ship order         | (terminal — no compensation needed)

If T3 fails → run C2, C1 in reverse order (backward recovery).

Tradeoffs:
  + Works without 2-phase commit (no distributed locks)
  + Each service is autonomous
  - Eventual consistency only — no isolation between saga steps
  - Compensations must be idempotent and always succeed
  - Choreography: hard to trace the overall flow
  - Orchestration: orchestrator is a potential SPOF
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable
from enum import Enum


class SagaStatus(str, Enum):
    RUNNING       = "running"
    COMPLETED     = "completed"
    COMPENSATING  = "compensating"
    FAILED        = "failed"


@dataclass
class SagaStep:
    name: str
    action:      Callable[["SagaContext"], None]     # forward transaction
    compensation: Callable[["SagaContext"], None]    # undo action


@dataclass
class SagaContext:
    saga_id:  str
    data:     dict = field(default_factory=dict)
    status:   SagaStatus = SagaStatus.RUNNING
    completed_steps: list[str] = field(default_factory=list)
    log:      list[str] = field(default_factory=list)

    def record(self, msg: str):
        self.log.append(msg)
        print(f"  [Saga/{self.saga_id}] {msg}")


# ---- 1. Orchestration Saga ------------------------------------------------

@dataclass
class OrchestratorSaga:
    """
    Central orchestrator drives all steps.
    Knows the full workflow — easy to debug and audit.
    """
    saga_id: str
    steps: list[SagaStep]

    def execute(self, initial_data: dict) -> SagaContext:
        ctx = SagaContext(saga_id=self.saga_id, data=initial_data)

        for step in self.steps:
            try:
                step.action(ctx)
                ctx.completed_steps.append(step.name)
                ctx.record(f"Step '{step.name}' completed")
            except Exception as exc:
                ctx.record(f"Step '{step.name}' FAILED: {exc} — starting compensation")
                ctx.status = SagaStatus.COMPENSATING
                self._compensate(ctx)
                ctx.status = SagaStatus.FAILED
                return ctx

        ctx.status = SagaStatus.COMPLETED
        ctx.record("Saga completed successfully")
        return ctx

    def _compensate(self, ctx: SagaContext):
        for step_name in reversed(ctx.completed_steps):
            step = next((s for s in self.steps if s.name == step_name), None)
            if step:
                try:
                    step.compensation(ctx)
                    ctx.record(f"Compensation for '{step_name}' applied")
                except Exception as exc:
                    ctx.record(f"Compensation for '{step_name}' FAILED: {exc} — manual intervention needed")


# ---- 2. Choreography Saga (event-driven) ----------------------------------

class EventBus:
    def __init__(self):
        self._handlers: dict[str, list[Callable]] = {}

    def subscribe(self, event: str, handler: Callable):
        self._handlers.setdefault(event, []).append(handler)

    def publish(self, event: str, data: dict):
        print(f"  [EventBus] Published: {event}")
        for handler in self._handlers.get(event, []):
            handler(data)


class OrderService:
    def __init__(self, bus: EventBus):
        self.bus = bus
        bus.subscribe("PaymentFailed",   self._on_payment_failed)
        bus.subscribe("ShipmentCreated", self._on_shipment_created)

    def create_order(self, data: dict) -> dict:
        order = {**data, "order_id": "ORD-001", "status": "pending"}
        print("  [OrderService] Order created")
        self.bus.publish("OrderCreated", order)
        return order

    def _on_payment_failed(self, data: dict):
        print(f"  [OrderService] Compensating — cancelling order {data.get('order_id')}")

    def _on_shipment_created(self, data: dict):
        print(f"  [OrderService] Order {data.get('order_id')} shipped — marking complete")


class InventoryService:
    def __init__(self, bus: EventBus):
        self.bus = bus
        bus.subscribe("OrderCreated",   self._on_order_created)
        bus.subscribe("PaymentFailed",  self._on_payment_failed)

    def _on_order_created(self, data: dict):
        print("  [InventoryService] Reserving inventory")
        self.bus.publish("InventoryReserved", data)

    def _on_payment_failed(self, data: dict):
        print("  [InventoryService] Releasing reservation")


class PaymentService:
    def __init__(self, bus: EventBus, fail: bool = False):
        self.bus  = bus
        self.fail = fail
        bus.subscribe("InventoryReserved", self._on_inventory_reserved)

    def _on_inventory_reserved(self, data: dict):
        if self.fail:
            print("  [PaymentService] Payment FAILED")
            self.bus.publish("PaymentFailed", data)
        else:
            print("  [PaymentService] Payment charged")
            self.bus.publish("PaymentCompleted", data)


class ShipmentService:
    def __init__(self, bus: EventBus):
        self.bus = bus
        bus.subscribe("PaymentCompleted", self._on_payment_completed)

    def _on_payment_completed(self, data: dict):
        print("  [ShipmentService] Creating shipment")
        self.bus.publish("ShipmentCreated", {**data, "tracking": "TRK-999"})


# ---------------------------------------------------------------------------
# Usage examples
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== Orchestration Saga (success) ===")
    saga = OrchestratorSaga(saga_id="ORD-001", steps=[
        SagaStep(
            "create_order",
            action       = lambda ctx: ctx.data.update({"order_id": "ORD-001"}),
            compensation = lambda ctx: print("    Cancelling order"),
        ),
        SagaStep(
            "reserve_inventory",
            action       = lambda ctx: ctx.data.update({"inventory": "reserved"}),
            compensation = lambda ctx: print("    Releasing inventory"),
        ),
        SagaStep(
            "charge_payment",
            action       = lambda ctx: ctx.data.update({"payment": "charged"}),
            compensation = lambda ctx: print("    Refunding payment"),
        ),
    ])
    result = saga.execute({"customer_id": "CUST-42", "amount": 99.99})
    print(f"Status: {result.status.value}\n")

    print("=== Orchestration Saga (failure + compensation) ===")
    def failing_payment(ctx):
        raise Exception("Card declined")

    saga_fail = OrchestratorSaga(saga_id="ORD-002", steps=[
        SagaStep("create_order",      lambda ctx: None, lambda ctx: print("    Cancelling order")),
        SagaStep("reserve_inventory", lambda ctx: None, lambda ctx: print("    Releasing inventory")),
        SagaStep("charge_payment",    failing_payment,  lambda ctx: None),
    ])
    result_fail = saga_fail.execute({"customer_id": "CUST-43", "amount": 199.99})
    print(f"Status: {result_fail.status.value}\n")

    print("=== Choreography Saga (success) ===")
    bus = EventBus()
    OrderService(bus)
    InventoryService(bus)
    PaymentService(bus, fail=False)
    ShipmentService(bus)
    order_svc = OrderService(bus)
    order_svc.create_order({"customer_id": "CUST-44", "amount": 59.99})

    print("\n=== Choreography Saga (payment failure + compensation) ===")
    bus2 = EventBus()
    OrderService(bus2)
    InventoryService(bus2)
    PaymentService(bus2, fail=True)
    ShipmentService(bus2)
    order_svc2 = OrderService(bus2)
    order_svc2.create_order({"customer_id": "CUST-45", "amount": 299.99})
