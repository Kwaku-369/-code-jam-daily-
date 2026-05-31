"""
Fintech — Trading & Risk Patterns
-----------------------------------
Patterns specific to financial engineering and trading systems.
Combines enterprise patterns with domain-specific requirements.

Patterns covered:
  1. Order Book — price-time priority matching engine
  2. Risk Limit Gate — circuit-breaker style pre-trade risk check
  3. Position Tracker — event-sourced position management
  4. Idempotent Payment — exactly-once payment processing

Sector context:
  - Latency: microseconds matter; use sync code, avoid GIL contention
  - Correctness: wrong numbers = regulatory fines / losses
  - Audit: every event must be logged (event sourcing is natural fit)
  - Idempotency: retries must never double-charge or double-fill
"""

from __future__ import annotations
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any
import uuid
import heapq


# ---- 1. Order Book (price-time priority) ----------------------------------

class Side(str, Enum):
    BUY  = "buy"
    SELL = "sell"


@dataclass(order=True)
class Order:
    # Ordering: buy orders by descending price; sell by ascending price
    sort_key:   tuple   = field(init=False, compare=True)
    order_id:   str     = field(compare=False)
    symbol:     str     = field(compare=False)
    side:       Side    = field(compare=False)
    price:      float   = field(compare=False)
    quantity:   int     = field(compare=False)
    timestamp:  datetime = field(compare=False, default_factory=datetime.utcnow)
    status:     str     = field(compare=False, default="open")

    def __post_init__(self):
        # Buy: highest price first → negate price
        # Sell: lowest price first → positive price
        price_key = -self.price if self.side == Side.BUY else self.price
        self.sort_key = (price_key, self.timestamp)


@dataclass
class Trade:
    trade_id:   str   = field(default_factory=lambda: str(uuid.uuid4())[:8])
    symbol:     str   = ""
    buy_id:     str   = ""
    sell_id:    str   = ""
    price:      float = 0.0
    quantity:   int   = 0
    timestamp:  datetime = field(default_factory=datetime.utcnow)


@dataclass
class OrderBook:
    symbol: str
    _bids: list = field(default_factory=list)   # buy orders (max-heap via negation)
    _asks: list = field(default_factory=list)   # sell orders (min-heap)
    _trades: list[Trade] = field(default_factory=list)

    def add_order(self, order: Order) -> list[Trade]:
        if order.side == Side.BUY:
            heapq.heappush(self._bids, order)
        else:
            heapq.heappush(self._asks, order)
        return self._match()

    def _match(self) -> list[Trade]:
        trades = []
        while self._bids and self._asks:
            best_bid  = self._bids[0]
            best_ask  = self._asks[0]

            if best_bid.price < best_ask.price:
                break  # No match

            fill_qty   = min(best_bid.quantity, best_ask.quantity)
            fill_price = best_ask.price  # Price improvement: buyer pays ask price

            trade = Trade(
                symbol=self.symbol,
                buy_id=best_bid.order_id,
                sell_id=best_ask.order_id,
                price=fill_price,
                quantity=fill_qty,
            )
            trades.append(trade)
            self._trades.append(trade)

            best_bid.quantity -= fill_qty
            best_ask.quantity -= fill_qty

            if best_bid.quantity == 0:
                heapq.heappop(self._bids)
            if best_ask.quantity == 0:
                heapq.heappop(self._asks)

        return trades

    def best_bid(self) -> float | None:
        return self._bids[0].price if self._bids else None

    def best_ask(self) -> float | None:
        return self._asks[0].price if self._asks else None

    def spread(self) -> float | None:
        if self.best_bid() and self.best_ask():
            return self.best_ask() - self.best_bid()
        return None


# ---- 2. Risk Limit Gate (pre-trade risk) ----------------------------------

@dataclass
class RiskLimits:
    max_position_size:   int   = 10_000    # shares per symbol
    max_order_value:     float = 1_000_000 # USD per single order
    max_daily_loss:      float = 50_000    # USD daily loss limit
    max_open_orders:     int   = 100


@dataclass
class RiskGate:
    """
    Pre-trade risk check — reject orders that violate risk limits.
    Pattern: Circuit Breaker applied to trading risk.
    """
    limits: RiskLimits = field(default_factory=RiskLimits)
    _positions: dict[str, int] = field(default_factory=dict)
    _daily_pnl: float = 0.0
    _open_orders: int = 0
    _killed: bool = False          # kill switch: halt all trading

    def check(self, order: Order) -> tuple[bool, str]:
        if self._killed:
            return False, "Kill switch active — all trading halted"

        order_value = order.price * order.quantity
        if order_value > self.limits.max_order_value:
            return False, f"Order value {order_value:,.0f} exceeds limit {self.limits.max_order_value:,.0f}"

        current_pos = self._positions.get(order.symbol, 0)
        new_pos = current_pos + (order.quantity if order.side == Side.BUY else -order.quantity)
        if abs(new_pos) > self.limits.max_position_size:
            return False, f"Position {new_pos} would exceed limit {self.limits.max_position_size}"

        if self._daily_pnl < -self.limits.max_daily_loss:
            return False, f"Daily loss {abs(self._daily_pnl):,.0f} exceeds limit {self.limits.max_daily_loss:,.0f}"

        if self._open_orders >= self.limits.max_open_orders:
            return False, f"Open orders {self._open_orders} at limit {self.limits.max_open_orders}"

        return True, "OK"

    def record_fill(self, symbol: str, side: Side, qty: int, pnl_impact: float = 0.0):
        delta = qty if side == Side.BUY else -qty
        self._positions[symbol] = self._positions.get(symbol, 0) + delta
        self._daily_pnl += pnl_impact

    def kill(self):
        self._killed = True
        print("[RiskGate] KILL SWITCH ACTIVATED — all trading halted")

    def reset_daily(self):
        self._daily_pnl = 0.0


# ---- 3. Idempotent Payment ------------------------------------------------

@dataclass
class PaymentRecord:
    idempotency_key: str
    amount:          float
    currency:        str
    status:          str         # "pending" | "charged" | "failed"
    result:          dict        = field(default_factory=dict)
    created_at:      datetime    = field(default_factory=datetime.utcnow)


class IdempotentPaymentService:
    """
    Exactly-once payment processing using idempotency keys.
    On retry with same key → return cached result (never double-charge).
    """
    def __init__(self):
        self._records: dict[str, PaymentRecord] = {}

    def charge(self, idempotency_key: str, amount: float, currency: str = "USD") -> dict:
        if idempotency_key in self._records:
            rec = self._records[idempotency_key]
            print(f"  [Payment] Duplicate key {idempotency_key} — returning cached result")
            return {"idempotent": True, **rec.result}

        record = PaymentRecord(idempotency_key=idempotency_key, amount=amount, currency=currency, status="pending")
        self._records[idempotency_key] = record

        # Simulate gateway call
        result = {"payment_id": str(uuid.uuid4())[:8], "status": "charged", "amount": amount, "currency": currency}
        record.status = "charged"
        record.result = result
        print(f"  [Payment] Charged {amount} {currency} | key={idempotency_key}")
        return result


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print("=== Order Book ===")
    book = OrderBook("AAPL")
    trades = book.add_order(Order("B1", "AAPL", Side.BUY,  150.0, 100))
    trades += book.add_order(Order("S1", "AAPL", Side.SELL, 149.5, 50))
    trades += book.add_order(Order("S2", "AAPL", Side.SELL, 150.0, 80))

    for t in trades:
        print(f"  Trade: {t.quantity} AAPL @ ${t.price} (buy={t.buy_id}, sell={t.sell_id})")
    print(f"  Spread: {book.spread()}")

    print("\n=== Risk Gate ===")
    gate  = RiskGate(RiskLimits(max_order_value=100_000))
    order = Order("O1", "TSLA", Side.BUY, 250.0, 500)
    ok, reason = gate.check(order)
    print(f"  Order {'APPROVED' if ok else 'REJECTED'}: {reason}")

    big_order = Order("O2", "TSLA", Side.BUY, 250.0, 5000)
    ok2, reason2 = gate.check(big_order)
    print(f"  Big order {'APPROVED' if ok2 else 'REJECTED'}: {reason2}")

    print("\n=== Idempotent Payment ===")
    svc = IdempotentPaymentService()
    key = str(uuid.uuid4())
    r1 = svc.charge(key, 99.99)
    r2 = svc.charge(key, 99.99)  # Retry
    print(f"  First:  {r1}")
    print(f"  Retry:  {r2}")
    print(f"  Idempotent: {r2.get('idempotent')}")
