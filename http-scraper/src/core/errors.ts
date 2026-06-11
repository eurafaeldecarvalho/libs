export class ClientException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientException";
  }
}

export class BrowserException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrowserException";
  }
}

export class EnableMockHumanException extends BrowserException {
  constructor(message: string) {
    super(message);
    this.name = "EnableMockHumanException";
  }
}

export class BrowserTimeoutException extends BrowserException {
  constructor(message: string) {
    super(message);
    this.name = "BrowserTimeoutException";
  }
}

export class ProxyFormatException extends ClientException {
  constructor(message: string) {
    super(message);
    this.name = "ProxyFormatException";
  }
}

export class EncodingNotFoundException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncodingNotFoundException";
  }
}

export class SelectorNotFoundException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SelectorNotFoundException";
  }
}

export class NotRenderedException extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotRenderedException";
  }
}

export class MissingLibraryException extends ClientException {
  constructor(message: string) {
    super(message);
    this.name = "MissingLibraryException";
  }
}

export class CacheDisabledError extends BrowserException {
  constructor(message: string) {
    super(message);
    this.name = "CacheDisabledError";
  }
}

export class JavascriptException extends BrowserException {
  constructor(message: string) {
    super(message);
    this.name = "JavascriptException";
  }
}
