import { CHARACTER_LIMIT } from "./constants.js";

export function toUnix(value?: string): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return Math.floor(parsed / 1000);
}

export function pickDefined<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v;
  }
  return out;
}

export function truncateResponse(data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  if (json.length <= CHARACTER_LIMIT) return json;

  if (Array.isArray(data)) {
    const half = Math.max(1, Math.floor(data.length / 2));
    return JSON.stringify(
      {
        data: data.slice(0, half),
        truncated: true,
        message: `Truncated from ${data.length} to ${half} items. Use limit/pagination/time filters.`,
      },
      null,
      2
    );
  }

  return json.slice(0, CHARACTER_LIMIT) + `\n\n[Truncated at ${CHARACTER_LIMIT} characters]`;
}

export function safeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
