import { ApiError, request } from "./api";

const COUNTRY = "US";

/* ---------- JSON:API shapes ---------- */

interface ArtworkFile {
  href: string;
  meta?: { width?: number; height?: number };
}

interface Attributes {
  name?: string;
  title?: string;
  description?: string;
  duration?: string;
  numberOfItems?: number;
  releaseDate?: string;
  explicit?: boolean;
  files?: ArtworkFile[];
}

interface Identifier {
  id: string;
  type: string;
  meta?: { itemId?: string };
}

type Linkage = Identifier[] | Identifier | null;

interface Resource extends Identifier {
  attributes?: Attributes;
  relationships?: Record<string, { data?: Linkage }>;
}

interface Doc {
  data: Resource | Resource[];
  included?: Resource[];
  links?: { next?: string; meta?: { nextCursor?: string } };
}

/* ---------- helpers ---------- */

function toArray<T>(v: T | T[] | null | undefined): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

const keyOf = (r: Identifier) => `${r.type}:${r.id}`;

function merge(into: Map<string, Resource>, from: Iterable<Resource>) {
  for (const r of from) into.set(keyOf(r), r);
}

/** Follows links.meta.nextCursor until exhausted (pages are fetched one at a time). */
async function fetchAll(path: string, params: Record<string, string>) {
  const data: Resource[] = [];
  const included = new Map<string, Resource>();
  let cursor: string | undefined;

  for (let page = 0; page < 100; page++) {
    const doc = await request<Doc>(
      path,
      cursor ? { ...params, "page[cursor]": cursor } : params,
    );
    data.push(...toArray(doc.data));
    merge(included, doc.included ?? []);
    cursor = doc.links?.meta?.nextCursor;
    if (!cursor) break;
  }
  return { data, included };
}

/**
 * Asks for nested cover art in the same request (saves a lookup per batch).
 * If TIDAL rejects the nested include with a 400, remember that and use the
 * plain include from then on.
 */
const nestedOk = { library: true, tracks: true };

async function fetchAllRich(
  flag: keyof typeof nestedOk,
  path: string,
  base: Record<string, string>,
  rich: string,
  plain: string,
) {
  if (nestedOk[flag]) {
    try {
      return await fetchAll(path, { ...base, include: rich });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 400)) throw err;
      nestedOk[flag] = false;
    }
  }
  return fetchAll(path, { ...base, include: plain });
}

/** Smallest image at least `target` px wide, else the largest available. */
export function pickArtwork(files: ArtworkFile[] | undefined, target: number) {
  if (!files?.length) return undefined;
  const sorted = [...files].sort((a, b) => (a.meta?.width ?? 0) - (b.meta?.width ?? 0));
  return (sorted.find((f) => (f.meta?.width ?? 0) >= target) ?? sorted[sorted.length - 1]).href;
}

function coverArtUrl(
  res: Resource | undefined,
  lookup: (artworkId: string) => Resource | undefined,
  size: number,
) {
  const id = toArray(res?.relationships?.coverArt?.data)[0]?.id;
  return id ? pickArtwork(lookup(id)?.attributes?.files, size) : undefined;
}

/** "PT1H2M3S" -> seconds */
export function parseDuration(iso?: string): number {
  const m = iso?.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Math.round(Number(m[3] ?? 0));
}

export function formatSeconds(total: number): string {
  if (!total) return "";
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

/* ---------- fallback cover art lookup (only for items still missing art) ---------- */

/** Batches of 20, strictly one at a time; stops quietly if rate limited. */
export async function fetchCoverArt(
  type: "playlists" | "albums",
  ids: string[],
  size: number,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const unique = [...new Set(ids)];

  for (let i = 0; i < unique.length; i += 20) {
    try {
      const doc = await request<Doc>(`/${type}`, {
        countryCode: COUNTRY,
        "filter[id]": unique.slice(i, i + 20).join(","),
        include: "coverArt",
      });
      const artworks = new Map((doc.included ?? []).map((r) => [r.id, r] as const));
      for (const r of toArray(doc.data)) {
        const url = coverArtUrl(r, (id) => artworks.get(id), size);
        if (url) result.set(r.id, url);
      }
    } catch (err) {
      console.warn(`Cover art lookup failed for ${type}`, err);
      if (err instanceof ApiError && err.status === 429) break;
    }
  }
  return result;
}

/* ---------- library: flat, alphabetized playlist list ---------- */

export interface PlaylistEntry {
  id: string;
  name: string;
  numberOfItems?: number;
  artwork?: string;
}

async function loadLibrary(): Promise<PlaylistEntry[]> {
  const { data, included } = await fetchAllRich(
    "library",
    "/userCollectionPlaylists/me/relationships/items",
    { countryCode: COUNTRY },
    "items,items.coverArt",
    "items",
  );

  const playlists = new Map<string, Resource>();
  const artworks = new Map<string, Resource>();
  for (const r of included.values()) {
    if (r.type === "playlists") playlists.set(r.id, r);
    else if (r.type === "artworks") artworks.set(r.id, r);
  }

  return data
    .filter((ref) => ref.type === "playlists")
    .map((ref) => {
      const res = playlists.get(ref.id);
      return {
        id: ref.id,
        name: res?.attributes?.name ?? "(untitled)",
        numberOfItems: res?.attributes?.numberOfItems,
        artwork: coverArtUrl(res, (id) => artworks.get(id), 160),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }));
}

/* The finished list is kept in memory and in sessionStorage so navigating
   back, reloading, and Vite hot reloads don't re-hit the API. */

const LIB_KEY = "tidal.library.v3";
const LIB_TTL_MS = 15 * 60 * 1000;
let libraryMemo: Promise<PlaylistEntry[]> | null = null;

function readStoredLibrary(): PlaylistEntry[] | null {
  try {
    const raw = sessionStorage.getItem(LIB_KEY);
    if (!raw) return null;
    const { savedAt, library } = JSON.parse(raw) as { savedAt: number; library: PlaylistEntry[] };
    return Date.now() - savedAt < LIB_TTL_MS ? library : null;
  } catch {
    return null;
  }
}

function storeLibrary(library: PlaylistEntry[]) {
  try {
    sessionStorage.setItem(LIB_KEY, JSON.stringify({ savedAt: Date.now(), library }));
  } catch {
    /* storage full or unavailable: skip caching */
  }
}

export function getLibrary(force = false): Promise<PlaylistEntry[]> {
  if (!force) {
    if (libraryMemo) return libraryMemo;
    const stored = readStoredLibrary();
    if (stored) {
      libraryMemo = Promise.resolve(stored);
      return libraryMemo;
    }
  }
  const promise = loadLibrary().then((library) => {
    if (library.length > 0) storeLibrary(library);
    return library;
  });
  libraryMemo = promise;
  promise.catch(() => {
    if (libraryMemo === promise) libraryMemo = null;
  });
  return promise;
}

/* ---------- single playlist ---------- */

export interface PlaylistDetail {
  id: string;
  name: string;
  description?: string;
  artwork?: string;
}

export async function getPlaylist(id: string): Promise<PlaylistDetail> {
  const doc = await request<Doc>(`/playlists/${encodeURIComponent(id)}`, {
    countryCode: COUNTRY,
    include: "coverArt",
  });
  const p = toArray(doc.data)[0];
  const artworks = new Map((doc.included ?? []).map((r) => [r.id, r] as const));

  return {
    id,
    name: p?.attributes?.name ?? "(untitled)",
    description: p?.attributes?.description,
    artwork: coverArtUrl(p, (artId) => artworks.get(artId), 320),
  };
}

export interface PlaylistTrack {
  key: string;
  position: number;
  id: string;
  title: string;
  artist: string;
  year?: number;
  durationSeconds: number;
  albumId?: string;
  artwork?: string;
  explicit?: boolean;
}

export async function getPlaylistTracks(id: string): Promise<PlaylistTrack[]> {
  const { data, included } = await fetchAllRich(
    "tracks",
    `/playlists/${encodeURIComponent(id)}/relationships/items`,
    { countryCode: COUNTRY },
    "items,items.artists,items.albums,items.albums.coverArt",
    "items,items.artists,items.albums",
  );

  return data.map((ref, i) => {
    const item = included.get(keyOf(ref));
    const artists = toArray(item?.relationships?.artists?.data)
      .map((a) => included.get(keyOf(a))?.attributes?.name)
      .filter((n): n is string => Boolean(n));
    const albumRef = toArray(item?.relationships?.albums?.data)[0];
    const album = albumRef ? included.get(keyOf(albumRef)) : undefined;
    const year = Number.parseInt(album?.attributes?.releaseDate?.slice(0, 4) ?? "", 10);

    return {
      key: `${ref.meta?.itemId ?? ref.id}-${i}`,
      position: i + 1,
      id: ref.id,
      title: item?.attributes?.title ?? "(unavailable)",
      artist: artists.join(", "),
      year: Number.isNaN(year) ? undefined : year,
      durationSeconds: parseDuration(item?.attributes?.duration),
      albumId: albumRef?.id,
      artwork: coverArtUrl(album, (artId) => included.get(`artworks:${artId}`), 80),
      explicit: item?.attributes?.explicit,
    };
  });
}