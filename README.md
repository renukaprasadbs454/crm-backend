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
