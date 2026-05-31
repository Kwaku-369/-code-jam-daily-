"""
Event Sourcing
---------------
Pattern: Store state as an immutable, append-only log of domain events.
         Reconstruct current state by replaying events.
Source:  Greg Young; microservices.io/patterns/data/event-sourcing
Sector:  Fintech (ledgers, audit trails), healthcare (records), compliance.

Key operations:
  - Append:   add event to stream (never update/delete)
  - Replay:   fold events → current state
  - Snapshot: periodic state checkpoint to avoid full replay
  - Time-travel: replay up to timestamp T → state at T

Tradeoffs:
  + Perfect audit trail — every mutation is recorded
  + Time-travel queries: "what was balance at Jan 15 3pm?"
  + Event stream enables event-driven downstream consumers
  - Storage grows without bound (mitigate with snapshots)
  - Querying current state requires replay or a read model
  - Steep learning curve; event schema versioning is hard
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any
import uuid


# ---- Event primitives ----------------------------------------------------

@dataclass
class Event:
    event_id: str        = field(default_factory=lambda: str(uuid.uuid4()))
    aggregate_id: str    = ""
    event_type: str      = ""
    version: int         = 0
    timestamp: datetime  = field(default_factory=datetime.utcnow)
    data: dict           = field(default_factory=dict)


# ---- Append-only Event Store ---------------------------------------------

@dataclass
class EventStore:
    _streams: dict[str, list[Event]] = field(default_factory=dict)

    def append(self, aggregate_id: str, events: list[Event], expected_version: int = -1):
        stream = self._streams.setdefault(aggregate_id, [])
        current_version = len(stream)

        if expected_version >= 0 and current_version != expected_version:
            raise ConcurrencyError(
                f"Expected version {expected_version}, got {current_version}"
            )

        for i, event in enumerate(events):
            event.aggregate_id = aggregate_id
            event.version      = current_version + i
            stream.append(event)

    def load(self, aggregate_id: str, max_version: int | None = None) -> list[Event]:
        stream = self._streams.get(aggregate_id, [])
        if max_version is not None:
            return [e for e in stream if e.version <= max_version]
        return list(stream)

    def load_until(self, aggregate_id: str, timestamp: datetime) -> list[Event]:
        return [e for e in self._streams.get(aggregate_id, []) if e.timestamp <= timestamp]


class ConcurrencyError(Exception):
    pass


# ---- Snapshot Store -------------------------------------------------------

@dataclass
class Snapshot:
    aggregate_id: str
    version: int
    state: dict
    taken_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class SnapshotStore:
    _snapshots: dict[str, Snapshot] = field(default_factory=dict)

    def save(self, snapshot: Snapshot):
        self._snapshots[snapshot.aggregate_id] = snapshot

    def load(self, aggregate_id: str) -> Snapshot | None:
        return self._snapshots.get(aggregate_id)


# ---- Bank Account Aggregate (event-sourced) -------------------------------

@dataclass
class BankAccount:
    """
    Classic event-sourced aggregate — a bank account.
    State is fully derived from the event stream.
    """
    account_id: str
    _balance: float         = field(default=0.0, init=False)
    _owner: str             = field(default="",  init=False)
    _version: int           = field(default=0,   init=False)
    _pending_events: list   = field(default_factory=list, init=False)

    # ---- State reconstruction (apply events) ----------------------------

    def _apply(self, event: Event):
        handlers = {
            "AccountOpened":   self._apply_opened,
            "FundsDeposited":  self._apply_deposited,
            "FundsWithdrawn":  self._apply_withdrawn,
        }
        handler = handlers.get(event.event_type)
        if handler:
            handler(event.data)
        self._version = event.version + 1

    def _apply_opened(self, data: dict):
        self._owner   = data["owner"]
        self._balance = data["initial_balance"]

    def _apply_deposited(self, data: dict):
        self._balance += data["amount"]

    def _apply_withdrawn(self, data: dict):
        self._balance -= data["amount"]

    # ---- Command methods (emit events, don't mutate directly) -----------

    def open(self, owner: str, initial_balance: float = 0.0):
        event = Event(
            event_type="AccountOpened",
            data={"owner": owner, "initial_balance": initial_balance},
        )
        self._record(event)

    def deposit(self, amount: float):
        if amount <= 0:
            raise ValueError("Deposit amount must be positive")
        event = Event(event_type="FundsDeposited", data={"amount": amount})
        self._record(event)

    def withdraw(self, amount: float):
        if amount > self._balance:
            raise ValueError(f"Insufficient funds: {self._balance:.2f} < {amount:.2f}")
        event = Event(event_type="FundsWithdrawn", data={"amount": amount})
        self._record(event)

    def _record(self, event: Event):
        self._apply(event)
        self._pending_events.append(event)

    def pull_events(self) -> list[Event]:
        events, self._pending_events = self._pending_events, []
        return events

    @property
    def balance(self) -> float:
        return self._balance

    @property
    def version(self) -> int:
        return self._version

    # ---- Rebuild from event store ----------------------------------------

    @classmethod
    def load_from_history(cls, account_id: str, events: list[Event],
                          snapshot: Snapshot | None = None) -> "BankAccount":
        account = cls(account_id=account_id)
        if snapshot:
            account._balance = snapshot.state["balance"]
            account._owner   = snapshot.state["owner"]
            account._version = snapshot.version
            # Only replay events after snapshot
            events = [e for e in events if e.version >= snapshot.version]

        for event in events:
            account._apply(event)
        account._pending_events = []
        return account


# ---- Application service -------------------------------------------------

SNAPSHOT_INTERVAL = 5  # snapshot every 5 events

@dataclass
class BankAccountService:
    event_store:    EventStore    = field(default_factory=EventStore)
    snapshot_store: SnapshotStore = field(default_factory=SnapshotStore)

    def _load(self, account_id: str) -> BankAccount:
        snapshot = self.snapshot_store.load(account_id)
        events   = self.event_store.load(account_id)
        return BankAccount.load_from_history(account_id, events, snapshot)

    def _save(self, account: BankAccount):
        events = account.pull_events()
        if not events:
            return
        self.event_store.append(account.account_id, events, expected_version=account.version - len(events))

        if account.version % SNAPSHOT_INTERVAL == 0:
            snap = Snapshot(
                aggregate_id=account.account_id,
                version=account.version,
                state={"balance": account.balance, "owner": account._owner},
            )
            self.snapshot_store.save(snap)
            print(f"[Snapshot] Saved at version {account.version}")

    def open_account(self, account_id: str, owner: str, initial: float = 0.0):
        acc = BankAccount(account_id=account_id)
        acc.open(owner, initial)
        self._save(acc)
        return acc

    def deposit(self, account_id: str, amount: float):
        acc = self._load(account_id)
        acc.deposit(amount)
        self._save(acc)

    def withdraw(self, account_id: str, amount: float):
        acc = self._load(account_id)
        acc.withdraw(amount)
        self._save(acc)

    def get_balance(self, account_id: str) -> float:
        return self._load(account_id).balance

    def get_balance_at(self, account_id: str, timestamp: datetime) -> float:
        events = self.event_store.load_until(account_id, timestamp)
        acc = BankAccount.load_from_history(account_id, events)
        return acc.balance

    def get_history(self, account_id: str) -> list[Event]:
        return self.event_store.load(account_id)


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    svc = BankAccountService()
    svc.open_account("acc-1", "Alice", initial=1000.0)
    checkpoint = datetime.utcnow()

    svc.deposit("acc-1", 500.0)
    svc.deposit("acc-1", 250.0)
    svc.withdraw("acc-1", 100.0)

    print(f"\nCurrent balance: ${svc.get_balance('acc-1'):.2f}")
    print(f"Balance at checkpoint: ${svc.get_balance_at('acc-1', checkpoint):.2f}")

    print("\nEvent history:")
    for e in svc.get_history("acc-1"):
        print(f"  v{e.version} [{e.event_type}] {e.data}")
