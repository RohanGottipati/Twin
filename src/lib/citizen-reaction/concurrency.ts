/**
 * Minimal counter-based concurrency limiter. No p-limit/semaphore helper
 * existed anywhere in the TS codebase before this (Python side uses
 * ThreadPoolExecutor); this is the first one, kept intentionally small
 * rather than pulling in a dependency for one call site.
 */
export function runWithLimit<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      results[index] = await tasks[index]();
    }
  }

  const workerCount = Math.max(1, Math.min(limit, tasks.length));
  return Promise.all(Array.from({ length: workerCount }, worker)).then(() => results);
}
