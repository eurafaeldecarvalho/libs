import { setTimeout as delay } from "node:timers/promises";

import { ProcessResponse, ProcessResponsePool, Response } from "./response.js";
import {
  Session,
  TLSSession,
  chrome,
  firefox,
  type RequestOptions,
  type SessionConstructorOptions,
} from "./session.js";

type RequestUrl = string | Iterable<string>;

export class TLSRequest {
  static readonly session_kwargs = new Set([
    "browser",
    "version",
    "os",
    "ja3_string",
    "h2_settings",
    "additional_decode",
    "pseudo_header_order",
    "priority_frames",
    "header_order",
    "force_http1",
    "catch_panics",
    "debug",
    "proxy",
    "proxies",
    "certificate_pinning",
    "disable_ipv6",
    "detect_encoding",
  ]);

  readonly method: string;
  readonly url: string;
  readonly raise_exception: boolean;
  readonly kwargs: RequestOptions;

  session: TLSSession | null;
  response: Response | null = null;
  exception: unknown = null;
  traceback: string | null = null;
  private readonly closeSessionWhenDone: boolean;
  private readonly sess_kwargs: SessionConstructorOptions | null;
  private index = -1;

  constructor(
    method: string,
    url: string,
    options: RequestOptions & SessionConstructorOptions & {
      params?: Record<string, string | number | boolean | Array<string | number | boolean>>;
      session?: TLSSession;
      raise_exception?: boolean;
      callback?: (response: Response) => void | Promise<void>;
    } = {},
  ) {
    this.method = method;
    this.raise_exception = options.raise_exception ?? true;
    this.url = options.params ? `${url}?${buildQueryString(options.params)}` : url;

    const { session, callback, params: _params, raise_exception: _raiseException, ...rest } = options;
    const sessionKeys = Object.keys(rest).filter((key) => TLSRequest.session_kwargs.has(key));

    if (session && sessionKeys.length > 0) {
      throw new TypeError(`Cannot pass session-only parameters to an existing session: ${sessionKeys.join(", ")}`);
    }

    this.sess_kwargs = sessionKeys.length > 0
      ? Object.fromEntries(sessionKeys.map((key) => [key, (rest as Record<string, unknown>)[key]])) as SessionConstructorOptions
      : null;

    this.kwargs = Object.fromEntries(
      Object.entries(rest).filter(([key]) => !TLSRequest.session_kwargs.has(key)),
    ) as RequestOptions;

    if (callback) {
      const currentHooks = this.kwargs.hooks || {};
      this.kwargs.hooks = {
        ...currentHooks,
        response: callback,
      };
    }

    if (session) {
      this.session = session;
      this.closeSessionWhenDone = false;
    } else {
      this.session = this.buildSession();
      this.closeSessionWhenDone = true;
    }
  }

  async send(extraOptions: RequestOptions = {}): Promise<this> {
    const mergedOptions = { ...this.kwargs, ...extraOptions };
    this.session ??= this.buildSession();

    try {
      this.response = await this.session.executeRequest(this.method, this.url, mergedOptions);
      const responseHook = mergedOptions.hooks?.response;
      if (this.response && responseHook) {
        await responseHook(this.response);
      }
    } catch (error) {
      if (this.raise_exception) {
        throw error;
      }

      this.exception = error;
      this.traceback = error instanceof Error ? error.stack || error.message : String(error);
    } finally {
      this.closeSession();
    }

    return this;
  }

  closeSession(): void {
    if (this.closeSessionWhenDone && this.session) {
      this.session.close();
      this.session = null;
    }
  }

  close_session(): void {
    this.closeSession();
  }

  setIndex(index: number): void {
    this.index = index;
  }

  getIndex(): number {
    return this.index;
  }

  private buildSession(): TLSSession {
    if (this.sess_kwargs) {
      return new Session({
        temp: true,
        ...this.sess_kwargs,
      });
    }

    return firefox.Session({ temp: true });
  }
}

export class LazyResponse {
  private readonly promise: Promise<Response>;
  private resolved: Response | null = null;
  complete = false;

  constructor(promise: Promise<Response>) {
    this.promise = promise.then((response) => {
      this.complete = true;
      this.resolved = response;
      return response;
    });
  }

  wait(): Promise<Response> {
    return this.promise;
  }

  join(): Promise<Response> {
    return this.wait();
  }

  json<T = unknown>(): Promise<T> {
    return this.wait().then((response) => response.json<T>());
  }

  render(options?: Record<string, unknown>): Promise<any> {
    return this.wait().then((response) => response.render(options));
  }

  get url(): Promise<string> {
    return this.wait().then((response) => response.url);
  }

  get status_code(): Promise<number> {
    return this.wait().then((response) => response.status_code);
  }

  get reason(): Promise<string> {
    return this.wait().then((response) => response.reason);
  }

  get ok(): Promise<boolean> {
    return this.wait().then((response) => response.ok);
  }

  get text(): Promise<string> {
    return this.wait().then((response) => response.text);
  }

  get content(): Promise<Buffer> {
    return this.wait().then((response) => response.content);
  }

  get headers(): Promise<any> {
    return this.wait().then((response) => response.headers);
  }

  get cookies(): Promise<any> {
    return this.wait().then((response) => response.cookies);
  }

  toString(): string {
    return this.complete && this.resolved ? this.resolved.toString() : "<LazyResponse[Pending]>";
  }
}

export class LazyTLSRequest extends LazyResponse {}

export class FailedResponse {
  readonly exception: unknown;

  constructor(exception: unknown) {
    this.exception = exception;
  }

  toString(): string {
    return String(this.exception);
  }
}

export function async_request(
  method: string,
  url: string,
  options: ConstructorParameters<typeof TLSRequest>[2] = {},
): TLSRequest {
  return new TLSRequest(method, url, {
    ...options,
    raise_exception: options.raise_exception ?? false,
  });
}

export async function request(
  method: string,
  url: RequestUrl,
  options: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {},
): Promise<Response | LazyResponse | Array<Response | LazyResponse | FailedResponse | unknown>> {
  if (typeof url !== "string") {
    return requestList(method, Array.from(url), options);
  }

  if (options.nohup) {
    const req = new TLSRequest(method, url, options);
    return new LazyTLSRequest(req.send().then((result) => {
      if (!result.response) {
        throw result.exception;
      }

      return result.response;
    }));
  }

  const req = new TLSRequest(method, url, options);
  const result = await req.send();
  if (!result.response) {
    throw result.exception;
  }
  return result.response;
}

export function get(url: RequestUrl, options: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {}) {
  return request("GET", url, options);
}

export function post(url: RequestUrl, options: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {}) {
  return request("POST", url, options);
}

export function options(url: RequestUrl, options_: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {}) {
  return request("OPTIONS", url, options_);
}

export function head(url: RequestUrl, options_: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {}) {
  return request("HEAD", url, options_);
}

export function put(url: RequestUrl, options_: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {}) {
  return request("PUT", url, options_);
}

export function patch(url: RequestUrl, options_: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {}) {
  return request("PATCH", url, options_);
}

export function del(url: RequestUrl, options_: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean } = {}) {
  return request("DELETE", url, options_);
}

export const remove = del;
export const async_get = (url: string, options?: ConstructorParameters<typeof TLSRequest>[2]) => async_request("GET", url, options);
export const async_post = (url: string, options?: ConstructorParameters<typeof TLSRequest>[2]) => async_request("POST", url, options);
export const async_options = (url: string, options?: ConstructorParameters<typeof TLSRequest>[2]) => async_request("OPTIONS", url, options);
export const async_head = (url: string, options?: ConstructorParameters<typeof TLSRequest>[2]) => async_request("HEAD", url, options);
export const async_put = (url: string, options?: ConstructorParameters<typeof TLSRequest>[2]) => async_request("PUT", url, options);
export const async_patch = (url: string, options?: ConstructorParameters<typeof TLSRequest>[2]) => async_request("PATCH", url, options);
export const async_delete = (url: string, options?: ConstructorParameters<typeof TLSRequest>[2]) => async_request("DELETE", url, options);

export function send(requestItem: TLSRequest): Promise<TLSRequest> {
  return requestItem.send();
}

export async function map(
  requests: Iterable<TLSRequest>,
  size?: number,
  exception_handler?: (request: TLSRequest, exception: unknown) => unknown,
): Promise<Array<Response | FailedResponse | unknown>> {
  const requestsList = Array.from(requests);
  const responses: Array<Response | FailedResponse | unknown> = [];

  const chunkSize = size || requestsList.length || 1;
  for (let offset = 0; offset < requestsList.length; offset += chunkSize) {
    const currentRange = requestsList.slice(offset, offset + chunkSize);
    const processed = currentRange.map((req) => {
      if (!req.session) {
        throw new Error("TLSRequest session was not initialized");
      }

      return req.session.request(req.method, req.url, {
        ...req.kwargs,
        process: false,
      }) as ProcessResponse;
    });

    try {
      const result = await new ProcessResponsePool(processed).executePool();
      responses.push(...result);
    } catch (error) {
      for (const req of currentRange) {
        req.exception = error;
        req.traceback = error instanceof Error ? error.stack || error.message : String(error);
        if (req.raise_exception) {
          throw error;
        }
        responses.push(exception_handler ? exception_handler(req, error) : new FailedResponse(error));
      }
    } finally {
      for (const req of currentRange) {
        req.closeSession();
      }
    }
  }

  return responses;
}

export async function* imap(
  requests: Iterable<TLSRequest>,
  size = 2,
  exception_handler?: (request: TLSRequest, exception: unknown) => unknown,
): AsyncGenerator<Response | FailedResponse | unknown> {
  for await (const [, response] of imap_enum(requests, size, exception_handler)) {
    yield response;
  }
}

export async function* imap_enum(
  requests: Iterable<TLSRequest>,
  size = 2,
  exception_handler?: (request: TLSRequest, exception: unknown) => unknown,
): AsyncGenerator<[number, Response | FailedResponse | unknown]> {
  const queue = Array.from(requests);
  queue.forEach((requestItem, index) => requestItem.setIndex(index));
  const active = new Set<Promise<{ request: TLSRequest; index: number }>>();

  const spawn = (requestItem: TLSRequest): Promise<{ request: TLSRequest; index: number }> =>
    requestItem.send().then((result) => ({ request: result, index: requestItem.getIndex() }));

  while (queue.length > 0 || active.size > 0) {
    while (queue.length > 0 && active.size < size) {
      const requestItem = queue.shift();
      if (!requestItem) {
        break;
      }

      const promise = spawn(requestItem).finally(() => {
        active.delete(promise);
      });

      active.add(promise);
    }

    if (active.size === 0) {
      await delay(0);
      continue;
    }

    const settled = await Promise.race(active);
    if (settled.request.response) {
      yield [settled.index, settled.request.response];
      continue;
    }

    const failure = exception_handler
      ? exception_handler(settled.request, settled.request.exception)
      : new FailedResponse(settled.request.exception);

    yield [settled.index, failure];
  }
}

async function requestList(
  method: string,
  urls: string[],
  options: ConstructorParameters<typeof TLSRequest>[2] & { nohup?: boolean },
): Promise<Array<Response | LazyResponse | FailedResponse | unknown>> {
  if (options.nohup) {
    return urls.map((url) => {
      const req = new TLSRequest(method, url, options);
      return new LazyTLSRequest(req.send().then((result) => {
        if (!result.response) {
          throw result.exception;
        }

        return result.response;
      }));
    });
  }

  const requests = urls.map((url) => async_request(method, url, options));
  return map(requests);
}

function buildQueryString(
  params: Record<string, string | number | boolean | Array<string | number | boolean>>,
): string {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        searchParams.append(key, String(item));
      }
      continue;
    }

    searchParams.append(key, String(value));
  }

  return searchParams.toString();
}

export { chrome, firefox, Session };

declare module "./session.js" {
  interface TLSSession {
    async_get(url: string, options?: ConstructorParameters<typeof TLSRequest>[2]): TLSRequest;
    async_post(url: string, options?: ConstructorParameters<typeof TLSRequest>[2]): TLSRequest;
    async_options(url: string, options?: ConstructorParameters<typeof TLSRequest>[2]): TLSRequest;
    async_head(url: string, options?: ConstructorParameters<typeof TLSRequest>[2]): TLSRequest;
    async_put(url: string, options?: ConstructorParameters<typeof TLSRequest>[2]): TLSRequest;
    async_patch(url: string, options?: ConstructorParameters<typeof TLSRequest>[2]): TLSRequest;
    async_delete(url: string, options?: ConstructorParameters<typeof TLSRequest>[2]): TLSRequest;
  }
}

TLSSession.prototype.async_get = function async_get_bound(url: string, options = {}) {
  return async_get(url, { ...options, session: this });
};

TLSSession.prototype.async_post = function async_post_bound(url: string, options = {}) {
  return async_post(url, { ...options, session: this });
};

TLSSession.prototype.async_options = function async_options_bound(url: string, options = {}) {
  return async_options(url, { ...options, session: this });
};

TLSSession.prototype.async_head = function async_head_bound(url: string, options = {}) {
  return async_head(url, { ...options, session: this });
};

TLSSession.prototype.async_put = function async_put_bound(url: string, options = {}) {
  return async_put(url, { ...options, session: this });
};

TLSSession.prototype.async_patch = function async_patch_bound(url: string, options = {}) {
  return async_patch(url, { ...options, session: this });
};

TLSSession.prototype.async_delete = function async_delete_bound(url: string, options = {}) {
  return async_delete(url, { ...options, session: this });
};
