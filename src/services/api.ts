import { getToken } from "./auth";

const BASE = "https://openapi.tidal.com/v2";

/* ---------- politeness: throttle, retry on 429, short-lived cache ---------- */

const MIN_GAP_MS = 250; // at most ~4 requests per second
const MAX_RETRIES = 5;
const CACHE_MS = 5 * 60 * 1000;

let nextSlot = 0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Spaces out request start times. A 429 pushes nextSlot forward, pausing everyone. */
async function throttle() {
  const now = Date.now();
  const start = Math.max(now, nextSlot);
  nextSlot = start + MIN_GAP_MS;
  if (start > now) await sleep(start - now);
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function fetchWithRetry<T>(
  url: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    await throttle();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${getToken()}`,
      accept: "application/vnd.api+json",
    };
    if (init.body !== undefined) headers["Content-Type"] = "application/vnd.api+json";

    const res = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });

    if (res.status === 429 && attempt < MAX_RETRIES) {
      // Retry-After may be hidden from browsers by CORS, so fall back to backoff.
      const header = Number(res.headers.get("Retry-After"));
      const base = header > 0 ? header * 1000 : 1000 * 2 ** attempt;
      const delay = Math.min(base, 30_000) + Math.random() * 250;
      nextSlot = Math.max(nextSlot, Date.now() + delay);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      const hint = res.status === 429 ? " (rate limited by TIDAL; wait a minute and retry)" : "";
      throw new ApiError(
        res.status,
        `${res.status} ${res.statusText}${body ? `: ${body}` : hint}`,
      );
    }

    // Writes may answer 204 No Content.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

const cache = new Map<string, { expires: number; promise: Promise<unknown> }>();

export function request<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const key = url.toString();

  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.promise as Promise<T>;

  const promise = fetchWithRetry<T>(key);
  cache.set(key, { expires: Date.now() + CACHE_MS, promise });
  promise.catch(() => cache.delete(key)); // never cache failures
  return promise;
}

/** Throttled, retried write (POST / PATCH / DELETE) with a JSON:API body. */
export async function send(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body: unknown,
  params: Record<string, string> = {},
): Promise<void> {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  await fetchWithRetry<unknown>(url.toString(), { method, body });
}

/** Drops cached GET responses whose URL contains `match`. */
export function clearCache(match: string) {
  for (const key of cache.keys()) {
    if (key.includes(match)) cache.delete(key);
  }
}

/* ---------- search ---------- */

interface TrackAttributes {
  title?: string;
  duration?: string;
  explicit?: boolean;
}

interface JsonApiResource {
  id: string;
  type: string;
  attributes?: TrackAttributes;
  relationships?: Record<string, { data?: { id: string; type: string }[] }>;
}

interface JsonApiDoc {
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
}

export interface Track {
  id: string;
  title: string;
  duration?: string;
  explicit?: boolean;
}

export async function searchTracks(query: string, countryCode = "US"): Promise<Track[]> {
  const doc = await request<JsonApiDoc>("/searchResults", {
    "filter[query]": query,
    countryCode,
    include: "tracks",
  });

  const primary = Array.isArray(doc.data) ? doc.data[0] : doc.data;
  if (!primary) return [];

  const byId = new Map(
    (doc.included ?? []).filter((r) => r.type === "tracks").map((r) => [r.id, r] as const),
  );
  const orderedIds = primary.relationships?.tracks?.data?.map((r) => r.id);
  const resources = orderedIds
    ? orderedIds.flatMap((id) => byId.get(id) ?? [])
    : [...byId.values()];

  return resources.map((r) => ({
    id: r.id,
    title: r.attributes?.title ?? "(untitled)",
    duration: r.attributes?.duration,
    explicit: r.attributes?.explicit,
  }));
}

/** "PT3M45S" -> "3:45" */
export function formatDuration(iso?: string) {
  const m = iso?.match(/PT(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  return `${m[1] ?? 0}:${String(m[2] ?? 0).padStart(2, "0")}`;
}