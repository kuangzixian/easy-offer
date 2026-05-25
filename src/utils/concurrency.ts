/**
 * Run an async mapper over a list with bounded concurrency.
 * Preserves input order in results. The mapper is invoked exactly once per item.
 *
 * Lightweight inline replacement for `p-limit` to avoid an extra dependency.
 */
export async function pMap<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  if (items.length === 0) return results

  const workerCount = Math.max(1, Math.min(concurrency, items.length))
  let next = 0

  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await fn(items[i], i)
    }
  })

  await Promise.all(workers)
  return results
}
