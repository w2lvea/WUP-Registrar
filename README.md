# WUP Online Student Document Request & Tracking System

Express + SQLite (Node's built-in `node:sqlite`) backend, no external database server required.

## What changed in this version

- Only Transcript of Records, Certificate of Grades and Certificate of Enrollment are requestable (full names everywhere).
- Registrar staff must change their password on first login, and can change it any time from the account button at the bottom of the sidebar.
- New **Clearance fees** tab (students read it, the registrar edits prices) and a registrar-only **Documents** tab (add, edit, turn on/off).
- "Please refer to Wesleyan Automate for confirmation of released grades." appears once, at the Pending Review step.
- "Reject" is now **Declined**. A declined request frees its OR number.
- Each OR number can be used once. The student form warns while typing, and the server enforces it.
- The registrar picks a claim date (not in the past) when marking a request ready, and can change it while it is still ready.

The database upgrades itself on first start and keeps existing requests and accounts. Existing registrar accounts are asked to change their password on next sign-in.

## Run locally

```bash
npm install
npm start
```

Visit `http://localhost:3000`. A `data/wup_registrar.db` file is created and seeded
automatically on first run (4 demo students + 1 registrar staff account — see `db.js`
for the seeded credentials).

## Deploy on Vercel + Supabase (Recommended for Serverless)

The application includes a dual-mode database adapter (`db.js`) and Vercel serverless function entrypoint (`api/index.js`), allowing it to run smoothly on Vercel using Supabase (PostgreSQL) for persistent storage.

### 1. Set Up Supabase Database
1. Go to [supabase.com](https://supabase.com) and create or open your project.
2. In the **SQL Editor**, run [supabase_schema.sql](supabase_schema.sql) to create all tables and initial records.
3. Obtain your Database Connection URL:
   - Go to **Project Settings** → **Database** → **Connection String** → **URI**.
   - Select **Mode: Transaction** (port 6543) for serverless compatibility.

### 2. Deploy to Vercel
1. Push your latest code to GitHub:
   ```bash
   git add .
   git commit -m "Adapt project for Vercel + Supabase"
   git push origin main
   ```
2. Go to [vercel.com](https://vercel.com) → **Add New...** → **Project**.
3. Import your `WUP-Registrar` GitHub repository.
4. Under **Environment Variables**, add:
   - `DATABASE_URL`: `postgresql://postgres.[REF]:[PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
   - `SUPABASE_URL`: `https://[REF].supabase.co`
   - `SUPABASE_KEY`: Your Supabase API key
   - (Optional) `EMAILJS_*` and `SEMAPHORE_*` keys if using OTP email/SMS delivery.
5. Click **Deploy**. Vercel will build and host your app!

---

## Deploy — GitHub + Render (Alternative)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit" 
git branch -M main
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

(If you're using GitHub Desktop or a different git workflow, just make sure the whole
`wup-registrar/` folder — minus `node_modules/`, which `.gitignore` already excludes —
ends up in the repo.)

### 2. Deploy on Render

**Option A — Blueprint (one click, recommended):** this repo includes `render.yaml`.
Go to [render.com](https://render.com) → **New** → **Blueprint** → connect your GitHub
repo → Render reads `render.yaml` and sets everything up automatically.

**Option B — Manual setup:** **New** → **Web Service** → connect your GitHub repo, then:
| Setting | Value |
|---|---|
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Plan | Free |

No environment variables are required — Render sets `PORT` automatically and the app
already reads it (`server.js`).

### Login sessions

Logging in creates a session (httpOnly cookie + `sessions` table in the SQLite file), valid for
12 hours and extended while in use. The page calls `/api/me` on load, so refreshing no longer
returns to the login screen. The registrar dashboard also re-checks for new requests every 15 seconds.

### 3. Important: free-tier data persistence

On Render's **free** plan, the service spins down after ~15 minutes of inactivity. When
it wakes back up, it's a fresh instance — so the local `data/` folder (and anything
written to it, like new document requests) resets to empty and reseeds with the demo
data. Fine for early testing where occasional resets aren't a problem; **not** fine if
you need data to reliably survive restarts.

To make it persistent, add a Render **persistent disk** (small paid add-on) mounted at,
e.g., `/var/data`, then set one environment variable in the Render dashboard:

```
DB_DIR=/var/data
```

`db.js` already reads this — no code changes needed, just the env var and the disk.

## Project structure

```
db.js            SQLite schema, seeding, and connection (node:sqlite)
hash.js          Password hashing (crypto.scrypt — no external deps)
server.js        Express API routes
public/
  index.html     Frontend markup (login, dashboards, modals)
  app.js         Frontend logic
  styles.css     Custom styles (Tailwind is loaded via CDN in index.html)
  assets/logo.png
```
