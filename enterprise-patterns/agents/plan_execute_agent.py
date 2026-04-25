"""
Plan-and-Execute Agent Pattern
--------------------------------
Pattern: Separate planning from execution. Planner creates a task list;
         executor runs each task; replanner revises on failure.
Sector:  Complex workflows — DevOps automation, research pipelines,
         financial analysis, multi-step data ETL.

Flow:
  Goal → Planner (full plan) → Executor (step by step) → Replanner (if needed)

Tradeoffs:
  + Long-horizon tasks with clear sub-goals
  + Easy to inspect and audit the plan before execution
  - Requires a capable planner LLM for non-trivial goals
  - Plan can go stale if environment changes mid-execution
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Step:
    id: int
    description: str
    tool: str
    args: dict
    result: str | None = None
    status: str = "pending"   # pending | running | done | failed


@dataclass
class Plan:
    goal: str
    steps: list[Step] = field(default_factory=list)
    current: int = 0

    def next_step(self) -> Step | None:
        pending = [s for s in self.steps if s.status == "pending"]
        return pending[0] if pending else None

    def is_done(self) -> bool:
        return all(s.status == "done" for s in self.steps)


@dataclass
class PlanExecuteAgent:
    tools: dict[str, Callable[..., str]]
    max_replan_attempts: int = 3

    # ---- LLM stubs (replace with real calls) ----

    def _plan(self, goal: str) -> Plan:
        """Ask LLM to decompose goal into ordered steps."""
        print(f"[Planner] Decomposing: {goal}")
        # Stub: returns a single-step plan
        return Plan(goal=goal, steps=[
            Step(id=1, description=f"Execute: {goal}", tool="default", args={"query": goal})
        ])

    def _replan(self, plan: Plan, failed_step: Step) -> Plan:
        """Ask LLM to revise the plan given a failure."""
        print(f"[Replanner] Revising after failure at step {failed_step.id}")
        failed_step.status = "pending"
        failed_step.description += " (retry)"
        return plan

    def _execute_step(self, step: Step) -> str:
        tool_fn = self.tools.get(step.tool) or self.tools.get("default")
        if tool_fn is None:
            raise ValueError(f"No tool registered for '{step.tool}'")
        return tool_fn(**step.args)

    # ---- Main loop ----

    def run(self, goal: str) -> str:
        plan = self._plan(goal)
        replan_count = 0

        while not plan.is_done():
            step = plan.next_step()
            if step is None:
                break

            step.status = "running"
            try:
                step.result = self._execute_step(step)
                step.status = "done"
                print(f"[Executor] Step {step.id} done: {step.result[:80]}")
            except Exception as exc:
                step.status = "failed"
                print(f"[Executor] Step {step.id} failed: {exc}")

                if replan_count >= self.max_replan_attempts:
                    return f"Failed after {replan_count} replan attempts."
                plan = self._replan(plan, step)
                replan_count += 1

        results = [f"Step {s.id}: {s.result}" for s in plan.steps if s.result]
        return "\n".join(results) or "No results."


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    agent = PlanExecuteAgent(tools={
        "default": lambda query: f"[mock result for: {query}]",
        "search":  lambda query: f"[search: {query}]",
    })
    print(agent.run("Summarize the latest news about large language models"))
