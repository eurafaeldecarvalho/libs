export abstract class BaseProxy {
  protected readonly kwargs: Record<string, string>;

  protected constructor(kwargs: Record<string, string>) {
    this.kwargs = Object.fromEntries(
      Object.entries(kwargs).map(([name, value]) => [name, process.env[value] || value]),
    );
  }

  abstract readonly URL: string;
  abstract readonly SERVICE: string;

  toString(): string {
    return this.URL.replace(/\{(.*?)\}/g, (_, key: string) => this.kwargs[key] || "");
  }

  toJSON(): string {
    return this.toString();
  }
}

class EvomiProxy extends BaseProxy {
  private readonly autoRotate: boolean;
  protected readonly data: Record<string, string | undefined>;

  constructor(options: {
    username: string;
    key: string;
    country?: string;
    region?: string;
    city?: string;
    continent?: string;
    isp?: string;
    pool?: "standard" | "speed" | "quality";
    session_type?: "session" | "hardsession";
    auto_rotate?: boolean;
    lifetime?: number;
    adblock?: boolean;
  }) {
    const sessionType = options.session_type || "session";
    const autoRotate = Boolean(options.auto_rotate);

    if (sessionType === "hardsession" && options.lifetime !== undefined) {
      throw new Error("lifetime cannot be provided for hardsession");
    }

    if (options.lifetime !== undefined && options.lifetime > 120) {
      throw new Error("lifetime must be less than 120");
    }

    if (autoRotate && options.lifetime !== undefined) {
      throw new Error("lifetime cannot be provided for auto-rotate");
    }

    const data = {
      continent: toProxyFormat(options.continent),
      city: toProxyFormat(options.city),
      region: toProxyFormat(options.region),
      country: options.country,
      isp: options.isp,
      pool: options.pool,
      lifetime: options.lifetime?.toString(),
      adblock: options.adblock ? "1" : undefined,
      [sessionType]: autoRotate ? undefined : randomId(),
    };

    super({
      username: options.username,
      key: options.key,
      data: wrapProxyData(data),
    });

    this.autoRotate = autoRotate;
    this.data = data;
  }

  rotate(): void {
    if (this.autoRotate) {
      throw new Error("Cannot rotate an already auto-rotating proxy.");
    }

    this.data.session = randomId();
  }

  override toString(): string {
    return this.URL.replace(/\{(.*?)\}/g, (_, key: string) => {
      if (key === "data") {
        return wrapProxyData(this.data);
      }

      return this.kwargs[key] || "";
    });
  }

  readonly URL: string = "";
  readonly SERVICE: string = "Evomi";
}

export class ResidentialProxy extends EvomiProxy {
  override readonly URL = "http://{username}:{key}{data}@rp.evomi.com:1000";
  override readonly SERVICE = "Evomi Residential";
}

export class MobileProxy extends EvomiProxy {
  override readonly URL = "http://{username}:{key}{data}@mp.evomi.com:3000";
  override readonly SERVICE = "Evomi Mobile";
}

export class DatacenterProxy extends EvomiProxy {
  override readonly URL = "http://{username}:{key}{data}@dcp.evomi.com:2000";
  override readonly SERVICE = "Evomi Datacenter";
}

export const evomi = {
  ResidentialProxy,
  MobileProxy,
  DatacenterProxy,
};

function toProxyFormat(value?: string): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.toLowerCase().trim().split(/\s+/).join(".");
}

function wrapProxyData(data: Record<string, string | undefined>): string {
  let suffix = "";

  for (const [key, value] of Object.entries(data)) {
    if (value) {
      suffix += `_${key}-${value}`;
    }
  }

  return suffix;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 12);
}