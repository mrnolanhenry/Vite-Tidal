import { useState, type FormEvent } from "react";
import { formatDuration, searchTracks, type Track } from "./api";

export default function Search() {
  const [query, setQuery] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;

    setLoading(true);
    setError(null);
    try {
      setTracks(await searchTracks(q));
      setSearched(true);
    } catch (err) {
      setError((err as Error).message);
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tracks…"
          autoFocus
        />
        <button disabled={loading}>Search</button>
      </form>

      {loading && <p>Searching…</p>}
      {error && <p className="error">{error}</p>}
      {searched && !loading && !error && tracks.length === 0 && <p>No results.</p>}

      <ul>
        {tracks.map((t) => (
          <li key={t.id}>
            <span>
              {t.title} {t.explicit && <em>E</em>}
            </span>
            <small>{formatDuration(t.duration)}</small>
          </li>
        ))}
      </ul>
    </>
  );
}