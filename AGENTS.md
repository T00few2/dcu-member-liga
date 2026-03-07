# AGENTS.md

## Cursor Cloud specific instructions

### Project overview

DCU e-Cycling League — a Next.js 16 frontend + Python Flask backend for managing virtual cycling races on Zwift. See `frontend/README.md` and `backend/README.md` for detailed documentation.

### Services

| Service | Command | Port | Working dir |
|---------|---------|------|-------------|
| Frontend (Next.js 16, Turbopack) | `npm run dev` | 3000 | `frontend/` |
| Backend (Flask via functions-framework) | `python3 -m functions_framework --target=dcu_api --port=8080` | 8080 | `backend/` |

Both require `.env` files (see below). Firebase Firestore/Auth are cloud-hosted — there is no local emulator.

### Environment files

- **`frontend/.env.local`** — needs `NEXT_PUBLIC_FIREBASE_*` keys and `NEXT_PUBLIC_API_URL=http://localhost:8080`
- **`backend/.env`** — needs `ALLOW_LOCALHOST=true` plus optional `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `ZWIFT_USERNAME`, `ZWIFT_PASSWORD`, `ZR_AUTH_KEY`. Without real credentials, the backend starts but external API calls and Firebase operations will fail gracefully.
- **`backend/serviceAccountKey.json`** — required for Firebase Admin SDK in the backend. Without it, Firestore returns `{"error":"DB not available"}`.

### Backend startup

Set `ALLOW_LOCALHOST=true` in `backend/.env` so the CORS middleware allows `http://localhost:*` origins. Run from the `backend/` directory:

```
python3 -m functions_framework --target=dcu_api --port=8080
```

The `functions_framework` CLI alias may not be on `$PATH`; always use `python3 -m functions_framework`.

### Known issues (pre-existing in repo)

- **ESLint**: `eslint-config-next` in `frontend/package.json` is pinned to `^0.2.4`, which resolves to an unrelated legacy npm package (by Manuel Vila). The eslint.config.mjs expects the official Vercel/Next.js package (16.x). Running `npm run lint` will fail with `ERR_MODULE_NOT_FOUND`.
- **TypeScript build error**: `npm run build` fails due to a type error in `app/page.tsx:329` (`string | undefined` not assignable to `string`). The `next dev` server is unaffected.
- **Turbopack root warning**: Next.js detects two `package-lock.json` files (root + frontend). This is cosmetic and does not affect functionality.
