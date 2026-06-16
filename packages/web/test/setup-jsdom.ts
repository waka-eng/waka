// Node 25 exposes an experimental global localStorage placeholder when
// --localstorage-file is unset. In Vitest+jsdom, that can shadow jsdom's
// complete Storage implementation with an object that lacks clear()/key().
// Test code and product code should still see browser-like Storage semantics.
function createStorage(): Storage {
  const items = new Map<string, string>();

  return {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key: string) {
      return items.get(String(key)) ?? null;
    },
    key(index: number) {
      return Array.from(items.keys())[index] ?? null;
    },
    removeItem(key: string) {
      items.delete(String(key));
    },
    setItem(key: string, value: string) {
      items.set(String(key), String(value));
    },
  };
}

if (typeof window !== "undefined") {
  const localStorage = window.localStorage;

  if (typeof localStorage?.clear !== "function") {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      enumerable: true,
      value: createStorage(),
    });
  }
}
