import { useState, type FormEvent, type ReactNode } from "react";
import type { PlaylistTrack } from "./services/playlists";

interface Props {
  /** Every track in the playlist, in position order. */
  tracks: PlaylistTrack[];
  /** Selected tracks, ordered by current position. */
  selectedTracks: PlaylistTrack[];
  onMove: (newPosition: number) => Promise<void>;
  onClose: () => void;
}

/** 'Title' by Artist from 'Album' (Year), skipping any missing parts. Each part is styled. */
function describe(t: PlaylistTrack): ReactNode {
  return (
    <>
      <strong className="hl-title">'{t.title}'</strong>
      {t.artist && (
        <>
          {" "}by <strong className="hl-artist">{t.artist}</strong>
        </>
      )}
      {t.album && (
        <>
          {" "}from <span className="hl-album">'{t.album}'</span>
        </>
      )}
      {t.year ? (
        <>
          {" "}(<span className="hl-year">{t.year}</span>)
        </>
      ) : null}
    </>
  );
}

export default function MoveTracksPanel({ tracks, selectedTracks, onMove, onClose }: Props) {
  const count = selectedTracks.length;
  const noun = count === 1 ? "track" : "tracks";
  const first = selectedTracks[0];
  const maxPosition = Math.max(1, tracks.length - count + 1);

  const [value, setValue] = useState(String(first?.position ?? 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const target = Number(value);
  const valid =
    value.trim() !== "" && Number.isInteger(target) && target >= 1 && target <= maxPosition;

  // Where the selection would land, given everything else keeps its order.
  const selectedPositions = new Set(selectedTracks.map((t) => t.position));
  const rest = tracks.filter((t) => !selectedPositions.has(t.position));
  const alreadyThere = valid && selectedTracks.every((t, i) => t.position === target + i);
  const below = valid ? rest[target - 1] : undefined; // the track that ends up right after the block
  const last = valid && !below ? rest[rest.length - 1] : undefined;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onMove(target);
      onClose();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <aside
      className="side-panel"
      role="dialog"
      aria-label="Move tracks"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
      }}
    >
      <div className="side-panel-head">
        <h3>Move tracks</h3>
        <button type="button" className="secondary" onClick={onClose} aria-label="Close panel">
          ✕
        </button>
      </div>

      <form onSubmit={submit}>
        <p>
          {count} {noun} selected
        </p>

        <label htmlFor="move-position">New position for “{first?.title}”</label>
        <input
          id="move-position"
          type="number"
          inputMode="numeric"
          min={1}
          max={maxPosition}
          step={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          autoFocus
        />

        <p className="hint">
          Currently at position {first?.position}. Valid positions: 1–{maxPosition}.
          {count > 1 && valid && ` The selected tracks will occupy ${target}–${target + count - 1}.`}
        </p>

        {alreadyThere && (
          <p className="hint">
            The selected {noun} {count === 1 ? "is" : "are"} already at this position.
          </p>
        )}
        {valid && !alreadyThere && below && (
          <p className="hint">
            This will insert the selected {noun} above {describe(below)}.
          </p>
        )}
        {valid && !alreadyThere && last && (
          <p className="hint">
            This will move the selected {noun} to the end of the playlist, after {describe(last)}.
          </p>
        )}

        {error && <p className="error">{error}</p>}

        <button disabled={!valid || busy}>{busy ? "Moving…" : "Move"}</button>
      </form>
    </aside>
  );
}