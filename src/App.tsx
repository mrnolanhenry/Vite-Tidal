import { useEffect, useState } from "react";
import { getToken, login, logout } from "./auth";
import Library from "./Library";
import PlaylistPage from "./PlaylistPage";
import Search from "./Search";

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

  if (!loggedIn) {
    return (
      <>
        <h1>Vite Tidal</h1>
        {initialError && <p className="error">{initialError}</p>}
        <button onClick={login}>Log in with TIDAL</button>
      </>
    );
  }

  const playlistMatch = hash.match(/^#\/playlist\/(.+)$/);
  const playlistId = playlistMatch ? decodeURIComponent(playlistMatch[1]) : null;

  return (
    <>
      <header>
        <h1>Vite Tidal</h1>
        <button className="secondary" onClick={logout}>
          Log out
        </button>
      </header>

      <nav>
        <a href="#/">Playlists</a>
        <a href="#/search">Search</a>
      </nav>

      {playlistId ? (
        <PlaylistPage key={playlistId} id={playlistId} />
      ) : hash === "#/search" ? (
        <Search />
      ) : (
        <Library />
      )}
    </>
  );
}