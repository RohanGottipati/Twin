/**
 * Deterministic queue primitives for the transit simulator. Everything here
 * is plain arithmetic over integers, no I/O, so the same inputs always
 * produce the same outputs. A seeded PRNG is included for forward
 * compatibility with future stochastic extensions (docs/techto-implementation.md
 * section 11.4: "use deterministic random seeds"), but the current
 * simulator does not need randomness to reproduce the flagship scenario.
 */

/** mulberry32: small, fast, deterministic PRNG. Not cryptographic; good enough for reproducible demo jitter. */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface BoardingOutcome {
  boarded: number;
  denied: number;
  remainingQueue: number;
}

/**
 * Boards as many riders as capacity allows, oldest arrivals first. Capacity
 * is floored and clamped to nonnegative before use, so a capacity that has
 * been reduced below zero by an intervention error never boards anyone
 * rather than throwing.
 */
export function boardQueue(queueLength: number, capacity: number): BoardingOutcome {
  const safeCapacity = Math.max(0, Math.floor(capacity));
  const boarded = Math.min(queueLength, safeCapacity);
  const denied = Math.max(0, queueLength - boarded);
  return { boarded, denied, remainingQueue: denied };
}

/** One arrival bucket: how many riders arrived at a given minute and how many of them are still waiting. */
export interface ArrivalBucket {
  minute: number;
  remaining: number;
}

export interface FifoBoardingResult {
  outcome: BoardingOutcome;
  /** Weighted wait samples consumed from the buckets: value is wait minutes, weight is rider count. */
  waitSamples: { value: number; weight: number }[];
}

/**
 * Boards `queueLength` total riders out of the given arrival buckets in
 * first-in-first-out order, mutating each bucket's `remaining` count in
 * place, and records how long each boarded rider waited. Buckets are
 * assumed to already be sorted by `minute` ascending.
 */
export function boardFifo(
  buckets: ArrivalBucket[],
  queueLength: number,
  capacity: number,
  currentMinute: number,
): FifoBoardingResult {
  const outcome = boardQueue(queueLength, capacity);
  const waitSamples: { value: number; weight: number }[] = [];

  let remainingToBoard = outcome.boarded;
  for (const bucket of buckets) {
    if (remainingToBoard <= 0) break;
    if (bucket.remaining <= 0) continue;
    const consumed = Math.min(bucket.remaining, remainingToBoard);
    bucket.remaining -= consumed;
    remainingToBoard -= consumed;
    waitSamples.push({ value: currentMinute - bucket.minute, weight: consumed });
  }

  return { outcome, waitSamples };
}

/** A minimal FIFO station queue: arrivals accumulate, boarding drains oldest arrivals first. */
export class StationQueue {
  private buckets: ArrivalBucket[] = [];
  private total = 0;

  get length(): number {
    return this.total;
  }

  arrive(minute: number, count: number): void {
    if (count <= 0) return;
    this.buckets.push({ minute, remaining: count });
    this.total += count;
  }

  board(capacity: number, currentMinute: number): FifoBoardingResult {
    const result = boardFifo(this.buckets, this.total, capacity, currentMinute);
    this.total = result.outcome.remainingQueue;
    return result;
  }

  /** Wait samples for every rider still queued when the observation window ends, one sample per bucket. */
  drainRemaining(windowEndMinute: number): { value: number; weight: number }[] {
    const samples: { value: number; weight: number }[] = [];
    for (const bucket of this.buckets) {
      if (bucket.remaining > 0) {
        samples.push({ value: windowEndMinute - bucket.minute, weight: bucket.remaining });
      }
    }
    return samples;
  }
}
