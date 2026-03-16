export const CHARACTER_LIMIT = 25000;
export const REQUEST_TIMEOUT_MS = 30000;
export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 500;

export const ZABBIX_SEVERITY_MAP: Record<number, string> = {
  0: "not_classified",
  1: "information",
  2: "warning",
  3: "average",
  4: "high",
  5: "disaster",
};
