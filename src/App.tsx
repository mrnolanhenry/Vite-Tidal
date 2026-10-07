import { getToken, login, logout } from "./auth";
import Search from "./Search";

export default function App({ initialError }: { initialError?: string }) {
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

  return (
    <>
      <header>
        <h1>Vite Tidal</h1>
        <button className="secondary" onClick={logout}>
          Log out
        </button>
      </header>
      <Search />
    </>
  );
}