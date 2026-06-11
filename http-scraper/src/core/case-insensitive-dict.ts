export class CaseInsensitiveDict<T = string> implements Iterable<[string, T]> {
  private readonly store = new Map<string, { key: string; value: T }>();

  constructor(data?: Iterable<[string, T]> | Record<string, T> | CaseInsensitiveDict<T>) {
    if (data) {
      this.update(data);
    }
  }

  set(key: string, value: T): this {
    this.store.set(key.toLowerCase(), { key, value });
    return this;
  }

  get(key: string): T | undefined;
  get(key: string, defaultValue: T): T;
  get(key: string, defaultValue?: T): T | undefined {
    return this.store.get(key.toLowerCase())?.value ?? defaultValue;
  }

  has(key: string): boolean {
    return this.store.has(key.toLowerCase());
  }

  delete(key: string): boolean {
    return this.store.delete(key.toLowerCase());
  }

  clear(): void {
    this.store.clear();
  }

  copy(): CaseInsensitiveDict<T> {
    return new CaseInsensitiveDict<T>(this.entries());
  }

  update(data: Iterable<[string, T]> | Record<string, T> | CaseInsensitiveDict<T>): this {
    if (data instanceof CaseInsensitiveDict) {
      for (const [key, value] of data.entries()) {
        this.set(key, value);
      }
      return this;
    }

    if (isIterable(data)) {
      for (const [key, value] of data) {
        this.set(key, value);
      }
      return this;
    }

    for (const [key, value] of Object.entries(data)) {
      this.set(key, value);
    }

    return this;
  }

  entries(): Array<[string, T]> {
    return Array.from(this.store.values(), ({ key, value }) => [key, value]);
  }

  keys(): string[] {
    return Array.from(this.store.values(), ({ key }) => key);
  }

  values(): T[] {
    return Array.from(this.store.values(), ({ value }) => value);
  }

  lowerItems(): Array<[string, T]> {
    return Array.from(this.store.entries(), ([key, entry]) => [key, entry.value]);
  }

  toJSON(): Record<string, T> {
    return Object.fromEntries(this.entries());
  }

  get size(): number {
    return this.store.size;
  }

  [Symbol.iterator](): Iterator<[string, T]> {
    return this.entries()[Symbol.iterator]();
  }
}

function isIterable<T>(value: unknown): value is Iterable<T> {
  return Boolean(value) && typeof (value as Iterable<T>)[Symbol.iterator] === "function";
}