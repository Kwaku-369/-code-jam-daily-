"""
CQRS — Command Query Responsibility Segregation
-------------------------------------------------
Pattern: Split write (command) and read (query) models into separate objects.
         Optionally use separate databases optimized for each.
Source:  Greg Young 2010; Martin Fowler; Azure Architecture Center
Sector:  E-commerce product catalogs, financial dashboards, analytics platforms.

Read:write ratios that justify CQRS: 100:1 or higher.

Two-DB variant (full CQRS):
  Write DB: normalized, transactional (PostgreSQL)
  Read DB:  denormalized, query-optimized (Elasticsearch, Redis, DynamoDB)
  Sync:     events published on write → read model updated asynchronously

Tradeoffs:
  + Reads and writes scale independently
  + Read model optimized per use case (no N+1 queries)
  + Write model encapsulates all domain logic
  - Eventual consistency between write and read DBs
  - Added complexity: event sync, two schemas
  - Overkill for simple CRUD apps
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any
from datetime import datetime
import uuid


# ---- Domain Events -------------------------------------------------------

@dataclass
class DomainEvent:
    event_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    timestamp: str = field(default_factory=lambda: datetime.utcnow().isoformat())


@dataclass
class ProductCreated(DomainEvent):
    product_id: str = ""
    name: str = ""
    price: float = 0.0
    category: str = ""


@dataclass
class ProductPriceUpdated(DomainEvent):
    product_id: str = ""
    old_price: float = 0.0
    new_price: float = 0.0


# ---- Commands (intent to change state) ------------------------------------

@dataclass
class CreateProductCommand:
    name: str
    price: float
    category: str


@dataclass
class UpdatePriceCommand:
    product_id: str
    new_price: float


# ---- Write Model (transactional) -----------------------------------------

@dataclass
class Product:
    product_id: str
    name: str
    price: float
    category: str
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())


class WriteModelRepository:
    """Simulates a normalized transactional DB."""
    def __init__(self):
        self._store: dict[str, Product] = {}

    def save(self, product: Product):
        self._store[product.product_id] = product

    def get(self, product_id: str) -> Product | None:
        return self._store.get(product_id)


class InMemoryEventBus:
    def __init__(self):
        self._handlers: dict[str, list] = {}

    def subscribe(self, event_type: str, handler):
        self._handlers.setdefault(event_type, []).append(handler)

    def publish(self, event: DomainEvent):
        handlers = self._handlers.get(type(event).__name__, [])
        for h in handlers:
            h(event)


class ProductCommandHandler:
    def __init__(self, repo: WriteModelRepository, event_bus: InMemoryEventBus):
        self.repo = repo
        self.bus = event_bus

    def handle_create(self, cmd: CreateProductCommand) -> str:
        product_id = str(uuid.uuid4())
        product = Product(product_id=product_id, name=cmd.name, price=cmd.price, category=cmd.category)

        # Domain logic: premium category gets 10% discount
        if cmd.category == "premium":
            product.price = round(cmd.price * 0.9, 2)

        self.repo.save(product)
        self.bus.publish(ProductCreated(product_id=product_id, name=cmd.name, price=product.price, category=cmd.category))
        print(f"[Write] Created product {product_id}: {cmd.name} @ {product.price}")
        return product_id

    def handle_update_price(self, cmd: UpdatePriceCommand):
        product = self.repo.get(cmd.product_id)
        if product is None:
            raise ValueError(f"Product {cmd.product_id} not found")
        old_price = product.price
        product.price = cmd.new_price
        self.repo.save(product)
        self.bus.publish(ProductPriceUpdated(product_id=cmd.product_id, old_price=old_price, new_price=cmd.new_price))
        print(f"[Write] Updated price {cmd.product_id}: {old_price} → {cmd.new_price}")


# ---- Read Model (denormalized, query-optimized) ---------------------------

@dataclass
class ProductReadView:
    product_id: str
    name: str
    price: float
    category: str
    last_updated: str = ""


class ReadModelRepository:
    """Simulates a fast read store (Elasticsearch / DynamoDB style)."""
    def __init__(self):
        self._index: dict[str, ProductReadView] = {}
        self._category_index: dict[str, list[str]] = {}

    def upsert(self, view: ProductReadView):
        old = self._index.get(view.product_id)
        if old:
            cat = old.category
            if cat in self._category_index and view.product_id in self._category_index[cat]:
                self._category_index[cat].remove(view.product_id)
        self._index[view.product_id] = view
        self._category_index.setdefault(view.category, []).append(view.product_id)

    def find_by_category(self, category: str) -> list[ProductReadView]:
        ids = self._category_index.get(category, [])
        return [self._index[i] for i in ids if i in self._index]

    def find_by_id(self, product_id: str) -> ProductReadView | None:
        return self._index.get(product_id)

    def find_all(self) -> list[ProductReadView]:
        return list(self._index.values())


class ReadModelProjector:
    """Listens to domain events and keeps the read model in sync."""
    def __init__(self, read_repo: ReadModelRepository):
        self.repo = read_repo

    def on_product_created(self, event: ProductCreated):
        view = ProductReadView(
            product_id=event.product_id,
            name=event.name,
            price=event.price,
            category=event.category,
            last_updated=event.timestamp,
        )
        self.repo.upsert(view)
        print(f"[ReadModel] Indexed product {event.product_id}")

    def on_price_updated(self, event: ProductPriceUpdated):
        view = self.repo.find_by_id(event.product_id)
        if view:
            view.price = event.new_price
            view.last_updated = event.timestamp
            self.repo.upsert(view)
            print(f"[ReadModel] Updated price for {event.product_id}")


# ---- CQRS Application facade ---------------------------------------------

class ProductCQRSApp:
    def __init__(self):
        self.event_bus    = InMemoryEventBus()
        self.write_repo   = WriteModelRepository()
        self.read_repo    = ReadModelRepository()
        projector         = ReadModelProjector(self.read_repo)
        self.cmd_handler  = ProductCommandHandler(self.write_repo, self.event_bus)

        self.event_bus.subscribe("ProductCreated",     projector.on_product_created)
        self.event_bus.subscribe("ProductPriceUpdated", projector.on_price_updated)

    # Commands
    def create_product(self, name: str, price: float, category: str) -> str:
        return self.cmd_handler.handle_create(CreateProductCommand(name, price, category))

    def update_price(self, product_id: str, new_price: float):
        self.cmd_handler.handle_update_price(UpdatePriceCommand(product_id, new_price))

    # Queries (read model only)
    def get_products_by_category(self, category: str) -> list[ProductReadView]:
        return self.read_repo.find_by_category(category)

    def get_product(self, product_id: str) -> ProductReadView | None:
        return self.read_repo.find_by_id(product_id)


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app = ProductCQRSApp()

    pid1 = app.create_product("MacBook Pro", 2499.0, "premium")
    pid2 = app.create_product("USB Hub", 49.0, "accessories")
    pid3 = app.create_product("iPad", 799.0, "premium")

    app.update_price(pid1, 2299.0)

    print("\n=== Premium Products ===")
    for p in app.get_products_by_category("premium"):
        print(f"  {p.name}: ${p.price}")
