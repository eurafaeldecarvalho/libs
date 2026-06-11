import { URL } from "node:url";

import { load } from "cheerio";

import { NotRenderedException, SelectorNotFoundException } from "../core/errors.js";

import type { Session, TLSSession } from "../core/session.js";

const DEFAULT_URL = "https://example.org/";
const DEFAULT_NEXT_SYMBOL = ["next", "more", "older"];

type BrowserLikeSession = {
  awaitSelector: (...args: any[]) => Promise<unknown>;
  awaitEnabled: (...args: any[]) => Promise<unknown>;
  isVisible: (...args: any[]) => Promise<boolean>;
  isEnabled: (...args: any[]) => Promise<boolean>;
  dragTo: (...args: any[]) => Promise<unknown>;
  type: (...args: any[]) => Promise<unknown>;
  click: (...args: any[]) => Promise<unknown>;
  hover: (...args: any[]) => Promise<unknown>;
  screenshot: (...args: unknown[]) => Promise<unknown>;
};

type FindOptions = {
  containing?: string | string[];
  first?: boolean;
  raise_exception?: boolean;
  exception_handler?: () => unknown;
  attrs?: Record<string, string>;
};

type ParserCtorOptions = {
  $: ReturnType<typeof load>;
  element: any;
  url: string;
  br_session?: BrowserLikeSession | null;
};

export class BaseParser {
  protected readonly $: ReturnType<typeof load>;
  protected readonly element: any;
  readonly url: string;
  readonly br_session: BrowserLikeSession | null;
  skip_anchors = true;

  constructor(options: ParserCtorOptions) {
    this.$ = options.$;
    this.element = options.element;
    this.url = options.url;
    this.br_session = options.br_session ?? null;
  }

  get css_path(): string {
    const first = this.element.get?.(0);
    if (!first) {
      return "";
    }

    const segments: string[] = [];
    let current = first;

    while (current && current.type !== "root") {
      if (current.type !== "tag") {
        current = current.parent;
        continue;
      }

      const siblings = (current.parent?.children || []).filter(
        (node: any) => node.type === "tag" && node.name === current.name,
      );
      const index = siblings.indexOf(current) + 1;
      segments.push(`${current.name}:nth-of-type(${index})`);
      current = current.parent;
    }

    return segments.reverse().join(" > ");
  }

  get raw_html(): Buffer {
    return Buffer.from(this.html);
  }

  get html(): string {
    return this.$.html(this.element) || "";
  }

  get text(): string {
    return this.get_text();
  }

  get full_text(): string {
    return this.element.text();
  }

  get_text(_children = true, separator = "\n", strip = false): string {
    const text = this.element.text().replace(/\s*\n\s*/g, separator);
    return strip ? text.trim() : text;
  }

  find_all(selector = "*", other_kwargs: Record<string, string> | null = null, options: FindOptions = {}): Element[] | Element | null {
    const { containing, first = false, raise_exception = true, attrs = {} } = options;
    const selectorWithAttributes = withAttributes(selector, other_kwargs, attrs);
    const query = this.query(selectorWithAttributes);

    if (first) {
      const firstElement = query.first();
      if (firstElement.length === 0) {
        if (!raise_exception) {
          return null;
        }

        throw new SelectorNotFoundException(`No elements were found with selector '${selectorWithAttributes}'.`);
      }

      const wrapped = new Element({ $: this.$, element: firstElement, url: this.url, br_session: this.br_session });
      if (!matchesContaining(wrapped, containing)) {
        if (!raise_exception) {
          return null;
        }

        throw new SelectorNotFoundException(`No elements were found with selector '${selectorWithAttributes}'.`);
      }

      return wrapped;
    }

    return query
      .toArray()
      .map((node: any) => new Element({ $: this.$, element: this.$(node), url: this.url, br_session: this.br_session }))
      .filter((element: Element) => matchesContaining(element, containing));
  }

  find(selector = "*", other_kwargs: Record<string, string> | null = null, options: FindOptions = {}): Element | null {
    try {
      return this.find_all(selector, other_kwargs, {
        ...options,
        first: true,
      }) as Element | null;
    } catch (error) {
      if (options.exception_handler) {
        return options.exception_handler() as Element | null;
      }

      throw error;
    }
  }

  search(template: string): string[] | null {
    const regexp = templateToRegExp(template);
    const match = regexp.exec(this.html);
    return match ? match.slice(1) : null;
  }

  search_all(template: string): string[][] {
    const regexp = templateToRegExp(template, "g");
    const matches: string[][] = [];
    let match: RegExpExecArray | null;

    do {
      match = regexp.exec(this.html);
      if (match) {
        matches.push(match.slice(1));
      }
    } while (match);

    return matches;
  }

  get links(): Set<string> {
    const results = new Set<string>();

    for (const link of this.find_all("a") as Element[]) {
      const href = link.attrs.href;
      if (!href || typeof href !== "string") {
        continue;
      }

      if (href.startsWith("#") && this.skip_anchors) {
        continue;
      }

      if (href.startsWith("javascript:") || href.startsWith("mailto:")) {
        continue;
      }

      results.add(href.trim());
    }

    return results;
  }

  get absolute_links(): Set<string> {
    return new Set(Array.from(this.links, (link) => this.makeAbsolute(link)));
  }

  get base_url(): string {
    const base = this.find("base", null, { raise_exception: false });
    if (base && typeof base.attrs.href === "string" && base.attrs.href.trim()) {
      return base.attrs.href.trim();
    }

    const parsed = new URL(this.url);
    const parts = parsed.pathname.split("/");
    parts.pop();
    parsed.pathname = `${parts.join("/")}/`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  }

  protected query(selector: string): any {
    const first = this.element.get?.(0);
    if (!first || first.type === "root") {
      return this.$(selector);
    }

    return this.element.find(selector);
  }

  protected makeAbsolute(link: string): string {
    try {
      return new URL(link, this.base_url).toString();
    } catch {
      return link;
    }
  }
}

export class Element extends BaseParser {
  readonly tag: string;
  private cachedAttrs: Record<string, string | string[]> | null = null;

  constructor(options: ParserCtorOptions) {
    super(options);
    this.tag = this.element.get?.(0)?.name || "";
    this.defineAttributeAccessors();
  }

  get attrs(): Record<string, string | string[]> {
    if (!this.cachedAttrs) {
      const attrs = { ...(this.element.attr() || {}) } as Record<string, string>;
      const normalized: Record<string, string | string[]> = {};

      for (const [key, value] of Object.entries(attrs)) {
        if (key === "class" || key === "rel") {
          normalized[key] = value.split(/\s+/).filter(Boolean);
        } else {
          normalized[key] = value;
        }
      }

      this.cachedAttrs = normalized;
    }

    return this.cachedAttrs;
  }

  get id(): string | undefined {
    const value = this.attrs.id;
    return typeof value === "string" ? value : undefined;
  }

  async awaitSelector(timeout = 30): Promise<unknown> {
    return this.callBrowserMethod("awaitSelector", this.css_path, { timeout });
  }

  async awaitEnabled(timeout = 30): Promise<unknown> {
    return this.callBrowserMethod("awaitEnabled", this.css_path, { timeout });
  }

  async isVisible(): Promise<boolean> {
    return this.callBrowserMethod("isVisible", this.css_path) as Promise<boolean>;
  }

  async isEnabled(): Promise<boolean> {
    return this.callBrowserMethod("isEnabled", this.css_path) as Promise<boolean>;
  }

  async dragTo(target: string, options?: unknown): Promise<unknown> {
    return this.callBrowserMethod("dragTo", this.css_path, target, options);
  }

  async type(text: string, delay = 50, options?: unknown): Promise<unknown> {
    return this.callBrowserMethod("type", this.css_path, text, delay, options);
  }

  async click(button: "left" | "right" | "middle" = "left", count = 1, options?: unknown): Promise<unknown> {
    return this.callBrowserMethod("click", this.css_path, button, count, options);
  }

  async hover(modifiers?: string[], options?: unknown): Promise<unknown> {
    return this.callBrowserMethod("hover", this.css_path, modifiers, options);
  }

  async screenshot(...args: unknown[]): Promise<unknown> {
    return this.callBrowserMethod("screenshot", this.css_path, ...args);
  }

  toString(): string {
    const attrs = Object.entries(this.attrs)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(" ");
    return `<Element ${JSON.stringify(this.tag)} ${attrs}>`;
  }

  private async callBrowserMethod(method: keyof BrowserLikeSession, ...args: unknown[]): Promise<unknown> {
    if (!this.br_session) {
      throw new NotRenderedException(`Method ${String(method)} only allowed in BrowserSession`);
    }

    const fn = this.br_session[method] as (...methodArgs: unknown[]) => Promise<unknown>;
    return fn(...args);
  }

  private defineAttributeAccessors(): void {
    const rawAttributes = { ...(this.element.attr() || {}) } as Record<string, string>;

    for (const key of Object.keys(rawAttributes)) {
      if (isIdentifier(key)) {
        defineAttrAccessor(this, key, key);
      }

      const alias = ATTRIBUTE_ALIAS_MAP[key];
      if (alias) {
        defineAttrAccessor(this, alias, key);
      }
    }
  }
}

export class HTML extends BaseParser implements AsyncIterable<HTML>, Iterable<HTML> {
  readonly session: TLSSession | Session | null;
  readonly next_symbol: string[];

  constructor(options: { session?: TLSSession | null; url?: string; html: string | Buffer; br_session?: BrowserLikeSession | null }) {
    const source = Buffer.isBuffer(options.html) ? options.html.toString("utf-8") : options.html;
    const $ = load(source);
    super({
      $,
      element: $.root(),
      url: options.url || DEFAULT_URL,
      br_session: options.br_session ?? null,
    });

    this.session = options.session || null;
    this.next_symbol = [...DEFAULT_NEXT_SYMBOL];
  }

  next(fetch = false, next_symbol: string[] | null = null): string | Promise<HTML> | null {
    const symbols = next_symbol || DEFAULT_NEXT_SYMBOL;
    const candidates = this.find_all("a", null, { containing: symbols }) as Element[];
    let nextHref: string | null = null;

    for (const candidate of candidates) {
      const href = typeof candidate.attrs.href === "string" ? candidate.attrs.href : null;
      if (!href) {
        continue;
      }

      const rel = Array.isArray(candidate.attrs.rel) ? candidate.attrs.rel : [];
      const classes = Array.isArray(candidate.attrs.class) ? candidate.attrs.class : [];

      if (rel.includes("next") || classes.some((value) => value.includes("next")) || href.includes("page")) {
        nextHref = href;
        break;
      }
    }

    if (!nextHref) {
      const candidate = candidates.at(-1);
      if (candidate && typeof candidate.attrs.href === "string") {
        nextHref = candidate.attrs.href;
      }
    }

    if (!nextHref) {
      return null;
    }

    const absoluteUrl = this.makeAbsolute(nextHref);
    if (!fetch) {
      return absoluteUrl;
    }

    return this.fetchNextHtml(absoluteUrl);
  }

  add_next_symbol(nextSymbol: string): void {
    this.next_symbol.push(nextSymbol);
  }

  *[Symbol.iterator](): Iterator<HTML> {
    yield this;
  }

  [Symbol.asyncIterator](): AsyncIterator<HTML> {
    let queue: Array<HTML | Promise<HTML> | null> = [this];

    return {
      next: async () => {
        const current = queue.shift();
        if (!current) {
          return { done: true, value: undefined };
        }

        const resolved = await current;
        const next = resolved.next(true);
        if (next && typeof next !== "string") {
          queue.push(next);
        }

        return { done: false, value: resolved };
      },
    };
  }

  toString(): string {
    return `<HTML url=${JSON.stringify(this.url)}>`;
  }

  private async fetchNextHtml(url: string): Promise<HTML> {
    if (this.session) {
      return this.session.get(url).then((response) => response.html);
    }

    const { firefox } = await import("../core/session.js");
    const session = firefox.Session({ temp: true });
    const response = await session.get(url);
    return new HTML({
      session,
      url: response.url,
      html: response.content,
    });
  }
}

function withAttributes(selector: string, other_kwargs: Record<string, string> | null, kwargs: Record<string, string>): string {
  const merged = { ...(other_kwargs || {}), ...kwargs };
  if (Object.keys(merged).length === 0) {
    return selector;
  }

  let output = selector.trim();
  for (const [key, value] of Object.entries(merged)) {
    const mappedKey = ATTRIBUTE_MAP[key] || key;
    output += `[${mappedKey}="${value}"]`;
  }

  return output;
}

function matchesContaining(element: Element, containing?: string | string[]): boolean {
  if (!containing) {
    return true;
  }

  const values = Array.isArray(containing) ? containing : [containing];
  const text = element.full_text.toLowerCase();
  return values.some((value) => text.includes(value.toLowerCase()));
}

function templateToRegExp(template: string, flags = ""): RegExp {
  const escaped = escapeRegExp(template).replace(/\\\{[^}]*\\\}/g, "([\\s\\S]*?)");
  return new RegExp(escaped, flags);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const ATTRIBUTE_MAP: Record<string, string> = {
  class_: "class",
  for_: "for",
  async_: "async",
  accept_charset: "accept-charset",
  http_equiv: "http-equiv",
};

const ATTRIBUTE_ALIAS_MAP = Object.fromEntries(
  Object.entries(ATTRIBUTE_MAP).map(([alias, key]) => [key, alias]),
) as Record<string, string>;

function defineAttrAccessor(target: Element, property: string, attrKey: string): void {
  if (property in target) {
    return;
  }

  Object.defineProperty(target, property, {
    configurable: true,
    enumerable: false,
    get() {
      return target.attrs[attrKey];
    },
  });
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value);
}
