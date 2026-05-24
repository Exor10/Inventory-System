# Inventory System — Handoff Summary

## What's built and pushed

| File | Status |
|---|---|
| `gas/Code.gs` | Full Apps Script backend — all endpoints implemented |
| `gas/SHEET_STRUCTURE.md` | Column schema reference |
| `gas/DEPLOY_STAGE1.md` | Deployment + curl test guide |
| `index.html` + `js/auth.js` | Login page with PIN dots, session management |
| `js/config.js` | API URL + shared constants |
| `js/api.js` | Fetch wrapper (form-encoded POST — avoids CORS preflight) |
| `scanner.html` + `js/scanner.js` | Scanner page, all 5 modes |

---

## Key decisions to know

- **`URLSearchParams` for all API calls** — Apps Script returns 405 on OPTIONS preflight. Form-encoded POST (`application/x-www-form-urlencoded`) is a CORS "simple" type, skipping preflight entirely. The backend reads params from `e.parameter`.
- **`LockService`** wraps every write in `Code.gs` — mandatory, not optional.
- **Session in `sessionStorage`** — clears on tab close, not `localStorage`.
- **Soft delete only** — `active = false`, never hard-delete rows.
- **Every time `Code.gs` changes** → Deploy → Manage deployments → edit → New version → Deploy.

---

## What's left (Stages 4–6)

### Stage 4 — `dashboard.html` + `js/dashboard.js`
- Stats: total items, total stock quantity
- Checked-out items list (who has what, since when)
- Recent activity feed (last 20 movements)
- Auto-refresh every 30s (`CONFIG.DASHBOARD_REFRESH`)

### Stage 5 — `items-admin.html` (admin only)
- Searchable/filterable item table
- Add / edit / soft-delete item forms
- Barcode label printing via **JsBarcode** CDN → canvas → `window.print()` as a grid

### Stage 6 — `reports.html`
- Date range picker (default last 7 days)
- Movement breakdown by action type
- Top 10 most-moved items
- Bar chart via **Chart.js** CDN
- CSV export button

---

## Before picking up Stage 4

1. Enable GitHub Pages: repo Settings → Pages → branch `main` / root → Save
2. Your live URL will be `https://exor10.github.io/Inventory-System/`
3. Test the scanner from that HTTPS URL with your physical barcode scanner and confirm the session persists across page navigations
