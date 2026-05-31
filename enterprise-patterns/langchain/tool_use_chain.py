"""
LangChain — Tool Use / Function Calling Chain
----------------------------------------------
Pattern: Bind tools to an LLM so it can call structured functions.
         The chain decides when to call a tool vs. respond directly.
Source:  langchain-ai/langchain tool_use docs; OpenAI function_calling spec
Sector:  API automation, database queries, calculator chains, code execution.

Tradeoffs:
  + Structured, type-safe tool calls — no regex parsing of free text
  + Composable — chains can call chains as tools (nesting)
  - Requires a model that supports function calling (GPT-4, Claude 3+)
  - Tool schema design is critical — vague descriptions = poor tool selection
"""

from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Callable
import json


# ---- Tool schema (mirrors OpenAI function schema) ------------------------

@dataclass
class ToolSchema:
    name: str
    description: str
    parameters: dict           # JSON Schema object
    func: Callable[..., Any]

    def to_openai_spec(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            }
        }

    def call(self, **kwargs) -> str:
        result = self.func(**kwargs)
        return json.dumps(result) if not isinstance(result, str) else result


# ---- Tool registry -------------------------------------------------------

@dataclass
class ToolRegistry:
    _tools: dict[str, ToolSchema] = field(default_factory=dict)

    def register(self, tool: ToolSchema):
        self._tools[tool.name] = tool

    def get(self, name: str) -> ToolSchema | None:
        return self._tools.get(name)

    def schemas(self) -> list[dict]:
        return [t.to_openai_spec() for t in self._tools.values()]


# ---- Tool-use chain -------------------------------------------------------

@dataclass
class ToolUseChain:
    """
    Simulates an LLM → tool call → LLM loop.
    Replace `_call_llm` with actual SDK call:

        from anthropic import Anthropic
        client = Anthropic()
        response = client.messages.create(
            model="claude-opus-4-7",
            tools=self.registry.schemas(),
            messages=messages,
        )
    """
    registry: ToolRegistry
    model: str = "claude-opus-4-7"
    max_tool_calls: int = 5

    def _call_llm(self, messages: list[dict]) -> dict:
        """Stub LLM call. Returns a mock tool_use response."""
        user_msg = messages[-1]["content"]
        # Stub: if numbers in message, call calculator; else web_search
        if any(c.isdigit() for c in user_msg):
            return {
                "type": "tool_use",
                "name": "calculator",
                "input": {"expression": "2 + 2"},
            }
        return {
            "type": "text",
            "text": f"[LLM answer to: {user_msg[:60]}]",
        }

    def run(self, user_input: str) -> str:
        messages = [{"role": "user", "content": user_input}]

        for _ in range(self.max_tool_calls):
            response = self._call_llm(messages)

            if response["type"] == "text":
                return response["text"]

            if response["type"] == "tool_use":
                tool_name   = response["name"]
                tool_input  = response.get("input", {})
                tool_schema = self.registry.get(tool_name)

                if tool_schema is None:
                    tool_result = f"Error: tool '{tool_name}' not found"
                else:
                    try:
                        tool_result = tool_schema.call(**tool_input)
                    except Exception as exc:
                        tool_result = f"Tool error: {exc}"

                print(f"[Chain] Tool call: {tool_name}({tool_input}) → {tool_result[:80]}")

                # Add tool result to message history
                messages.append({"role": "assistant", "content": json.dumps(response)})
                messages.append({"role": "tool", "name": tool_name, "content": tool_result})

        return "Max tool calls reached."


# ---------------------------------------------------------------------------
# Usage example
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    registry = ToolRegistry()

    registry.register(ToolSchema(
        name="calculator",
        description="Evaluate a safe arithmetic expression",
        parameters={
            "type": "object",
            "properties": {"expression": {"type": "string", "description": "e.g. '2 + 2'"}},
            "required": ["expression"],
        },
        func=lambda expression: eval(expression, {"__builtins__": {}}),
    ))

    registry.register(ToolSchema(
        name="web_search",
        description="Search the web for current information",
        parameters={
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
        func=lambda query: f"[web results for: {query}]",
    ))

    chain = ToolUseChain(registry=registry)
    print(chain.run("What is 123 * 456?"))
    print(chain.run("Who won the latest World Cup?"))
