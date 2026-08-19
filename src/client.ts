import { REQUEST_TIMEOUT_MS } from "./constants.js";

export interface ZabbixConfig {
  url: string;
  apiToken?: string;
  username?: string;
  password?: string;
}

interface ZabbixRpcResponse<T> {
  jsonrpc: "2.0";
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: string;
  };
  id: number;
}

export class ZabbixClient {
  private authToken?: string;
  private versionPromise?: Promise<string>;
  private reqId = 1;

  constructor(private config: ZabbixConfig) {}

  async call<T>(method: string, params: unknown = {}): Promise<T> {
    // Zabbix forbids authentication on these methods (returns -32602 otherwise).
    const unauthenticated = method === "user.login" || method === "apiinfo.version";
    const auth = unauthenticated ? undefined : await this.getAuthTokenIfNeeded();
    // The Authorization: Bearer header only works from Zabbix 6.4 on; older
    // servers expect the API token in the request body like a session id.
    const bearerHeader = unauthenticated ? false : await this.supportsBearerHeader();

    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      method,
      params,
      id: this.reqId++,
    };

    const bodyAuth = auth ?? (this.config.apiToken && !unauthenticated && !bearerHeader ? this.config.apiToken : undefined);
    if (bodyAuth) {
      body.auth = bodyAuth;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json-rpc",
      Accept: "application/json",
    };

    if (this.config.apiToken && !unauthenticated && bearerHeader) {
      headers.Authorization = `Bearer ${this.config.apiToken}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(this.config.url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error(`Zabbix request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} from Zabbix API: ${text.slice(0, 300)}`);
    }

    const payload = (await res.json()) as ZabbixRpcResponse<T>;

    if (payload.error) {
      const detail = payload.error.data ? ` (${payload.error.data})` : "";
      throw new Error(`Zabbix RPC error ${payload.error.code}: ${payload.error.message}${detail}`);
    }

    return payload.result as T;
  }

  /** Cached apiinfo.version. Empty string when the server will not tell us. */
  async version(): Promise<string> {
    this.versionPromise ??= this.call<string>("apiinfo.version").catch(() => "");
    return this.versionPromise;
  }

  /** Bearer-token auth over the HTTP header landed in Zabbix 6.4. */
  private async supportsBearerHeader(): Promise<boolean> {
    if (!this.config.apiToken) return false;
    const [major, minor] = (await this.version()).split(".").map(Number);
    if (!major) return true;
    return major > 6 || (major === 6 && minor >= 4);
  }

  /**
   * `selectGroups` was replaced by `selectHostGroups` on host.get in Zabbix 6.2.
   * Older servers only know the former, newer ones silently ignore it and return
   * hosts with no group data at all, so the key has to follow the server version.
   */
  async hostGroupsSelectKey(): Promise<"selectGroups" | "selectHostGroups"> {
    const [major, minor] = (await this.version()).split(".").map(Number);
    if (!major) return "selectHostGroups";
    return major > 6 || (major === 6 && minor >= 2) ? "selectHostGroups" : "selectGroups";
  }

  private async getAuthTokenIfNeeded(): Promise<string | undefined> {
    if (this.config.apiToken) {
      return undefined;
    }

    if (this.authToken) {
      return this.authToken;
    }

    if (!this.config.username || !this.config.password) {
      return undefined;
    }

    this.authToken = await this.call<string>("user.login", {
      username: this.config.username,
      password: this.config.password,
    });

    return this.authToken;
  }
}

export function normalizeZabbixUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (trimmed.endsWith("/api_jsonrpc.php")) {
    return trimmed;
  }
  if (trimmed.endsWith("/zabbix")) {
    return `${trimmed}/api_jsonrpc.php`;
  }
  return `${trimmed}/api_jsonrpc.php`;
}
