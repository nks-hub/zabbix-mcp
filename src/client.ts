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
  private reqId = 1;

  constructor(private config: ZabbixConfig) {}

  async call<T>(method: string, params: unknown = {}): Promise<T> {
    const isLogin = method === "user.login";
    const auth = isLogin ? undefined : await this.getAuthTokenIfNeeded();

    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      method,
      params,
      id: this.reqId++,
    };

    if (auth) {
      body.auth = auth;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json-rpc",
      Accept: "application/json",
    };

    if (this.config.apiToken) {
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
