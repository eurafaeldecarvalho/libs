export { HTML, Element } from "./html/parser.js";
export { BrowserEngine, findBrowserExecutable } from "./browser/browser-engine.js";
export { BrowserSession, render } from "./browser/browser-session.js";

export {
  Session,
  TLSSession,
  chrome,
  firefox,
  type RequestOptions,
  type RequestParams,
  type RequestProxies,
  type RequestFiles,
  type RequestData,
  type ResponseHook,
  type SessionConstructorOptions,
  type TLSSessionOptions,
} from "./core/session.js";

export { Response, ProcessResponse, ProcessResponsePool, parseHeaderLinks } from "./core/response.js";
export { CaseInsensitiveDict } from "./core/case-insensitive-dict.js";
export {
  RequestsCookieJar,
  CookieConflictError,
  cookieJarFromDict,
  cookieJarToList,
  extractCookiesToJar,
  getCookieHeader,
  listToCookieJar,
  mergeCookies,
  type CookieRecord,
} from "./core/cookies.js";
export { BaseProxy, DatacenterProxy, MobileProxy, ResidentialProxy, evomi } from "./core/proxies.js";
export {
  CacheDisabledError,
  BrowserException,
  BrowserTimeoutException,
  ClientException,
  EncodingNotFoundException,
  EnableMockHumanException,
  JavascriptException,
  MissingLibraryException,
  NotRenderedException,
  ProxyFormatException,
  SelectorNotFoundException,
} from "./core/errors.js";
export { HrequestsBridge, ensureBridgeBinary } from "./core/bridge.js";
export {
  FailedResponse,
  LazyTLSRequest,
  LazyResponse,
  TLSRequest,
  async_delete,
  async_get,
  async_head,
  async_options,
  async_patch,
  async_post,
  async_put,
  async_request,
  del as delete,
  get,
  head,
  imap,
  imap_enum,
  map,
  options,
  patch,
  post,
  put,
  request,
  send,
} from "./core/reqs.js";

export const BROWSER_SUPPORT = "1";
export const __author__ = "Rafael";
export const __version__ = "0.1.0";
export const __upstream__ = "hrequests@0.9.2";
