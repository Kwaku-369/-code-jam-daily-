"""
Transactional Outbox + Circuit Breaker + Bulkhead
---------------------------------------------------
Three resilience patterns bundled in one file.

OUTBOX PATTERN
--------------
Problem: DB write + message publish must be atomic.
         If you write to DB and then crash before publishing → lost event.
Solution: Write the event to an OUTBOX table inside the same DB transaction.
          A relay process polls the outbox and publishes to the broker.
Source:   microservices.io/patterns/data/transactional-outbox
Sector:   Any event-driven microservice (fintech, e-commerce, logistics).

CIRCUIT BREAKER
---------------
Pattern:  Wrap remote calls in a state machine that fails fast when the
          remote service is down, preventing cascade failures.
States:   CLOSED (normal) → OPEN (failing, fail-fast) → HALF_OPEN (testing)
Source:   Michael Nygard "Release It!"; Netflix Hystrix; Resilience4j
Sector:   All microservices with external dependencies.

BULKHEAD
--------
Pattern:  Isolate resources (thread pools, semaphores) per dependency so
          one slow service can't starve others.
Source:   Michael Nygard "Release It!"; Resilience4j Bulkhead
Sector:   Multi-tenant platforms, APIs with mixed SLAs.
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum
from concurrent.futures import ThreadPoolExecutor, Future
from typing import Callable, Any
import uuid
import time
import threading


# ==========================================================================
# TRANSACTIONAL OUTBOX
# ==========================================================================

@dataclass
class OutboxEntry:
    entry_id:   str      = field(default_factory=lambda: str(uuid.uuid4()))
    event_type: str      = ""
    payload:    dict     = field(default_factory=dict)
    published:  bool     = False
    created_at: datetime = field(default_factory=datetime.utcnow)
    retries:    int      = 0


class OutboxStore:
    """Simulates the OUTBOX table in the same relational DB as the business data."""
    def __init__(self):
        self._entries: list[OutboxEntry] = []
        self._lock = threading.Lock()

    def save(self, entry: OutboxEntry):
        with self._lock:
            self._entries.append(entry)

    def unpublished(self, batch_size: int = 10) -> list[OutboxEntry]:
        with self._lock:
            return [e for e in self._entries if not e.published][:batch_size]

    def mark_published(self, entry_id: str):
        with self._lock:
            for e in self._entries:
                if e.entry_id == entry_id:
                    e.published = True
                    break


class MessageBroker:
    """Stub message broker (Kafka / RabbitMQ / SQS)."""
    def publish(self, event_type: str, payload: dict):
        print(f"  [Broker] Published: {event_type} — {str(payload)[:60]}")


class OutboxRelay:
    """
    Background relay: polls outbox → publishes to broker → marks published.
    Run this in a separate thread/process.
    """
    def __init__(self, outbox: OutboxStore, broker: MessageBroker,
                 poll_interval: float = 0.5, max_retries: int = 3):
        self.outbox        = outbox
        self.broker        = broker
        self.poll_interval = poll_interval
        self.max_retries   = max_retries
        self._running      = False

    def poll_once(self):
        for entry in self.outbox.unpublished():
            try:
                self.broker.publish(entry.event_type, entry.payload)
                self.outbox.mark_published(entry.entry_id)
            except Exception as exc:
                entry.retries += 1
                if entry.retries >= self.max_retries:
                    print(f"  [Relay] DEAD LETTER: {entry.entry_id} after {entry.retries} retries — {exc}")

    def start(self):
        self._running = True
        while self._running:
            self.poll_once()
            time.sleep(self.poll_interval)

    def stop(self):
        self._running = False


class OrderService:
    """Demonstrates atomic DB-write + outbox entry in one transaction."""
    def __init__(self, outbox: OutboxStore):
        self.outbox = outbox
        self._orders: dict[str, dict] = {}

    def place_order(self, customer_id: str, amount: float) -> str:
        order_id = str(uuid.uuid4())[:8]
        # ---- ATOMIC TRANSACTION (pseudo-code; use real DB txn in prod) ----
        self._orders[order_id] = {"customer_id": customer_id, "amount": amount, "status": "pending"}
        self.outbox.save(OutboxEntry(
            event_type="OrderPlaced",
            payload={"order_id": order_id, "customer_id": customer_id, "amount": amount},
        ))
        # ---- END TRANSACTION ------------------------------------------------
        print(f"  [OrderService] Order {order_id} saved + outbox entry created")
        return order_id


# ==========================================================================
# CIRCUIT BREAKER
# ==========================================================================

class CBState(str, Enum):
    CLOSED    = "CLOSED"     # Normal
    OPEN      = "OPEN"       # Failing — fast-fail
    HALF_OPEN = "HALF_OPEN"  # Testing recovery


@dataclass
class CircuitBreaker:
    name:              str
    failure_threshold: int   = 3
    reset_timeout_sec: float = 10.0
    success_threshold: int   = 2   # successes in HALF_OPEN needed to close

    _state:            CBState  = field(default=CBState.CLOSED, init=False)
    _failure_count:    int      = field(default=0, init=False)
    _success_count:    int      = field(default=0, init=False)
    _last_failure_at:  datetime = field(default=None, init=False)
    _lock:             threading.Lock = field(default_factory=threading.Lock, init=False)

    @property
    def state(self) -> CBState:
        return self._state

    def _try_reset(self):
        if (self._state == CBState.OPEN and self._last_failure_at and
                datetime.utcnow() - self._last_failure_at >= timedelta(seconds=self.reset_timeout_sec)):
            print(f"  [CB/{self.name}] OPEN → HALF_OPEN (probing)")
            self._state         = CBState.HALF_OPEN
            self._success_count = 0

    def call(self, fn: Callable, *args, **kwargs) -> Any:
        with self._lock:
            self._try_reset()

            if self._state == CBState.OPEN:
                raise CircuitOpenError(f"Circuit '{self.name}' is OPEN — call blocked")

        try:
            result = fn(*args, **kwargs)
            with self._lock:
                self._on_success()
            return result
        except CircuitOpenError:
            raise
        except Exception as exc:
            with self._lock:
                self._on_failure()
            raise

    def _on_success(self):
        if self._state == CBState.HALF_OPEN:
            self._success_count += 1
            if self._success_count >= self.success_threshold:
                print(f"  [CB/{self.name}] HALF_OPEN → CLOSED (recovered)")
                self._state         = CBState.CLOSED
                self._failure_count = 0
        elif self._state == CBState.CLOSED:
            self._failure_count = 0

    def _on_failure(self):
        self._failure_count  += 1
        self._last_failure_at = datetime.utcnow()
        if self._failure_count >= self.failure_threshold:
            print(f"  [CB/{self.name}] CLOSED → OPEN (failures: {self._failure_count})")
            self._state = CBState.OPEN


class CircuitOpenError(Exception):
    pass


# ==========================================================================
# BULKHEAD
# ==========================================================================

@dataclass
class Bulkhead:
    """
    Semaphore-based bulkhead: limits concurrent calls to a dependency.
    Ensures one slow dependency can't exhaust all worker threads.
    """
    name:         str
    max_concurrent: int = 5
    _semaphore: threading.Semaphore = field(init=False)

    def __post_init__(self):
        self._semaphore = threading.Semaphore(self.max_concurrent)

    def call(self, fn: Callable, *args, timeout: float = 1.0, **kwargs) -> Any:
        acquired = self._semaphore.acquire(timeout=timeout)
        if not acquired:
            raise BulkheadFullError(
                f"Bulkhead '{self.name}' full ({self.max_concurrent} concurrent calls)"
            )
        try:
            return fn(*args, **kwargs)
        finally:
            self._semaphore.release()


class BulkheadFullError(Exception):
    pass


class ResilientService:
    """Combines CircuitBreaker + Bulkhead for maximum resilience."""
    def __init__(self, name: str, max_concurrent: int = 5, failure_threshold: int = 3):
        self.cb       = CircuitBreaker(name=name, failure_threshold=failure_threshold)
        self.bulkhead = Bulkhead(name=name, max_concurrent=max_concurrent)

    def call(self, fn: Callable, *args, **kwargs) -> Any:
        return self.bulkhead.call(lambda: self.cb.call(fn, *args, **kwargs))


# ---------------------------------------------------------------------------
# Usage examples
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== Transactional Outbox ===")
    outbox  = OutboxStore()
    broker  = MessageBroker()
    relay   = OutboxRelay(outbox, broker)
    service = OrderService(outbox)

    service.place_order("cust-1", 99.0)
    service.place_order("cust-2", 49.0)
    relay.poll_once()   # Publish pending outbox entries

    print("\n=== Circuit Breaker ===")
    cb = CircuitBreaker(name="payment-gateway", failure_threshold=2, reset_timeout_sec=2)
    call_count = 0

    def flaky_api():
        global call_count
        call_count += 1
        if call_count <= 2:
            raise ConnectionError("Gateway timeout")
        return "OK"

    for i in range(5):
        try:
            result = cb.call(flaky_api)
            print(f"  Call {i+1}: {result} [state={cb.state.value}]")
        except (ConnectionError, CircuitOpenError) as e:
            print(f"  Call {i+1}: FAILED — {e} [state={cb.state.value}]")

    print("\n=== Bulkhead ===")
    bulkhead = Bulkhead(name="db-pool", max_concurrent=2)

    def slow_db_call(n):
        time.sleep(0.01)
        return f"result-{n}"

    with ThreadPoolExecutor(max_workers=5) as pool:
        futures: list[Future] = []
        for i in range(5):
            futures.append(pool.submit(lambda i=i: bulkhead.call(slow_db_call, i, timeout=0.1)))
        for i, f in enumerate(futures):
            try:
                print(f"  Call {i}: {f.result()}")
            except BulkheadFullError as e:
                print(f"  Call {i}: REJECTED — {e}")
