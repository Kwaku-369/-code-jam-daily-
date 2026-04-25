"""
Multi-Agent Supervisor Pattern
--------------------------------
Pattern: A Supervisor agent routes tasks to specialized sub-agents and
         aggregates their results. Inspired by LangGraph's supervisor tutorial
         and Microsoft AutoGen's GroupChat.
Sector:  Enterprise orchestration — sales pipelines, research + writing,
         code review + test generation, financial analysis suites.

Topology:
  Supervisor
   ├── ResearchAgent
   ├── WriterAgent
   ├── CodeAgent
   └── VerifierAgent

Tradeoffs:
  + Clean separation of concerns; each agent is independently testable
  + Supervisor can parallelize non-dependent tasks
  + Easy to add/remove agents without touching others
  - Supervisor becomes a bottleneck and single point of failure
  - Requires a strong supervisor LLM for correct routing
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable
import enum


class AgentRole(str, enum.Enum):
    RESEARCH  = "research"
    WRITER    = "writer"
    CODE      = "code"
    VERIFIER  = "verifier"
    FINISH    = "FINISH"


@dataclass
class SubAgent:
    role: AgentRole
    description: str
    handler: Callable[[str], str]

    def invoke(self, task: str) -> str:
        print(f"  [{self.role.value.upper()}] Working on: {task[:60]}")
        return self.handler(task)


@dataclass
class SupervisorAgent:
    agents: list[SubAgent]
    max_rounds: int = 6

    def _agent_map(self) -> dict[str, SubAgent]:
        return {a.role.value: a for a in self.agents}

    def _route(self, state: dict) -> AgentRole:
        """
        Supervisor decides which agent to call next.
        In production: call LLM with structured output (role enum).
        Stub: cycle through agents in order.
        """
        completed = state.get("completed_roles", [])
        for agent in self.agents:
            if agent.role.value not in completed:
                return agent.role
        return AgentRole.FINISH

    def _aggregate(self, results: dict[str, str]) -> str:
        parts = [f"[{role.upper()}]\n{result}" for role, result in results.items()]
        return "\n\n".join(parts)

    def run(self, goal: str) -> str:
        agent_map = self._agent_map()
        state = {
            "goal": goal,
            "results": {},
            "completed_roles": [],
            "messages": [],
        }

        for round_num in range(self.max_rounds):
            next_role = self._route(state)

            if next_role == AgentRole.FINISH:
                print(f"[Supervisor] All agents done after {round_num} rounds.")
                break

            agent = agent_map.get(next_role.value)
            if agent is None:
                print(f"[Supervisor] No agent registered for role '{next_role.value}', skipping.")
                state["completed_roles"].append(next_role.value)
                continue

            # Build task context from prior results
            context = "\n".join(f"{r}: {v[:100]}" for r, v in state["results"].items())
            task = f"Goal: {goal}\nContext:\n{context}"

            result = agent.invoke(task)
            state["results"][next_role.value] = result
            state["completed_roles"].append(next_role.value)

        return self._aggregate(state["results"])


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    supervisor = SupervisorAgent(agents=[
        SubAgent(AgentRole.RESEARCH,  "Gather information",     lambda t: "[research: found 3 papers]"),
        SubAgent(AgentRole.CODE,      "Write code",             lambda t: "[code: def solution(): pass]"),
        SubAgent(AgentRole.VERIFIER,  "Verify correctness",     lambda t: "[verifier: tests pass ✓]"),
        SubAgent(AgentRole.WRITER,    "Write final report",     lambda t: "[writer: report drafted]"),
    ])

    output = supervisor.run("Build and test a binary search implementation")
    print("\n=== Final Output ===")
    print(output)
