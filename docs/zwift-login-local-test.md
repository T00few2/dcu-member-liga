# Log ind med Zwift: test with real credentials

Riders can register and log in with only their Zwift account. Google login stays as a secondary option.
Zwift doesn't share an email, so Zwift-only riders confirm a contact email with a 6-digit code during registration.

This checklist is for a machine with the real `.env` files (backend + frontend) and `backend/serviceAccountKey.json` or `GOOGLE_APPLICATION_CREDENTIALS`.

> Steps 3–5 write to the Firebase project your local env points at (a new Auth user `zwift_<yourZwiftId>`, your `users` doc, `auth_mappings`). Use a dev project if you have one.

## 1. Get the branch

```text
git fetch origin claude/nifty-cray-4nvvwe
git checkout claude/nifty-cray-4nvvwe
cd frontend && npm install && cd ..
```

## 2. Automated tests

```text
conda run -n py311 python -m pytest backend/tests -q
cd frontend && npm test && npx tsc --noEmit && cd ..
```

## 3. Pre-flight (writes nothing except one test email)

```text
conda run -n py311 python backend/scripts/zwift_signin_preflight.py --send-test-email <your email>
```

Expect:
- **Custom token OK.** If it fails with a signing/permission error, the credentials can't sign custom tokens. This also matters in production: the deployed backend needs either a service-account key or `iam.serviceAccounts.signBlob` ("Service Account Token Creator" on its own service account).
- **redirect_uri** is the one registered with Zwift. It's the same URI the existing "Forbind med Zwift Link" button uses, so nothing should need to change on Zwift's side.
- **Test email** arrives (check spam).

## 4. Run the app locally

Backend: run it the way you normally do, on port 8080, with `ALLOW_LOCALHOST=true`. For local runs, set:
- `FRONTEND_URL=http://localhost:3000`
- `ZWIFT_REDIRECT_URI=<the registered redirect URI>`

If the registered redirect URI points at the deployed backend (not localhost), you can only test the full Zwift round trip against a deployed backend. The callback has to land on the backend that created the login state.

Frontend: `cd frontend && npm run dev` (with `NEXT_PUBLIC_API_URL` pointing at the backend).

## 5. Manual checks

| # | Do | Expect |
|---|----|--------|
| 1 | In a private window: front page → **Tilmeld dig** → **Start tilmelding med Zwift** | Zwift login/consent page |
| 2 | Approve at Zwift | Short "Logger ind med Zwift…" spinner, then `/register` with your name filled in |
| 3 | Step 1: enter email → **Send kode** | Code email arrives within a minute |
| 4 | Enter the code → **Bekræft** | "Email bekræftet."; **Næste** becomes active when club and trainer are filled in |
| 5 | Step 2 | Zwift shows "Forbundet" with "Din login-metode" (no "Frakobl"); connect Strava as usual |
| 6 | Accept the agreements → **Gennemfør tilmelding** | Front page dashboard |
| 7 | Firestore `users/<zwiftId>` | `authUid: "zwift_<zwiftId>"`, `email`, `emailVerified: true`, `registration.status: "complete"` |
| 8 | Log out → **Log ind** → **Log ind med Zwift** | Back on the dashboard as the same rider (same uid in Firebase Auth, no duplicate user) |
| 9 | With an account you registered with Google: log out → **Log ind med Zwift** with that rider's Zwift account | You land on the **existing** account (same uid, email, admin rights); no `zwift_…` user is created |
| 10 | Open the site in the Facebook/Messenger in-app browser → **Log ind** | The Zwift button works; the Google button is replaced by a note |
| 11 | Cancel on Zwift's consent page | "Du afbrød login hos Zwift." with a retry button |

## What was already tested in the cloud session

A full end-to-end run against the Firebase Auth and Firestore emulators, a stand-in Zwift server and a local SMTP sink:
- sign-up via the real UI
- email code
- registration
- log out / log in again
- an existing Google rider logging in via Zwift
- cancel at Zwift

Plus backend unit tests (`backend/tests/test_zwift_signin.py`) and frontend tests (`EmailVerificationStep`, `/auth/zwift`).

That run couldn't cover:
- the real Zwift redirect
- real custom-token signing
- real Zoho delivery

That's what steps 3–5 above are for.
