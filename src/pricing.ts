/**
 * Per-model price table (USD per 1M tokens: [input, output]).
 * Rates are OpenAI-ish list prices, used only for cost *estimates*.
 * Unknown models cost 0 and log a one-time warning.
 */
const PRICES: Record<string, [number, number]> = {
  "gpt-4o": [2.5, 10],
  "gpt-4o-mini": [0.15, 0.6],
  "gpt-4.1": [2, 8],
  "gpt-4.1-mini": [0.4, 1.6],
  "gpt-4.1-nano": [0.1, 0.4],
  "o1": [15, 60],
  "o1-mini": [1.1, 4.4],
  "o3": [10, 40],
  "o3-mini": [1.1, 4.4],
  "o4-mini": [1.1, 4.4],
  "gpt-3.5-turbo": [0.5, 1.5],
};

const warned = new Set<string>();

export function estimateCostUsd(
  model: string,
  promptTokens: number | null,
  completionTokens: number | null,
): number {
  const price = PRICES[model];
  if (!price) {
    if (!warned.has(model)) {
      warned.add(model);
      console.warn(`[pricing] unknown model "${model}" — cost recorded as $0`);
    }
    return 0;
  }
  const [inputRate, outputRate] = price;
  return (
    ((promptTokens ?? 0) * inputRate + (completionTokens ?? 0) * outputRate) /
    1_000_000
  );
}
