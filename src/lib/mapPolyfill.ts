/**
 * `Map.prototype.getOrInsert` / `getOrInsertComputed` (and the WeakMap pair) are
 * a very recent addition to the language. pdf.js 6 calls them freely, so on any
 * browser that predates them — Chrome 141 still does — every render throws
 * `getOrInsertComputed is not a function`.
 *
 * Importing this module first installs the missing methods. It must run in the
 * worker as well as on the main thread, which is what `pdfWorker.ts` is for.
 */

type Insertable<K, V> = {
  has(key: K): boolean;
  get(key: K): V | undefined;
  set(key: K, value: V): unknown;
};

function getOrInsert<K, V>(this: Insertable<K, V>, key: K, value: V): V {
  if (this.has(key)) return this.get(key) as V;
  this.set(key, value);
  return value;
}

function getOrInsertComputed<K, V>(this: Insertable<K, V>, key: K, compute: (key: K) => V): V {
  if (this.has(key)) return this.get(key) as V;
  const value = compute(key);
  this.set(key, value);
  return value;
}

function install(prototype: object): void {
  for (const [name, implementation] of [
    ['getOrInsert', getOrInsert],
    ['getOrInsertComputed', getOrInsertComputed],
  ] as const) {
    if (name in prototype) continue;
    Object.defineProperty(prototype, name, {
      value: implementation,
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
}

install(Map.prototype);
install(WeakMap.prototype);
