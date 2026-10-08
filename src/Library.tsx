import { useEffect, useState } from "react";
import Artwork from "./Artwork";
import { fetchCoverArt, getLibrary, type PlaylistEntry } from "./services/playlists";

export default function Library() {
  const [playlists, setPlaylists] = useState<PlaylistEntry[] | null>(null);
  const [extraArt, setExtraArt] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getLibrary(reloadKey > 0)
      .then(async (list) => {
        if (cancelled) return;
        setPlaylists(list);
        // Only needed if TIDAL didn't include cover art in the main response.
        const missing = list.filter((p) => !p.artwork).map((p) => p.id);
        if (missing.length === 0) return;
        const covers = await fetchCoverArt("playlists", missing, 160);
        if (!cancelled) setExtraArt(covers);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function refresh() {
    setPlaylists(null);
    setError(null);
    setExtraArt(new Map());
    setReloadKey((k) => k + 1);
  }

  if (error) {
    return (
      <>
        <p className="error">{error}</p>
        <button type="button" onClick={refresh}>
          Try again
        </button>
      </>
    );
  }
  if (!playlists) return <p>Loading your playlists…</p>;

  return (
    <>
      <header>
        <h2>Your playlists ({playlists.length})</h2>
        <button type="button" className="secondary" onClick={refresh}>
          Refresh
        </button>
      </header>

      {playlists.length === 0 ? (
        <p>No playlists found.</p>
      ) : (
        <ul className="tree">
          {playlists.map((p) => (
            <li key={p.id}>
              <a className="row" href={`#/playlist/${encodeURIComponent(p.id)}`}>
                <Artwork src={p.artwork ?? extraArt.get(p.id)} />
                <span className="row-title">{p.name}</span>
                {p.numberOfItems != null && <small>{p.numberOfItems} items</small>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}