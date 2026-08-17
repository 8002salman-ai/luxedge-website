import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { scrubLegacySecrets } from "./features/ai/providers";
import { useAuthStore } from "./store/authStore";

// Remove any legacy provider keys / scraping tokens that older builds may
// have left in localStorage. Runs before the app renders.
scrubLegacySecrets();

// Hydrate the Supabase session (access/refresh tokens persisted in
// localStorage) so a page refresh keeps the admin/customer signed in.
void useAuthStore.getState().init();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
