import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./PlaylistPage.css";
import Artwork from "../components/Artwork";
import MoveTracksPanel from "../components/MoveTracksPanel";
import { ApiError } from "../services/api";
import {
  fetchCoverArt,
  formatSeconds,
  getPlaylist,
  getPlaylistTracks,
  reloadPlaylistTracks,
  reorderPlaylistTracks,
  type PlaylistDetail,
  type PlaylistTrack,
} from "../services/playlists";

type SortKey = "position" | "title" | "artist" | "album" | "year" | "duration";
interface SortState {
  key: SortKey;
  dir: "asc" | "desc";
}
interface Modifiers {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function sameOrder(a: PlaylistTrack[], b: PlaylistTrack[]) {
  return a.length === b.length && a.every((t, i) => t.itemId === b[i].itemId);
}

function compare(a: PlaylistTrack, b: PlaylistTrack, key: SortKey) {
  switch (key) {
    case "title":
      // Sort by what the grid shows; the base `title` stays available on each track.
      return a.fullTitle.localeCompare(b.fullTitle);
    case "artist":
      return a.artist.localeCompare(b.artist);
    case "album":
      return (a.album ?? "").localeCompare(b.album ?? "");
    case "year":
      return (a.year ?? 0) - (b.year ?? 0);
    case "duration":
      return a.durationSeconds - b.durationSeconds;
    default:
      return a.position - b.position;
  }
}

const SKELETON_WIDTHS = [62, 80, 54, 71, 88, 47, 66, 76];

function TrackGridSkeleton() {
  return (
    <div className="table-wrap" aria-busy="true">
      <span className="sr-only" role="status">
        Loading tracks…
      </span>
      <table className="tracks">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">
              <span className="sr-only">Artwork</span>
            </th>
            <th scope="col">Title</th>
            <th scope="col">Artist</th>
            <th scope="col">Album</th>
            <th scope="col">Year</th>
            <th scope="col">Duration</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 10 }, (_, i) => (
            <tr key={i}>
              <td className="num">
                <span className="skeleton" style={{ width: 18, height: 14, marginLeft: "auto" }} />
              </td>
              <td>
                <span className="skeleton" style={{ width: 40, height: 40 }} />
              </td>
              <td>
                <span
                  className="skeleton"
                  style={{ width: `${SKELETON_WIDTHS[i % 8]}%`, height: 14 }}
                />
              </td>
              <td>
                <span
                  className="skeleton"
                  style={{ width: `${SKELETON_WIDTHS[(i + 3) % 8]}%`, height: 14 }}
                />
              </td>
              <td>
                <span
                  className="skeleton"
                  style={{ width: `${SKELETON_WIDTHS[(i + 5) % 8]}%`, height: 14 }}
                />
              </td>
              <td>
                <span className="skeleton" style={{ width: 32, height: 14 }} />
              </td>
              <td className="num">
                <span className="skeleton" style={{ width: 36, height: 14, marginLeft: "auto" }} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Render with key={id} so state resets when navigating between playlists. */
export default function PlaylistPage({ id }: { id: string }) {
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [tracks, setTracks] = useState<PlaylistTrack[] | null>(null);
  const [albumArt, setAlbumArt] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: "position", dir: "asc" });
  const [selected, setSelected] = useState<Set<number>>(new Set()); // by position number
  const [panel, setPanel] = useState<number | null>(null); // session key while open
  const [condensed, setCondensed] = useState(false);
  const [busy, setBusy] = useState(false); // a move (and its refresh) is in progress

  const fullHeaderRef = useRef<HTMLElement>(null);
  const condensedBarRef = useRef<HTMLDivElement>(null);

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

  // Start at the top, then show the condensed bar once the full header has
  // scrolled far enough under the top bar that the bar can cover what's left of it.
  useEffect(() => {
    window.scrollTo(0, 0);

    const onScroll = () => {
      const full = fullHeaderRef.current;
      const bar = condensedBarRef.current;
      const topbar = document.querySelector<HTMLElement>(".topbar");
      if (!full || !bar || !topbar) return;
      const limit = topbar.getBoundingClientRect().bottom + bar.offsetHeight;
      setCondensed(full.getBoundingClientRect().bottom <= limit);
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  // While a move is running: make the rest of the page inert (no clicks, no keyboard
  // focus) and ask the browser to confirm before the tab is refreshed or closed.
  useEffect(() => {
    if (!busy) return;

    const inertTargets = Array.from(document.querySelectorAll<HTMLElement>(".topbar, main"));
    inertTargets.forEach((el) => el.setAttribute("inert", ""));

    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);

    return () => {
      inertTargets.forEach((el) => el.removeAttribute("inert"));
      window.removeEventListener("beforeunload", warn);
    };
  }, [busy]);

  const sorted = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...(tracks ?? [])].sort(
      (a, b) => compare(a, b, sort.key) * dir || a.position - b.position,
    );
  }, [tracks, sort]);

  /** Selected tracks in playlist order (the first one is the lowest position). */
  const selectedTracks = useMemo(
    () => (tracks ?? []).filter((t) => selected.has(t.position)),
    [tracks, selected],
  );

  function toggleSort(key: SortKey) {
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" },
    );
  }

  function selectRow(position: number, mods: Modifiers) {
    let next: Set<number>;

    if (mods.shiftKey && selected.size > 0) {
      // Add everything between the clicked row and the nearest selected position.
      let anchor = position;
      let best = Infinity;
      for (const p of selected) {
        const distance = Math.abs(p - position);
        if (distance < best || (distance === best && p < anchor)) {
          best = distance;
          anchor = p;
        }
      }
      next = new Set(selected);
      for (let p = Math.min(anchor, position); p <= Math.max(anchor, position); p++) next.add(p);
    } else if (mods.ctrlKey || mods.metaKey) {
      // Ctrl/Cmd: toggle just this row.
      next = new Set(selected);
      if (!next.delete(position)) next.add(position);
    } else if (selected.has(position)) {
      // Plain click on an already-selected row: deselect it.
      next = new Set(selected);
      next.delete(position);
    } else {
      // Plain click on an unselected row: select only this row.
      next = new Set([position]);
    }

    setSelected(next);
    if (next.size === 0) setPanel(null);
  }

  /**
   * Replaces the grid with TIDAL's current data. The tracks that were just moved
   * stay selected, found by item ID so it works even if the order isn't what we expected.
   * Never throws; problems are reported in the notice bar.
   */
  async function refreshAfterMove(movedIds: Set<string | undefined>, expected: PlaylistTrack[]) {
    try {
      let fresh = await reloadPlaylistTracks(id);

      // Right after a write TIDAL can briefly serve the old order, so look once more.
      if (!sameOrder(fresh, expected)) {
        await sleep(1500);
        fresh = await reloadPlaylistTracks(id);
      }

      setTracks(fresh);
      setSelected(new Set(fresh.filter((t) => movedIds.has(t.itemId)).map((t) => t.position)));
      if (!sameOrder(fresh, expected)) {
        setNotice("TIDAL's order differs from what was requested. Showing TIDAL's version.");
      }
    } catch {
      setNotice("The move went through, but the playlist couldn't be refreshed from TIDAL.");
    }
  }

  async function reloadFromTidal() {
    setNotice(null);
    setSelected(new Set());
    setPanel(null);
    try {
      setTracks(await reloadPlaylistTracks(id));
    } catch (err) {
      setNotice((err as Error).message);
    }
  }

  /** Puts the first selected track at `newPosition`, with the others right after it. */
  async function handleMove(newPosition: number) {
    if (!tracks) return;

    const moving = selectedTracks;
    const rest = tracks.filter((t) => !selected.has(t.position));
    const insertAt = newPosition - 1;
    const finalOrder = [...rest.slice(0, insertAt), ...moving, ...rest.slice(insertAt)];

    if (finalOrder.every((t, i) => t === tracks[i])) {
      throw new Error("Those tracks are already at that position.");
    }

    setBusy(true);
    try {
      try {
        await reorderPlaylistTracks(id, moving, rest, insertAt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          throw new Error(
            "TIDAL refused the change (403). Make sure you own this playlist and that you logged out and back in after adding the playlists.write scope.",
          );
        }
        throw err;
      }

      // Show the result right away, then refresh from TIDAL.
      const reordered = finalOrder.map((t, i) => ({ ...t, position: i + 1 }));
      setTracks(reordered);
      setSelected(new Set(moving.map((_, i) => newPosition + i)));
      setNotice(null);
      await refreshAfterMove(new Set(moving.map((t) => t.itemId)), reordered);
    } finally {
      setBusy(false);
    }
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

  // Shown in both the full header and the condensed bar.
  const moveControls = (
    <>
      <span className="selection-info">
        {selected.size > 0 ? `${selected.size} selected` : "Click a row to select"}
      </span>
      <button
        type="button"
        disabled={selectedTracks.length === 0}
        onClick={() => setPanel(Date.now())}
      >
        Move Tracks
      </button>
    </>
  );

  return (
    <>
      {error && <p className="error">{error}</p>}

      <section className="playlist-header" ref={fullHeaderRef}>
        <Artwork src={playlist?.artwork} size={160} />
        <div className="playlist-text">
          <h2>{playlist?.name ?? "Loading…"}</h2>
          {playlist?.description && <p className="description">{playlist.description}</p>}
          <p className="track-count">
            {tracks ? (
              `${tracks.length} ${tracks.length === 1 ? "track" : "tracks"}`
            ) : (
              <span className="skeleton" style={{ width: 70, height: 14 }} />
            )}
          </p>
        </div>
        <div className="header-actions">{moveControls}</div>
      </section>

      <div ref={condensedBarRef} className={`condensed-bar${condensed ? " visible" : ""}`}>
        <div className="condensed-inner">
          <Artwork src={playlist?.artwork} size={40} />
          <span className="condensed-title">{playlist?.name ?? "Loading…"}</span>
          <div className="header-actions">{moveControls}</div>
        </div>
      </div>

      {notice && (
        <p className="notice">
          {notice}{" "}
          <button type="button" className="secondary" onClick={() => void reloadFromTidal()}>
            Reload from TIDAL
          </button>
        </p>
      )}

      {!tracks && !error && <TrackGridSkeleton />}
      {tracks && tracks.length === 0 && <p>This playlist is empty.</p>}
      {tracks && tracks.length > 0 && (
        <div className="table-wrap">
          <table className="tracks">
            <thead>
              <tr>
                {header("position", "#")}
                <th scope="col">
                  <span className="sr-only">Artwork</span>
                </th>
                {header("title", "Title")}
                {header("artist", "Artist")}
                {header("album", "Album")}
                {header("year", "Year")}
                {header("duration", "Duration")}
              </tr>
            </thead>
            <tbody>
              {sorted.map((t) => {
                const isSelected = selected.has(t.position);
                return (
                  <tr
                    key={t.key}
                    className={isSelected ? "selected" : undefined}
                    aria-selected={isSelected}
                    tabIndex={0}
                    onClick={(e) => selectRow(t.position, e)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectRow(t.position, e);
                      }
                    }}
                  >
                    <td className="num">{t.position}</td>
                    <td>
                      <Artwork
                        src={t.artwork ?? (t.albumId ? albumArt.get(t.albumId) : undefined)}
                        size={40}
                      />
                    </td>
                    <td>
                      {t.fullTitle} {t.explicit && <em>E</em>}
                    </td>
                    <td>{t.artist}</td>
                    <td>{t.album ?? ""}</td>
                    <td>{t.year ?? ""}</td>
                    <td className="num">{formatSeconds(t.durationSeconds)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Both are rendered into <body> so they sit outside the inert page content. */}
      {busy && createPortal(<div className="busy-overlay" aria-hidden="true" />, document.body)}
      {panel !== null &&
        tracks &&
        selectedTracks.length > 0 &&
        createPortal(
          <MoveTracksPanel
            key={panel}
            tracks={tracks}
            selectedTracks={selectedTracks}
            busy={busy}
            onMove={handleMove}
            onClose={() => setPanel(null)}
          />,
          document.body,
        )}
    </>
  );
}