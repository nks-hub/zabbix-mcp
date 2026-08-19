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
        droppedCount: data.length - kept,
        hint: `Response exceeded ${CHARACTER_LIMIT} chars. Returned ${kept} of ${data.length} items. Narrow with filters or smaller pageSize.`,
      },
      null,
      2
    );
  }

  return (
    json.slice(0, CHARACTER_LIMIT - 100) +
    `\n\n[TRUNCATED at ${CHARACTER_LIMIT} chars - single-object response too large; narrow your query]`
  );
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

/**
 * Build RPC pagination parameters.
 *
 * The Zabbix API has no `offset` parameter on any `.get` method. Strict methods
 * (hostgroup.get, problem.get, event.get, history.get) reject it with
 * `unexpected parameter "offset"`; the rest silently ignore it and hand back
 * page 1 again. So it is never sent.
 *
 *  - `clientSlice: true`  - over-fetch `offset + limit` rows under a stable sort
 *                           and let the caller drop the leading `offset` rows.
 *  - `clientSlice: false` - page > 1 throws, because the result set is unbounded
 *                           and the caller must continue via a time/eventid cursor.
 *
 * ponytail: over-fetching costs offset+limit rows per page; fine for bounded
 * sets (groups, hosts, triggers, items). Switch to keyset paging if someone
 * really walks thousands of pages.
 */
export function rpcPaginationParams(
  pg: PaginationParams,
  options: { clientSlice: boolean; methodLabel?: string } = { clientSlice: true }
): { limit: number } {
  if (options.clientSlice) {
    return { limit: pg.offset + pg.limit };
  }
  if (pg.page > 1) {
    const label = options.methodLabel ?? "this Zabbix method";
    throw new Error(
      `${label} does not support offset-based pagination. ` +
        `For page > 1, use cursor-style continuation: pass \`till\` (or method-specific time filter) ` +
        `set to the previous page's last \`clock\`/\`eventid\` value, or narrow with filters.`
    );
  }
  return { limit: pg.limit };
}

/** Drop the leading `offset` rows from an over-fetched result set. */
export function slicePage<T>(rows: T[], pg: PaginationParams): T[] {
  return pg.offset > 0 ? rows.slice(pg.offset) : rows;
}

export interface PaginatedEnvelopeOptions {
  /**
   * Optional continuation hint extracted from the last item (e.g. `{ eventid, clock }`).
   * Surfaces a stable reference the model can use after compaction without
   * needing to rescan the data array.
   */
  lastSeen?: Record<string, unknown>;
  /**
   * Optional echo of the resolved query filters, so the model can see the
   * filter context that produced this page even if the original tool call
   * has been compacted out of the conversation.
   */
  query?: Record<string, unknown>;
}

export interface PaginatedEnvelope {
  data: unknown[];
  pagination: {
    page: number;
    pageSize: number;
    returned: number;
    hasMore: boolean;
    nextPage?: number;
    truncated?: boolean;
    droppedCount?: number;
    hint?: string;
  };
  lastSeen?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

/**
 * Build a paginated envelope and return both the structured object (for
 * `structuredContent`) and the JSON text (for `content`). When the JSON would
 * exceed CHARACTER_LIMIT, the data array is binary-search-trimmed and the
 * pagination block is annotated with `truncated`, `droppedCount`, and a `hint`.
 */
export function buildPaginatedEnvelope(
  data: unknown[],
  pg: PaginationParams,
  options: PaginatedEnvelopeOptions = {}
): { text: string; structured: PaginatedEnvelope } {
  const hasMore = data.length === pg.pageSize;
  const baseEnvelope: PaginatedEnvelope = {
    data,
    pagination: {
      page: pg.page,
      pageSize: pg.pageSize,
      returned: data.length,
      hasMore,
      ...(hasMore ? { nextPage: pg.page + 1 } : {}),
    },
    ...(options.lastSeen ? { lastSeen: options.lastSeen } : {}),
    ...(options.query ? { query: options.query } : {}),
  };

  const fullJson = JSON.stringify(baseEnvelope, null, 2);
  if (fullJson.length <= CHARACTER_LIMIT) {
    return { text: fullJson, structured: baseEnvelope };
  }

  // Binary search for the maximum number of items that fit, leaving headroom
  // for the truncation metadata we will add to pagination.
  const headroom = 400;
  let lo = 1;
  let hi = data.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const attempt: PaginatedEnvelope = {
      ...baseEnvelope,
      data: data.slice(0, mid),
      pagination: { ...baseEnvelope.pagination, returned: mid },
    };
    if (JSON.stringify(attempt, null, 2).length <= CHARACTER_LIMIT - headroom) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const kept = Math.max(1, lo);
  const dropped = data.length - kept;
  const truncated: PaginatedEnvelope = {
    ...baseEnvelope,
    data: data.slice(0, kept),
    pagination: {
      ...baseEnvelope.pagination,
      returned: kept,
      hasMore: true,
      nextPage: pg.page + 1,
      truncated: true,
      droppedCount: dropped,
      hint: `Response exceeded ${CHARACTER_LIMIT} chars. Returned ${kept} of ${data.length} items from this page. Narrow with filters (hostIds, search, severity, time window) or use smaller pageSize.`,
    },
  };
  return { text: JSON.stringify(truncated, null, 2), structured: truncated };
}

/**
 * Deprecated: prefer buildPaginatedEnvelope which returns both text and
 * structured forms in one pass. Kept for backward compat with any external
 * callers; emits the same shape but without lastSeen / query metadata.
 */
export function paginatedResponse(data: unknown[], pagination: PaginationParams): string {
  return buildPaginatedEnvelope(data, pagination).text;
}

export function paginatedSingleResponse(data: unknown): string {
  return truncateResponse(data);
}

/**
 * Extract a stable continuation reference from the last item in a sorted page.
 * Returns undefined when the array is empty or the requested fields are missing.
 */
export function lastSeenFrom(data: unknown[], fields: string[]): Record<string, unknown> | undefined {
  if (!data.length) return undefined;
  const last = data[data.length - 1];
  if (!last || typeof last !== "object") return undefined;
  const rec = last as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let any = false;
  for (const f of fields) {
    if (rec[f] !== undefined) {
      out[f] = rec[f];
      any = true;
    }
  }
  return any ? out : undefined;
}
