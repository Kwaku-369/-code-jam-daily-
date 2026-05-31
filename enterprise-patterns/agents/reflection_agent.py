"""
Reflection / Self-Critique Agent Pattern
------------------------------------------
Pattern: Agent generates a response, then critiques its own output and
         iteratively improves it until quality threshold is met.
Sector:  Code generation, content creation, financial report drafting,
         legal document review.

Variants:
  - Basic Reflection:  generate → critique → revise
  - Reflexion (Shinn et al. 2023): adds episodic memory of past failures
  - Constitutional AI style: uses a "constitution" as critique rubric

Tradeoffs:
  + Dramatically improves output quality on complex tasks
  + Self-contained — no human feedback loop needed
  - 2-3x token cost per final answer
  - Risk of sycophantic revision (LLM agrees with its own critique)
"""

from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class ReflectionAgent:
    """
    Basic generate → critique → revise loop.
    Swap the three `_*` stub methods for real LLM calls.
    """
    max_iterations: int = 3
    quality_threshold: float = 0.8   # 0-1 score; replace with LLM-graded rubric
    memory: list[str] = field(default_factory=list)

    # ---- LLM stubs ----

    def _generate(self, task: str, prior_critique: str = "") -> str:
        context = f"\nPrior critique: {prior_critique}" if prior_critique else ""
        print(f"[Generator] Task: {task}{context}")
        return f"[stub response to: {task}]"

    def _critique(self, task: str, response: str) -> tuple[str, float]:
        """Returns (critique_text, quality_score 0-1)."""
        print(f"[Critic] Evaluating response...")
        # Stub: real impl calls LLM with a rubric prompt
        critique = "The response is a stub and needs real content."
        score = 0.5
        return critique, score

    def _revise(self, task: str, response: str, critique: str) -> str:
        print(f"[Reviser] Applying critique...")
        return f"[revised: {response} | critique applied: {critique[:40]}]"

    # ---- Reflexion memory (optional) ----

    def _load_memory(self) -> str:
        if not self.memory:
            return ""
        return "Past failures to avoid:\n" + "\n".join(f"- {m}" for m in self.memory[-5:])

    def _store_failure(self, critique: str):
        self.memory.append(critique[:120])

    # ---- Main loop ----

    def run(self, task: str) -> str:
        memory_ctx = self._load_memory()
        full_task = f"{task}\n{memory_ctx}".strip()

        response = self._generate(full_task)
        critique = ""

        for i in range(self.max_iterations):
            critique, score = self._critique(task, response)
            print(f"[Reflection] Iteration {i+1}/{self.max_iterations} — score: {score:.2f}")

            if score >= self.quality_threshold:
                print("[Reflection] Quality threshold reached.")
                break

            self._store_failure(critique)
            response = self._revise(task, response, critique)

        return response


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    agent = ReflectionAgent(max_iterations=3, quality_threshold=0.9)
    result = agent.run("Write a Python function that sorts a list of dicts by a given key.")
    print(f"\nFinal output:\n{result}")
