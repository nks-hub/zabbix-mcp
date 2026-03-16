import { CHARACTER_LIMIT, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./constants.js";

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
    // Binary search for the maximum number of items that fit within the character limit
    let lo = 1;
    let hi = data.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      const attempt = JSON.stringify(data.slice(0, mid), null, 2);
      if (attempt.length <= CHARACTER_LIMIT - 200) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const kept = Math.max(1, lo);
    return JSON.stringify(
      {
        data: data.slice(0, kept),
        truncated: true,
        totalCount: data.length,
        returnedCount: kept,
        message: `Showing ${kept} of ${data.length} items. Use filters (hostIds, search, keySearch) or a smaller limit to narrow results.`,
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

export interface PaginationInput {
  page?: number;
  pageSize?: number;
}

export interface PaginationParams {
  limit: number;
  offset: number;
  page: number;
  pageSize: number;
}

export function resolvePagination(input: PaginationInput): PaginationParams {
  const page = Math.max(1, input.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE));
  return {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    page,
    pageSize,
  };
}

export function paginatedResponse(data: unknown[], pagination: PaginationParams): string {
  const hasMore = data.length === pagination.pageSize;
  const envelope = {
    data,
    pagination: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      returned: data.length,
      hasMore,
      ...(hasMore ? { nextPage: pagination.page + 1 } : {}),
    },
  };
  return truncateResponse(envelope);
}

export function paginatedSingleResponse(data: unknown): string {
  return truncateResponse(data);
}
