# Enterprise Patterns Library

> A standardized, runnable reference library of advanced design patterns for
> building production-grade AI agents, microservices, and large-scale applications.
> Every pattern is self-contained Python — no external dependencies needed to run the stubs.

---

## Structure

```
enterprise-patterns/
├── agents/                     # Agentic AI patterns
│   ├── react_agent.py            ReAct (Reasoning + Acting)
│   ├── plan_execute_agent.py     Plan-and-Execute
│   ├── reflection_agent.py       Reflection / Self-Critique
│   └── multi_agent_supervisor.py Multi-Agent Supervisor
│
├── langgraph/                  # LangGraph stateful graph patterns
│   ├── stateful_graph.py         StateGraph engine (mirrors LangGraph API)
│   └── supervisor_pattern.py     Supervisor in a cyclic graph
│
├── langchain/                  # LangChain pipeline patterns
│   ├── rag_pipeline.py           RAG + Corrective RAG (CRAG)
│   ├── tool_use_chain.py         Function calling / tool use chain
│   └── memory_patterns.py        Buffer, Summary, Vector, Hybrid, MemGPT
│
├── enterprise/                 # Classic enterprise software patterns
│   ├── cqrs.py                   CQRS with event-driven read model sync
│   ├── event_sourcing.py         Event Store + Snapshots + Time Travel
│   ├── saga_pattern.py           Orchestration + Choreography Sagas
│   ├── outbox_circuit_breaker.py Outbox + Circuit Breaker + Bulkhead
│   └── strangler_fig.py          Legacy migration with traffic routing
│
├── plugin_system/              # Extensible plugin architecture
│   ├── plugin_interface.py       ABC contracts (Plugin, AI, Notify, Storage)
│   ├── plugin_registry.py        Auto-discovery, lifecycle, middleware hooks
│   └── example_plugins/
│       ├── notification_plugins.py  Slack, Email, PagerDuty
│       └── ai_plugins.py            Claude, OpenAI, LocalLLM, RAG
│
└── sectors/                    # Domain-specific pattern applications
    ├── fintech/
    │   └── trading_patterns.py   Order Book, Risk Gate, Idempotent Payment
    ├── infrastructure/
    │   └── infra_patterns.py     Health, Rate Limiter, Dist. Lock, Registry, Logger
    └── solutions_arch/
        └── architecture_patterns.py  API Gateway, Multi-Tenancy, Cache, Feature Flags
```

---

## Quick Reference

### When to use each pattern

| Pattern | Use When | Complexity | Sector |
|---------|----------|-----------|--------|
| **ReAct Agent** | Interactive problem-solving, unknown tool sequences | Medium | All |
| **Plan-Execute** | Long-horizon tasks with clear sub-goals | Medium | Enterprise, DevOps |
| **Reflection** | High-stakes output quality (legal, finance, code) | Low | All |
| **Multi-Agent Supervisor** | 3+ specialized roles needed | High | Enterprise AI |
| **LangGraph StateGraph** | Cyclic agent flows, stateful multi-turn | Medium | Agentic pipelines |
| **LangGraph Supervisor** | Central routing between worker agents | High | Enterprise agents |
| **RAG Pipeline** | Knowledge-base Q&A, hallucination reduction | Medium | All AI |
| **Corrective RAG** | High-accuracy retrieval (legal/finance) | Medium | Fintech, Legal |
| **Memory: Hybrid** | Multi-session personalized agents | Medium | Customer support |
| **Memory: MemGPT** | Very long conversations, context compression | High | Research agents |
| **CQRS** | Read:write ratio > 10:1 | High | E-commerce, Analytics |
| **Event Sourcing** | Full audit trail required, time-travel queries | High | Fintech, Healthcare |
| **Saga (Orchestration)** | Complex distributed transactions (5+ services) | High | Fintech, E-commerce |
| **Saga (Choreography)** | Simple distributed transactions (<5 services) | Medium | Microservices |
| **Outbox Pattern** | Atomic DB write + event publish | Medium | All microservices |
| **Circuit Breaker** | External service calls that can fail | Low | All microservices |
| **Bulkhead** | Isolate resource pools per dependency | Low | Multi-tenant |
| **Strangler Fig** | Legacy modernization without downtime | High | Enterprise migration |
| **Plugin System** | Extensible platform with third-party integrations | Medium | Platforms, Marketplaces |
| **Order Book** | Price-time priority matching | High | Fintech / Trading |
| **Risk Gate** | Pre-trade / pre-action risk checks | Medium | Fintech |
| **Idempotent Payment** | Exactly-once payment operations | Low | Fintech |
| **Rate Limiter** | API throttling per user/IP/key | Low | All APIs |
| **Distributed Lock** | Critical sections across services | Medium | Infra |
| **Service Registry** | Dynamic service discovery + load balancing | Medium | Infra |
| **API Gateway** | Centralized auth, routing, rate-limiting | Medium | Solutions Arch |
| **Feature Flags** | Progressive rollout, A/B testing, kill switches | Low | All |
| **Cache-Aside** | Read-heavy, infrequent updates | Low | All |
| **RED Metrics** | Service observability (Rate, Errors, Duration) | Low | All |

---

## Agent Pattern Decision Tree

```
Do you need the agent to use tools?
├── YES → Does it need to reason step by step?
│          ├── YES, adaptively  → ReAct Agent
│          └── YES, with a plan → Plan-Execute Agent
└── NO  → Does it need to improve its own output?
           ├── YES → Reflection Agent
           └── NO  → Simple LLM call (no agent needed)

Do you need multiple specialized agents?
├── YES → Do they need a central coordinator?
│          ├── YES → Multi-Agent Supervisor (or LangGraph Supervisor)
│          └── NO  → Choreography (event-driven agents)
└── NO  → Single agent is fine

Does the workflow have cycles / loops?
├── YES → LangGraph StateGraph (supports cycles natively)
└── NO  → Simple chain / DAG
```

---

## Enterprise Pattern Decision Tree

```
Need distributed transactions?
├── Single DB             → ACID transaction (no saga needed)
└── Multiple services     → Saga Pattern
    ├── <5 services       → Choreography (events)
    └── ≥5 services       → Orchestration (central coordinator)

Need audit trail / compliance?
├── YES → Event Sourcing + CQRS read model
└── NO  → Standard CRUD

High read/write ratio?
├── >10:1 → CQRS (separate read/write models)
└── <10:1 → Single model is fine

Calling unreliable external services?
├── YES → Circuit Breaker + Retry + Bulkhead
└── NO  → Direct call

Need atomic DB write + message publish?
├── YES → Transactional Outbox
└── NO  → Direct publish is fine

Migrating a legacy monolith?
├── YES → Strangler Fig (gradual facade routing)
└── NO  → Greenfield microservices
```

---

## Running the Examples

Every file has an `if __name__ == "__main__"` block. Run any of them directly:

```bash
# Agent patterns
python enterprise-patterns/agents/react_agent.py
python enterprise-patterns/agents/multi_agent_supervisor.py

# LangGraph
python enterprise-patterns/langgraph/stateful_graph.py

# LangChain
python enterprise-patterns/langchain/rag_pipeline.py
python enterprise-patterns/langchain/memory_patterns.py

# Enterprise
python enterprise-patterns/enterprise/cqrs.py
python enterprise-patterns/enterprise/event_sourcing.py
python enterprise-patterns/enterprise/saga_pattern.py
python enterprise-patterns/enterprise/outbox_circuit_breaker.py
python enterprise-patterns/enterprise/strangler_fig.py

# Sectors
python enterprise-patterns/sectors/fintech/trading_patterns.py
python enterprise-patterns/sectors/infrastructure/infra_patterns.py
python enterprise-patterns/sectors/solutions_arch/architecture_patterns.py
```

All stubs are clearly marked. Replace `_stub_*` / `# Production:` comments with
real LLM clients, database connections, and message brokers.

---

## Production Wiring

| Stub | Production replacement |
|------|----------------------|
| `stub_embed()` | `OpenAIEmbeddings`, `HuggingFaceEmbeddings`, `VoyageAIEmbeddings` |
| `_generate()` in RAG | `anthropic.messages.create()` / `openai.chat.completions.create()` |
| `_think()` in ReAct | LLM call with ReAct prompt template |
| `InMemoryVectorStore` | Pinecone, Weaviate, Chroma, pgvector |
| `InMemoryLockStore` | Redis `SET NX PX` (use `redis-py`) |
| `EventStore._streams` | PostgreSQL append-only table / EventStoreDB |
| `InMemoryEventBus` | Kafka, RabbitMQ, AWS SQS/SNS |
| `LegacyMonolith.handle()` | Real legacy service HTTP client |
| `FeatureFlagService` | LaunchDarkly, Unleash, GrowthBook |
| `MetricsCollector` | Prometheus client, Datadog `statsd` |

---

## Sources & References

- [LangChain Docs](https://docs.langchain.com) · [LangGraph Docs](https://langchain-ai.github.io/langgraph)
- [microservices.io patterns](https://microservices.io/patterns) (Chris Richardson)
- [Azure Architecture Center](https://learn.microsoft.com/en-us/azure/architecture/patterns/)
- [AWS Prescriptive Guidance](https://docs.aws.amazon.com/prescriptive-guidance)
- Yao et al. 2022 — *ReAct: Synergizing Reasoning and Acting in Language Models*
- Packer et al. 2023 — *MemGPT: Towards LLMs as Operating Systems*
- Shinn et al. 2023 — *Reflexion: Language Agents with Verbal Reinforcement Learning*
- Nygard 2007 — *Release It! Design and Deploy Production-Ready Software*
- Martin Fowler — [CQRS](https://martinfowler.com/bliki/CQRS.html), [Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html), [Strangler Fig](https://martinfowler.com/bliki/StranglerFigApplication.html)
- CrewAI — [github.com/crewaiinc/crewai](https://github.com/crewaiinc/crewai)
