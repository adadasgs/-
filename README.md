# ASTOKZI

Node.js website with a separate `/admin` page and JSON API.

## Local run

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET` and a strong `ADMIN_PASSWORD`.
4. Run `npm start` and open `http://localhost:3000`.

## Render

The repository includes `render.yaml` for a free test deployment. Connect this GitHub repository in Render and create the service from the Blueprint. Set `ADMIN_PASSWORD` to a strong private password in the Render environment settings. Render generates `SESSION_SECRET` automatically.

Important: Render Free web services have an ephemeral filesystem. SQLite data, user balances, uploaded receipt images, and sessions can be lost on restart, spin-down, or redeploy. For persistent production data, use a paid Render web service with a persistent disk mounted at `/var/data` and set `DATA_DIR=/var/data`, or migrate the app to a persistent managed database and object storage.

## Pages

- `/` — public website
- `/admin` — separate administrator sign-in and dashboard
- `/api/health` — health check

Online payment processing is not integrated. Orders are created as pending requests. Top-ups are credited only after an administrator manually approves the receipt.
