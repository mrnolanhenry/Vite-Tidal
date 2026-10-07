import { useEffect, useMemo, useState } from "react";
import Artwork from "./Artwork";
import {
  fetchCoverArt,
  formatSeconds,
  getPlaylist,
  getPlaylistTracks,
  type PlaylistDetail,
  type PlaylistTrack,
} from "./playlists";

type SortKey = "position" | "title" | "artist" | "year" | "duration";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}

function compare(a: PlaylistTrack, b: PlaylistTrack, key: SortKey) {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title);
    case "artist":
      return a.artist.localeCompare(b.artist);
    case "year":
      return (a.year ?? 0) - (b.year ?? 0);
    case "duration":
      return a.durationSeconds - b.durationSeconds;
    default:
      return a.position - b.position;
  }
}

/** Render with key={id} so state resets when navigating between playlists. */
export default function PlaylistPage({ id }: { id: string }) {
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[] | null>(null);
  const [albumArt, setAlbumArt] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "position", dir: "asc" });

  useEffect(() => {
    let cancelled = false;
    const fail = (err: unknown) => {
      if (!cancelled) setError((err as Error).message);
    };

    getPlaylist(id)
      .then((p) => {
        if (!cancelled) setPlaylist(p);
      })
      .catch(fail);

    getPlaylistTracks(id)
      .then(async (list) => {
        if (cancelled) return;
        setTracks(list);
        const missing = list.flatMap((t) => (!t.artwork && t.albumId ? [t.albumId] : []));
        if (missing.length === 0) return;
        const covers = await fetchCoverArt("albums", missing, 80);
        if (!cancelled) setAlbumArt(covers);
      })
      .catch(fail);

    return () => {
      cancelled = true;
    };
  }, [id]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...(tracks ?? [])].sort(
      (a, b) => compare(a, b, sort.key) * dir || a.position - b.position,
    );
  }, [tracks, sort]);

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  function header(key: SortKey, label: string) {
    const active = sort.key === key;
    return (
      <th
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      >
        <button type="button" onClick={() => toggleSort(key)}>
          {label}
          {active ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
        </button>
      </th>
    );
  }

  return (
    <>
      <p>
        <a href="#/">← Back to playlists</a>
      </p>

      {error && <p className="error">{error}</p>}

      <section className="playlist-header">
        <Artwork src={playlist?.artwork} size={160} />
        <div>
          <h2>{playlist?.name ?? "Loading…"}</h2>
          {playlist?.description && <p className="description">{playlist.description}</p>}
        </div>
      </section>

      {!tracks && !error && <p>Loading tracks…</p>}
      {tracks && tracks.length === 0 && <p>This playlist is empty.</p>}
      {tracks && tracks.length > 0 && (
        <div className="table-wrap">
          <table className="tracks">
            <thead>
              <tr>
                {header("position", "#")}
                <th scope="col">Art</th>
                {header("title", "Title")}
                {header("artist", "Artist")}
                {header("year", "Year")}
                {header("duration", "Duration")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => (
                <tr key={t.key}>
                  <td className="num">{t.position}</td>
                  <td>
                    <Artwork src={t.artwork ?? (t.albumId ? albumArt.get(t.albumId) : undefined)} size={40} />
                  </td>
                  <td>
                    {t.title} {t.explicit && <em>E</em>}
                  </td>
                  <td>{t.artist}</td>
                  <td>{t.year ?? ""}</td>
                  <td className="num">{formatSeconds(t.durationSeconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}