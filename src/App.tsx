import { useEffect, useState } from "react";
import Library from "./Library";
import PlaylistPage from "./PlaylistPage";
import { getToken, login, logout } from "./services/auth";

function useHash() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App({ initialError }: { initialError?: string }) {
  const hash = useHash();
  const loggedIn = Boolean(getToken());

  const playlistMatch = hash.match(/^#\/playlist\/(.+)$/);
  const playlistId = loggedIn && playlistMatch ? decodeURIComponent(playlistMatch[1]) : null;

  let content;
  if (!loggedIn) {
    content = initialError ? (
      <p className="error">{initialError}</p>
    ) : (
      <p>Log in with TIDAL to view your playlists.</p>
    );
  } else if (playlistId) {
    content = <PlaylistPage key={playlistId} id={playlistId} />;
  } else {
    content = <Library />;
  }

  return (
    <>
      <header className="topbar">
        <h1>Tidal Tools</h1>
        {playlistId && <a href="#/">← Back to Playlists</a>}
        {loggedIn ? (
          <button className="secondary" onClick={logout}>
            Log out
          </button>
        ) : (
          <button onClick={login}>Log in</button>
        )}
      </header>
      <main>{content}</main>
    </>
  );
}