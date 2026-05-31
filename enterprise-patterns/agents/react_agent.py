"""
ReAct Agent Pattern (Reasoning + Acting)
-----------------------------------------
Pattern: Interleave chain-of-thought reasoning with action calls.
Sector:  Universal — search, data retrieval, decision support.
Source:  Yao et al. 2022; langchain-ai/langchain; openai/evals

Flow:
  Thought → Action → Observation → Thought → ... → Final Answer

Tradeoffs:
  + Transparent, debuggable reasoning trace
  + Works with any tool set
  - Latency grows linearly with reasoning steps
  - Prone to hallucinated tool calls without strict validation
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable
import re


@dataclass
class Tool:
    name: str
    description: str
    func: Callable[..., str]

    def run(self, *args, **kwargs) -> str:
        return self.func(*args, **kwargs)


@dataclass
class ReActAgent:
    """
    Minimal ReAct loop — no external LLM dependency so it runs standalone.
    Swap `_think` for an actual LLM call in production.
    """
    tools: list[Tool]
    max_steps: int = 10
    _history: list[dict] = field(default_factory=list)

    def _tool_map(self) -> dict[str, Tool]:
        return {t.name: t for t in self.tools}

    def _think(self, observation: str) -> tuple[str, str | None, str | None]:
        """
        In production replace with:
            response = llm.invoke(build_react_prompt(self._history, observation))
        Returns (thought, action_name, action_input).
        """
        # --- stub: parse LLM output that looks like:
        # Thought: I need to search for X
        # Action: search
        # Action Input: "X"
        thought = f"[stub] Processing observation: {observation}"
        action = None
        action_input = None
        return thought, action, action_input

    def _parse_llm_output(self, raw: str):
        thought = re.search(r"Thought:(.*?)(?=Action:|$)", raw, re.S)
        action  = re.search(r"Action:\s*(\w+)", raw)
        a_input = re.search(r"Action Input:\s*(.+)", raw)
        final   = re.search(r"Final Answer:(.*)", raw, re.S)
        return (
            thought.group(1).strip() if thought else "",
            action.group(1).strip()  if action  else None,
            a_input.group(1).strip() if a_input else None,
            final.group(1).strip()   if final   else None,
        )

    def run(self, question: str) -> str:
        tool_map = self._tool_map()
        tool_descriptions = "\n".join(
            f"  {t.name}: {t.description}" for t in self.tools
        )
        self._history = [{"role": "system", "content": (
            f"You are a ReAct agent. Available tools:\n{tool_descriptions}\n"
            "Format: Thought / Action / Action Input / Observation / ... / Final Answer"
        )}, {"role": "user", "content": question}]

        observation = question
        for step in range(self.max_steps):
            thought, action_name, action_input = self._think(observation)
            self._history.append({"role": "assistant", "content": thought})

            if action_name is None:
                return thought  # stub exit; replace with Final Answer extraction

            if action_name not in tool_map:
                observation = f"Error: unknown tool '{action_name}'"
            else:
                observation = tool_map[action_name].run(action_input)

            self._history.append({"role": "tool", "content": observation})

        return "Max steps reached without final answer."


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    def mock_search(query: str) -> str:
        return f"[search result for '{query}'] Python is a high-level language."

    def mock_calculator(expr: str) -> str:
        try:
            return str(eval(expr, {"__builtins__": {}}))
        except Exception as e:
            return f"Error: {e}"

    agent = ReActAgent(tools=[
        Tool("search",     "Search the web for information",  mock_search),
        Tool("calculator", "Evaluate a math expression",       mock_calculator),
    ])

    result = agent.run("What is 2 ** 10 and what is Python?")
    print(result)
