import { getToken } from "./auth";

const BASE = "https://openapi.tidal.com/v2";

interface ResourceIdentifier {
  id: string;
  type: string;
}

interface TrackAttributes {
  title?: string;
  duration?: string;
  explicit?: boolean;
}

interface JsonApiResource {
  id: string;
  type: string;
  attributes?: TrackAttributes;
  relationships?: Record<string, { data?: ResourceIdentifier[] }>;
}

interface JsonApiDoc {
  // TIDAL now returns an array here; older responses returned a single object.
  data: JsonApiResource | JsonApiResource[];
  included?: JsonApiResource[];
}

export interface Track {
  id: string;
  title: string;
  duration?: string;
  explicit?: boolean;
}

async function request<T>(path: string, params: Record<string, string> = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      accept: "application/vnd.api+json",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
  return (await res.json()) as T;
}

export async function searchTracks(query: string, countryCode = "US"): Promise<Track[]> {
  const doc = await request<JsonApiDoc>("/searchResults", {
    "filter[query]": query,
    countryCode,
    include: "tracks",
  });

  const primary = Array.isArray(doc.data) ? doc.data[0] : doc.data;
  if (!primary) return [];

  const included = doc.included ?? [];
  const byId = new Map(
    included.filter((r) => r.type === "tracks").map((r) => [r.id, r] as const),
  );

  // Prefer the relationship order (TIDAL's relevance ranking); fall back to
  // whatever tracks were included if the relationship carries no data.
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