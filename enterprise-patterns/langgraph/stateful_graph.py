"""
LangGraph — Stateful Graph Pattern
-------------------------------------
Pattern: Model a multi-step agent as a directed graph where each node is a
         callable, edges define flow, and a shared TypedDict is the state.
Sector:  Agentic workflows, document pipelines, multi-turn chat with memory.

Core concepts (mirrors langchain-ai/langgraph API):
  - StateGraph:   graph whose nodes read/write a shared State dict
  - Node:         a function (State) -> dict (partial state update)
  - Edge:         unconditional transition between nodes
  - Conditional:  edge decided at runtime by a routing function
  - Checkpointer: persists state between invocations (memory)

Tradeoffs:
  + State is explicit and inspectable — great for debugging
  + Cycles are first-class (unlike DAG-only frameworks)
  + Built-in persistence via checkpointers
  - More boilerplate than simple chains for linear pipelines
  - Graph topology must be defined before runtime
"""

from __future__ import annotations
from typing import Any, Callable, TypedDict
from dataclasses import dataclass, field
import copy


# ---- State schema (TypedDict mirrors LangGraph convention) ----------------

class AgentState(TypedDict):
    messages: list[str]
    next: str
    scratchpad: str
    final_answer: str | None


# ---- Graph engine (self-contained, no langgraph dependency) ---------------

@dataclass
class StateGraph:
    """
    Minimal StateGraph implementation that mirrors the LangGraph API.
    Replace with `from langgraph.graph import StateGraph` in production.
    """
    state_schema: type
    nodes: dict[str, Callable] = field(default_factory=dict)
    edges: dict[str, str] = field(default_factory=dict)              # node → node
    conditional_edges: dict[str, tuple[Callable, dict]] = field(default_factory=dict)
    entry_point: str | None = None
    finish_node: str = "END"

    def add_node(self, name: str, fn: Callable):
        self.nodes[name] = fn

    def add_edge(self, src: str, dst: str):
        self.edges[src] = dst

    def add_conditional_edges(self, src: str, router: Callable, mapping: dict[str, str]):
        self.conditional_edges[src] = (router, mapping)

    def set_entry_point(self, node: str):
        self.entry_point = node

    def compile(self) -> "CompiledGraph":
        return CompiledGraph(self)


@dataclass
class CompiledGraph:
    graph: StateGraph

    def invoke(self, initial_state: dict, config: dict | None = None) -> dict:
        state = copy.deepcopy(initial_state)
        node_name = self.graph.entry_point

        visited: list[str] = []
        max_steps = 50

        for _ in range(max_steps):
            if node_name == self.graph.finish_node or node_name is None:
                break

            visited.append(node_name)
            node_fn = self.graph.nodes.get(node_name)
            if node_fn is None:
                raise ValueError(f"Node '{node_name}' not found in graph")

            update = node_fn(state)
            if isinstance(update, dict):
                state.update(update)

            # Determine next node
            if node_name in self.graph.conditional_edges:
                router, mapping = self.graph.conditional_edges[node_name]
                key = router(state)
                node_name = mapping.get(key, self.graph.finish_node)
            elif node_name in self.graph.edges:
                node_name = self.graph.edges[node_name]
            else:
                break

        state["__visited__"] = visited
        return state


# ---- Example: research → draft → review workflow -------------------------

def research_node(state: AgentState) -> dict:
    print("[research] Gathering information...")
    return {
        "scratchpad": "Found: LangGraph supports cyclic graphs and checkpointing.",
        "next": "draft",
    }

def draft_node(state: AgentState) -> dict:
    print("[draft] Writing draft...")
    info = state.get("scratchpad", "")
    return {
        "messages": state["messages"] + [f"Draft based on: {info[:50]}"],
        "next": "review",
    }

def review_node(state: AgentState) -> dict:
    print("[review] Reviewing draft...")
    return {
        "final_answer": state["messages"][-1] + " [reviewed ✓]",
        "next": "END",
    }

def router(state: AgentState) -> str:
    return state.get("next", "END")


def build_research_graph() -> CompiledGraph:
    graph = StateGraph(state_schema=AgentState)

    graph.add_node("research", research_node)
    graph.add_node("draft",    draft_node)
    graph.add_node("review",   review_node)

    graph.add_conditional_edges("research", router, {"draft": "draft",   "END": "END"})
    graph.add_conditional_edges("draft",    router, {"review": "review", "END": "END"})
    graph.add_conditional_edges("review",   router, {"END": "END"})

    graph.set_entry_point("research")
    return graph.compile()


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    app = build_research_graph()
    result = app.invoke({"messages": ["What is LangGraph?"], "scratchpad": "", "final_answer": None, "next": ""})
    print(f"\nFinal answer: {result['final_answer']}")
    print(f"Visited nodes: {result['__visited__']}")
