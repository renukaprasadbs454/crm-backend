# Skill99 CRM Backend

Express + Prisma + PostgreSQL API for the Skill99 CRM.

## Stack

- Node.js / Express (ES modules)
- PostgreSQL / Prisma 5
- JWT authentication
- Zod request validation
- Helmet, CORS and rate limiting

## Roles

- `PLATFORM_ADMIN` — platform metadata and tenant management only
- `COMPANY_ADMIN` — full company CRM and team management (any company can have more than one; there is no separate Owner tier)
- `TL` — team-scoped CRM access and salesperson management
- `SALES` — own/assigned CRM records
- `SOLO` — own workspace records

## Local setup

```bash
npm install
copy .env.example .env
npm run db:generate
npm run db:push
npm run db:seed
npm run dev
```

macOS/Linux: replace `copy` with `cp`.

API: `http://localhost:4001`
Health: `GET /health`
Base: `/api/v1`

## Supabase Postgres and Cloudflare R2

The production backend can use Supabase Postgres for the database and Cloudflare R2 for call recordings. Prisma uses the Supabase pooled connection at runtime and the direct connection for migrations.

1. In Supabase, create a project and copy both connection strings from **Connect**:
	- `DATABASE_URL`: Transaction pooler, usually port `6543`, with `?pgbouncer=true&connection_limit=1`.
	- `DIRECT_URL`: Direct connection, usually port `5432`. If your deployment cannot reach IPv6, use Supabase's session pooler connection for migrations instead.
2. Set `DATABASE_URL` and `DIRECT_URL` in the backend deployment environment. Do not commit them.
3. From the backend directory, run migrations against Supabase:

	```powershell
	npm run db:generate
	npm run db:migrate:deploy
	```

4. In Cloudflare, open **R2**, create a bucket, then create an API token with **Object Read & Write** permission for that bucket. Copy the Access Key ID and Secret Access Key once.
5. Configure the backend environment:

	```env
	STORAGE_PROVIDER=r2
	R2_ACCOUNT_ID=your-cloudflare-account-id
	R2_ACCESS_KEY_ID=your-r2-access-key-id
	R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
	R2_BUCKET=skill99-recordings
	R2_PUBLIC_URL=
	```

	Keep `R2_PUBLIC_URL` blank for a private bucket. The backend stores the object key in Postgres and uploads bytes directly to R2. A public URL or signed-download endpoint can be added later if recordings need to be played in the CRM.
6. Set production-only values such as `NODE_ENV=production`, a long random `JWT_SECRET`, `CORS_ORIGIN`, and `FRONTEND_URL`, then deploy the backend.

For local development, leave `STORAGE_PROVIDER=local` and recordings are written under `RECORDINGS_DIR`. The same Prisma migrations work locally and on Supabase. Never expose the Supabase database password or R2 secret in frontend or mobile builds.

## Main modules

Authentication, leads/pipeline/activity, clients, projects, retainers, payments, messages, meetings, tasks, reports, company/team management, platform administration, and public lead/review pages.

## Security notes

All CRM reads/writes are tenant/role scoped. Cross-module foreign keys are also checked before create/update operations so a valid UUID from another tenant cannot be attached to a record in the current tenant.

## Tests

```bash
npm test
```


## Member invitation + WhatsApp OTP

A Company Admin can add other Company Admins and TLs. A Company Admin or TL can add Sales users. The inviter supplies the user's name, email and WhatsApp number; no temporary password is created. The backend sends a one-time WhatsApp OTP. The invited user opens `/activate`, verifies the OTP, creates their own password and is signed in automatically.

For local development use `WHATSAPP_PROVIDER=console`; the OTP is printed in the API terminal. For production configure the Meta WhatsApp Cloud API or Twilio settings in `.env`. See `src/services/README-whatsapp.md`.

## Demo logins after `npm run db:seed`

- Platform Admin: `admin@skill99.com` / `Admin@123`
- Company Admin: `owner@skill99.com` / `Admin@123`
- Team Lead: `tl@skill99.com` / `Tl@12345`
- Sales: `sales@skill99.com` / `Sales@123`

The Platform Admin only receives company metadata/usage and subscription management; it is deliberately blocked from CRM records.
