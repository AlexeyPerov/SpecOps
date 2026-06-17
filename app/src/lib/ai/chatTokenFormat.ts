import type { ChatTokenUsage } from "../domain/contracts";

/**
 * Compact token-count formatting shared by the step separator, the per-message
 * totals footer, and the session-total header. Large counts are shortened to a
 * number + suffix (k/M) so the rendering stays compact on long runs. A
 * non-positive or non-finite value renders as "0".
 */
export function formatTokenCount(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0";
  }
  if (value >= 1_000_000) {
    return `${trim(value / 1_000_000)}M`;
  }
  if (value >= 1_000) {
    return `${trim(value / 1_000)}k`;
  }
  return String(Math.round(value));
}

/**
 * Cost formatting shared across the cost renderers. Up to 4 decimals for
 * sub-cent micro-steps, trimming trailing zeros. A non-positive or non-finite
 * cost renders as "$0.00".
 */
export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) {
    return "$0.00";
  }
  return `$${cost.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/** Cache read + write summed for the compact display (matches OpenCode Desktop). */
export function cacheTotal(tokens: ChatTokenUsage | undefined): number {
  if (!tokens) {
    return 0;
  }
  return tokens.cache.read + tokens.cache.write;
}

function trim(value: number): string {
  // One decimal place, strip trailing ".0".
  return value.toFixed(1).replace(/\.0$/, "");
}
