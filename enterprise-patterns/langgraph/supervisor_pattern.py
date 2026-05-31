"""
LangGraph — Supervisor Pattern
--------------------------------
Pattern: A supervisor node sits in a cycle, routing work to worker nodes
         and deciding when the task is complete (FINISH).
Source:  langchain-ai/langgraph multi-agent supervisor tutorial
Sector:  Enterprise orchestration, research pipelines, agentic RAG.

Graph topology:
  ┌─────────────────────────────────┐
  │           Supervisor             │
  │    routes to worker or FINISH    │
  └───┬──────────┬──────────┬───────┘
      ▼          ▼          ▼
  Worker A   Worker B   Worker C
      │          │          │
      └──────────┴──────────┘
              (all loop back to Supervisor)

Tradeoffs:
  + Supervisor sees full history → context-aware routing
  + Workers are stateless — simple to test and replace
  + Natural stopping condition (FINISH) without extra logic
  - Every worker call passes through supervisor (latency)
  - Supervisor prompt bloat as conversation grows
"""

from __future__ import annotations
from typing import Callable, TypedDict
from dataclasses import dataclass, field

from .stateful_graph import StateGraph, CompiledGraph


class SupervisorState(TypedDict):
    messages: list[dict]       # {"role": "worker_name", "content": "..."}
    next: str
    task: str
    results: dict[str, str]
    iteration: int


FINISH = "FINISH"


@dataclass
class LangGraphSupervisor:
    """
    Self-contained LangGraph-style supervisor.
    In production use `langgraph.prebuilt.create_supervisor`.
    """
    workers: dict[str, Callable[[SupervisorState], str]]
    max_iterations: int = 10

    def _build_supervisor_node(self):
        workers_list = list(self.workers.keys()) + [FINISH]

        def supervisor(state: SupervisorState) -> dict:
            it = state.get("iteration", 0)
            print(f"[Supervisor] Iteration {it} — completed: {list(state.get('results', {}).keys())}")

            # Stub routing logic — in prod call LLM with workers_list as choices
            remaining = [w for w in self.workers if w not in state.get("results", {})]
            next_worker = remaining[0] if remaining else FINISH

            return {"next": next_worker, "iteration": it + 1}

        return supervisor

    def _build_worker_node(self, name: str, handler: Callable):
        def worker(state: SupervisorState) -> dict:
            result = handler(state)
            updated_results = {**state.get("results", {}), name: result}
            updated_messages = state.get("messages", []) + [{"role": name, "content": result}]
            return {
                "results":  updated_results,
                "messages": updated_messages,
                "next":     "supervisor",
            }
        return worker

    def compile(self) -> CompiledGraph:
        graph = StateGraph(state_schema=SupervisorState)

        # Add supervisor
        graph.add_node("supervisor", self._build_supervisor_node())

        # Add workers + edges back to supervisor
        for name, handler in self.workers.items():
            graph.add_node(name, self._build_worker_node(name, handler))
            graph.add_edge(name, "supervisor")

        # Supervisor routes conditionally
        routing_map = {w: w for w in self.workers}
        routing_map[FINISH] = "END"
        graph.add_conditional_edges("supervisor", lambda s: s["next"], routing_map)

        graph.set_entry_point("supervisor")
        return graph.compile()

    def run(self, task: str) -> dict[str, str]:
        app = self.compile()
        final_state = app.invoke({
            "messages":  [{"role": "user", "content": task}],
            "next":      "supervisor",
            "task":      task,
            "results":   {},
            "iteration": 0,
        })
        return final_state.get("results", {})


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    supervisor = LangGraphSupervisor(workers={
        "researcher": lambda s: f"[research] 3 papers found for: {s['task'][:40]}",
        "analyst":    lambda s: f"[analysis] Trends identified in: {s['task'][:40]}",
        "writer":     lambda s: f"[writer] Report drafted combining all findings",
    })

    results = supervisor.run("Analyze enterprise AI adoption trends in 2025")
    print("\n=== Results ===")
    for role, content in results.items():
        print(f"{role}: {content}")
