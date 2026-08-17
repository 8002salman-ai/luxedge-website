import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { scrubLegacySecrets } from "./features/ai/providers";

// Remove any legacy provider keys / scraping tokens that older builds may
// have left in localStorage. Runs before the app renders.
scrubLegacySecrets();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
