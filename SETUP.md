# LeasePilot AI - Setup Instructions

## Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- PostgreSQL database (Neon DB connection string provided)

## Installation

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` and fill in values. Required for full operation:
   - `DATABASE_URL` – PostgreSQL connection string (e.g. Neon)
   - `JWT_SECRET` – Secret for signing JWTs (use a long random string in production)
   Optional: `PORT` (default 3000), `NODE_ENV`, `ALLOWED_ORIGINS`. See `.env.example` for all options.

3. **Start the server:**
   ```bash
   npm start
   ```
   
   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

4. **Open the application:**
   - Open `login.html` in your browser
   - Or navigate to `http://localhost:3000/login.html`
   - Create a new account to get started

## Database Schema

The database schema will be automatically created when you first start the server. It includes:

- **users** - User accounts and authentication
- **properties** - Property listings
- **tenants** - Tenant information
- **transactions** - Financial transactions
- **notifications** - User notifications

## API Endpoints

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login user
- `GET /api/auth/verify` - Verify token

### Properties
- `GET /api/properties` - Get all properties
- `GET /api/properties/:id` - Get single property
- `POST /api/properties` - Create property
- `PUT /api/properties/:id` - Update property
- `DELETE /api/properties/:id` - Delete property

### Tenants
- `GET /api/tenants` - Get all tenants
- `GET /api/tenants/:id` - Get single tenant
- `POST /api/tenants` - Create tenant
- `PUT /api/tenants/:id` - Update tenant
- `DELETE /api/tenants/:id` - Delete tenant

### Transactions
- `GET /api/transactions` - Get all transactions
- `GET /api/transactions/:id` - Get single transaction
- `POST /api/transactions` - Create transaction
- `PUT /api/transactions/:id` - Update transaction
- `DELETE /api/transactions/:id` - Delete transaction

### Users
- `GET /api/users/me` - Get current user
- `PUT /api/users/me` - Update user profile
- `PUT /api/users/me/password` - Change password
- `DELETE /api/users/me` - Delete account

## Troubleshooting

### Database Connection Issues
- Verify your Neon DB connection string is correct
- Check that your IP is allowed in Neon DB settings
- Ensure SSL mode is properly configured

### Port Already in Use
- Change the PORT in `.env` file
- Or kill the process using port 3000

### CORS Issues
- Allowed origins: **https://app.leasepilotai.com** (production), plus `http://localhost:3000` and `http://127.0.0.1:3000` for local dev.
- To add more origins, set `ALLOWED_ORIGINS` in `.env` (comma-separated), e.g. `ALLOWED_ORIGINS=https://app.leasepilotai.com,https://staging.example.com`.

## Production Deployment (Phase 2)

- **Production app URL:** https://app.leasepilotai.com

**Environment:** Copy `.env.example` to `.env` and set `NODE_ENV=production`, a strong `JWT_SECRET`, and `DATABASE_URL`. Optionally set `ALLOWED_ORIGINS`.

**Hardening in place:**
- **Security headers** (Helmet) and **rate limiting**: 100 req/15 min per IP for API, 10 req/15 min for auth (login/register).
- **DB robustness:** Server starts even without `DATABASE_URL`; `/api/health` reports `db: connected | unavailable | error`; other API routes return 503 when DB is unavailable.
- **Logging:** Each request is logged (method, path, status, duration). Production error handler does not send stack traces to clients.

1. Run `npm install` (adds `helmet`, `express-rate-limit`).
2. Update `.env` with production values.
3. Change `JWT_SECRET` to a strong random string.
4. Set `NODE_ENV=production`.
5. Use a process manager like PM2 or deploy to Vercel (see below).
6. Set up reverse proxy and SSL/TLS as needed.

### Deploying to Vercel

- The app is wired for Vercel: `vercel.json` rewrites `/api/*` to the serverless function; `api/index.js` exports the Express app; `server.js` only calls `app.listen()` when `VERCEL !== '1'` and exports the app.
- Set these environment variables in the Vercel project (Production and Preview as needed): `DATABASE_URL`, `JWT_SECRET`, `ALLOWED_ORIGINS`.

