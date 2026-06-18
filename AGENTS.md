## Cursor Cloud specific instructions

This is a single-package React + Vite + TypeScript e-commerce storefront (Luxedge). There is no backend — all state is client-side via Zustand persisted to localStorage.

### Services

| Service | Command | Port |
|---------|---------|------|
| Vite Dev Server | `npm run dev` | 5173 |

### Key commands

- **Install deps:** `npm install`
- **Dev server:** `npm run dev` (add `-- --host 0.0.0.0` for network access)
- **Type-check:** `npx tsc --noEmit`
- **Build:** `npm run build` (outputs single `dist/index.html` via vite-plugin-singlefile)
- **Preview prod build:** `npm run preview`

### Notes

- No linting tool (ESLint) is configured in the project; use `tsc --noEmit` for static analysis.
- The app uses HashRouter so all routes work from a single HTML file — deep links look like `/#/shop`, `/#/admin`.
- Authentication is client-side only. To access the admin dashboard, navigate to `/#/admin` (requires signing up and having admin privileges set in the store).
- Adding items to cart requires being logged in; create an account via the signup flow first.
