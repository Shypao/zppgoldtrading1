# ZPP Gold Trading

TypeScript web application for buying transactions, rate management, inventory, liquidation, refining, retail sales, customer records, reporting, and role-based user access.

## Documentation

- [User guide](docs/USER_GUIDE.md) — complete operating instructions for Admin and Staff users.

## Run locally

```bash
npm install
npm run build
npm start
```

Open `http://127.0.0.1:4177`.

For development with TypeScript source execution:

```bash
npm run dev
```

Without Turso or upstream environment variables, the application stores data in the local SQLite database at `data/zpp-gold-trading.db`.

## Persistent database on Vercel

Create a Turso database and set these environment variables in Vercel for Production, Preview, and Development:

- `TURSO_DATABASE_URL`
- `TURSO_AUTH_TOKEN`
- `ZPP_SESSION_SECRET`
- `ZPP_ADMIN_PASSWORD` and `ZPP_STAFF_PASSWORD` (used only when the users table is first created)

Use `.env.example` as the local template. Never commit real tokens or passwords. The server creates the required tables on its first successful connection. `/api/health` reports `"database":"turso"` and `"persistent":true` when Turso is active.

## Initial sign-in

On a new database, the application creates these accounts unless environment-specific initial passwords were configured:

- Admin: `admin` / `Admin@123`
- Staff: `staff` / `Staff@123`

Replace the default passwords before production use. Administrators can create and manage Admin or Staff accounts from **User accounts**.

## Source structure

- `src/server.ts` — typed HTTP API, authentication, persistence, and manual rate management.
- `public/app.ts` — browser application source in TypeScript.
- `public/app.js` — compiled browser JavaScript.
- `public/index.html` — interface markup and styles.
- `api/` — Vercel API entry points.
