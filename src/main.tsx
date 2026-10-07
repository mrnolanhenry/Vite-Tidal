import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
import App from "./App";
import { handleRedirect } from "./auth";

// The OAuth code exchange must run exactly once. Doing it here, before React
// mounts, avoids StrictMode's double-invoked effects burning the single-use code.
async function bootstrap() {
  let authError: string | undefined;
  try {
    await handleRedirect();
  } catch (e) {
    authError = (e as Error).message;
  }

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App initialError={authError} />
    </StrictMode>,
  );
}

bootstrap();