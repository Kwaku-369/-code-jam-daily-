/**
 * KV-backed Circuit Breaker — Cloudflare Workers edition
 * State persists across Worker invocations via KV.
 */

import type { CircuitBreakerState, CircuitState } from "./types";
import { CIRCUIT_DEFAULTS, CircuitOpenError } from "./types";

export class KVCircuitBreaker {
  constructor(
    private readonly kv: KVNamespace,
    private readonly name: string,
    private readonly opts = CIRCUIT_DEFAULTS,
  ) {}

  private key(): string { return `cb:${this.name}`; }

  private async getState(): Promise<CircuitBreakerState> {
    const raw = await this.kv.get(this.key());
    if (!raw) return { state: "CLOSED", failures: 0, lastFailureAt: 0, nextRetryAt: 0 };
    return JSON.parse(raw) as CircuitBreakerState;
  }

  private async setState(s: CircuitBreakerState): Promise<void> {
    await this.kv.put(this.key(), JSON.stringify(s), { expirationTtl: 3600 });
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    const s = await this.getState();
    const now = Date.now();

    if (s.state === "OPEN") {
      if (now < s.nextRetryAt) throw new CircuitOpenError(this.name);
      // Transition to HALF_OPEN — allow one probe
      await this.setState({ ...s, state: "HALF_OPEN" });
    }

    try {
      const result = await fn();
      // Success — reset on CLOSED or HALF_OPEN
      if (s.state !== "CLOSED" || s.failures > 0) {
        await this.setState({ state: "CLOSED", failures: 0, lastFailureAt: 0, nextRetryAt: 0 });
      }
      return result;
    } catch (err) {
      const failures = s.failures + 1;
      if (failures >= this.opts.failureThreshold || s.state === "HALF_OPEN") {
        await this.setState({
          state: "OPEN",
          failures,
          lastFailureAt: now,
          nextRetryAt: now + this.opts.openDurationMs,
        });
      } else {
        await this.setState({ ...s, state: "CLOSED", failures, lastFailureAt: now });
      }
      throw err;
    }
  }
}

// Exponential backoff retry (for transient failures before circuit trips)
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 200,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, baseDelayMs * 2 ** i));
      }
    }
  }
  throw lastErr;
}
