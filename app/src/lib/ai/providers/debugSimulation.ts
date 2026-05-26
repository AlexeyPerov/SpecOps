import type { DebugProviderSettings } from "../../domain/contracts";

export interface DebugTurnSimulationPlan {
  delayMs: number;
  chunkSizes: number[];
  failRoll: number;
  shouldFail: boolean;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDebugSimulationRng(
  settings: DebugProviderSettings,
  turnKey: string,
): () => number {
  if (settings.simulationSeed === null) {
    return Math.random;
  }
  return createSeededRng(hashString(`${settings.simulationSeed}:${turnKey}`));
}

function randomInt(rng: () => number, min: number, max: number): number {
  if (min >= max) {
    return min;
  }
  return min + Math.floor(rng() * (max - min + 1));
}

export function computeChunkSizes(
  totalLength: number,
  settings: DebugProviderSettings,
  rng: () => number,
): number[] {
  if (totalLength <= 0) {
    return [];
  }

  const sizes: number[] = [];
  let remaining = totalLength;
  while (remaining > 0) {
    const chunkSize = Math.min(
      remaining,
      randomInt(rng, settings.chunkCharsMin, settings.chunkCharsMax),
    );
    sizes.push(Math.max(1, chunkSize));
    remaining -= sizes[sizes.length - 1];
  }
  return sizes;
}

export function deriveDebugTurnSimulation(
  settings: DebugProviderSettings,
  turnKey: string,
  responseLength: number,
): DebugTurnSimulationPlan {
  const rng = createDebugSimulationRng(settings, turnKey);
  const delayMs = randomInt(rng, settings.delayMsMin, settings.delayMsMax);
  const failRoll = rng();
  const shouldFail = failRoll < settings.failureProbability;
  const chunkSizes = computeChunkSizes(responseLength, settings, rng);

  return {
    delayMs,
    chunkSizes,
    failRoll,
    shouldFail,
  };
}

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function splitIntoChunks(content: string, chunkSizes: number[]): string[] {
  const chunks: string[] = [];
  let offset = 0;
  for (const size of chunkSizes) {
    if (offset >= content.length) {
      break;
    }
    chunks.push(content.slice(offset, offset + size));
    offset += size;
  }
  if (offset < content.length) {
    chunks.push(content.slice(offset));
  }
  return chunks;
}
