/**
 * Skill99 CRM — end-to-end smoke test.
 *
 * Logs in as every seeded role and exercises every module's create/read/
 * update/delete endpoints against a REAL running server + database. This is
 * the closest thing to "manually clicking every option" that can be
 * automated — run it after `npm run db:seed` against your dev server (or
 * point BASE_URL at any deployed instance).
 *
 * Usage:
 *   node e2e-test.js
 *   BASE_URL=http://localhost:4001/api/v1 node e2e-test.js
 *
 * Requires Node 18+ (native fetch). No dependencies.
 *
 * Prints ✅ / ❌ per check and a summary at the end. Exits non-zero if any
 * check failed, so you can wire it into CI later.
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:4001/api/v1';
const ROOT_URL = BASE_URL.replace(/\/api\/v1\/?$/, '');

const results = [];
let pass = 0;
let fail = 0;

function record(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  \x1b[32m✔\x1b[0m ${name}`);
  } else {
    fail++;
    console.log(`  \x1b[31m✘\x1b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
  results.push({ name, ok, detail });
}

function section(title) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

async function call(method, path, { token, body, root } = {}) {
  try {
    const res = await fetch(`${root ? ROOT_URL : BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, json, ok: res.ok };
  } catch (err) {
    // Network-level failure (server not running, DNS, etc.) — surface as a
    // failed check instead of crashing the whole suite.
    return { status: 0, json: { error: err.message }, ok: false, networkError: true };
  }
}

/** Runs `fn`, records pass/fail based on whether the response status matches
 * `expect` (defaults to "any 2xx"), and returns the parsed JSON body. */
async function check(name, method, path, opts = {}) {
  const { expect, root, ...rest } = opts;
  const res = await call(method, path, { ...rest, root });
  const statusOk = expect ? res.status === expect : res.status >= 200 && res.status < 300;
  record(name, statusOk, statusOk ? undefined : `expected ${expect ?? '2xx'}, got ${res.status}: ${JSON.stringify(res.json)?.slice(0, 200)}`);
  return res.json?.data ?? res.json;
}

const rand = () => Math.random().toString(36).slice(2, 8);
const iso = (d) => d.toISOString();
const inDays = (n) => iso(new Date(Date.now() + n * 86400000));

async function main() {
  console.log(`Target: ${BASE_URL}\n`);

  // ── 0. Health ────────────────────────────────────────────────────────
  section('0. Health');
  await check('GET /health (server root, not under /api/v1)', 'GET', '/health', { root: true });

  // ── 1. Public endpoints ─────────────────────────────────────────────
  section('1. Public endpoints');
  await check('GET /public/plans', 'GET', '/public/plans');
  await check('GET /auth/companies', 'GET', '/auth/companies');
  const publicLeadPhone = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
  await check('POST /public/leads (website enquiry)', 'POST', '/public/leads', {
    body: { phone: publicLeadPhone, fullName: 'Public Test Lead', collegeName: 'Test College', source: 'WEBSITE', message: 'Interested in courses' },
  });

  // ── 2. Login as every seeded role ───────────────────────────────────
  section('2. Auth — login as every seeded role');
  const creds = {
    platformAdmin: { identifier: 'admin@skill99.com', password: 'Admin@123' },
    owner: { identifier: 'owner@skill99.com', password: 'Admin@123' },
    companyAdmin2: { identifier: 'companyadmin@skill99.com', password: 'Admin@12345' },
    tl: { identifier: 'tl@skill99.com', password: 'Tl@12345' },
    sales: { identifier: 'sales@skill99.com', password: 'Sales@123' },
    solo: { identifier: 'solo@skill99.com', password: 'Solo@12345' },
  };
  const tokens = {};
  const me = {};
  for (const [key, cred] of Object.entries(creds)) {
    const data = await check(`POST /auth/login (${key})`, 'POST', '/auth/login', { body: cred });
    tokens[key] = data?.token;
    if (tokens[key]) {
      const meData = await check(`GET /auth/me (${key})`, 'GET', '/auth/me', { token: tokens[key] });
      me[key] = meData;
    } else {
      record(`GET /auth/me (${key})`, false, 'skipped — no token from login');
    }
  }
  await check('PATCH /auth/profile (sales, self-update)', 'PATCH', '/auth/profile', {
    token: tokens.sales,
    body: { name: me.sales?.name || 'Sales Rep', timezone: 'Asia/Kolkata' },
  });

  if (!tokens.owner || !tokens.sales || !tokens.tl) {
    console.log('\n\x1b[31mCritical: one or more seeded logins failed — stopping here.\x1b[0m');
    console.log('Make sure you ran `npm run db:seed` against this exact database.');
    printSummary();
    process.exit(1);
  }

  // ── 3. Tenant isolation: Platform Admin must NOT see CRM data ───────
  section('3. Security — Platform Admin is blocked from CRM data');
  await check('GET /dashboard as PLATFORM_ADMIN → 403', 'GET', '/dashboard', { token: tokens.platformAdmin, expect: 403 });
  await check('GET /leads as PLATFORM_ADMIN → 403', 'GET', '/leads', { token: tokens.platformAdmin, expect: 403 });

  // ── 4. Leads (as SALES) ──────────────────────────────────────────────
  section('4. Leads — create, read, update, stage, activity, convert (as Sales)');
  const leadPhone = `8${Math.floor(100000000 + Math.random() * 899999999)}`;
  const lead = await check('POST /leads', 'POST', '/leads', {
    token: tokens.sales,
    body: { phone: leadPhone, fullName: `Lead ${rand()}`, collegeName: 'ABC Engineering College', collegeCity: 'Bengaluru', interest: 'INTERESTED', source: 'MANUAL' },
  });
  await check('GET /leads (list)', 'GET', '/leads', { token: tokens.sales });
  if (lead?.id) {
    await check('GET /leads/:id', 'GET', `/leads/${lead.id}`, { token: tokens.sales });
    await check('PATCH /leads/:id', 'PATCH', `/leads/${lead.id}`, { token: tokens.sales, body: { comments: 'Called once, interested' } });
    await check('PATCH /leads/:id/stage', 'PATCH', `/leads/${lead.id}/stage`, { token: tokens.sales, body: { stage: 'CONTACTED', note: 'First contact made' } });
    await check('POST /leads/:id/activities', 'POST', `/leads/${lead.id}/activities`, { token: tokens.sales, body: { type: 'NOTE', body: 'Follow-up scheduled for next week' } });
    await check('GET /leads/:id/activities', 'GET', `/leads/${lead.id}/activities`, { token: tokens.sales });
    await check('DELETE /leads/:id as SALES → 403 (only Owner/Solo can delete)', 'DELETE', `/leads/${lead.id}`, { token: tokens.sales, expect: 403 });
  }

  // A second lead, converted to a client (as Owner, who is allowed to delete/convert freely)
  const convertPhone = `7${Math.floor(100000000 + Math.random() * 899999999)}`;
  const leadToConvert = await check('POST /leads (for conversion)', 'POST', '/leads', {
    token: tokens.owner,
    body: { phone: convertPhone, fullName: `Convert ${rand()}`, collegeName: 'XYZ Institute', interest: 'INTERESTED' },
  });
  let convertedClient = null;
  if (leadToConvert?.id) {
    const converted = await check('POST /leads/:id/convert', 'POST', `/leads/${leadToConvert.id}/convert`, {
      token: tokens.owner,
      body: { note: 'Enrolled', createClient: true },
    });
    convertedClient = converted?.client;
    record('  → conversion created a Client record', !!convertedClient?.id, convertedClient ? undefined : 'no client in response');
  }

  await check('GET /dashboard (lead stats, as owner)', 'GET', '/dashboard', { token: tokens.owner });
  await check('GET /business-dashboard (as owner)', 'GET', '/business-dashboard', { token: tokens.owner });

  // ── 5. Clients / Projects / Retainers / Payments (as Owner) ─────────
  section('5. Clients, Projects, Retainers, Payments (as Company Admin)');
  const client = await check('POST /clients', 'POST', '/clients', {
    token: tokens.owner,
    body: { name: `Client ${rand()}`, email: `client${rand()}@example.com`, phone: '9876543210', status: 'ACTIVE' },
  });
  await check('GET /clients', 'GET', '/clients', { token: tokens.owner });
  if (client?.id) {
    await check('GET /clients/:id', 'GET', `/clients/${client.id}`, { token: tokens.owner });
    await check('PATCH /clients/:id', 'PATCH', `/clients/${client.id}`, { token: tokens.owner, body: { notes: 'VIP client' } });
  }

  let project = null, retainer = null;
  if (client?.id) {
    project = await check('POST /projects', 'POST', '/projects', {
      token: tokens.owner,
      body: { title: `Project ${rand()}`, clientId: client.id, budget: 50000, startDate: inDays(0) },
    });
    await check('GET /projects', 'GET', '/projects', { token: tokens.owner });
    if (project?.id) await check('PATCH /projects/:id', 'PATCH', `/projects/${project.id}`, { token: tokens.owner, body: { status: 'ONGOING' } });

    retainer = await check('POST /retainers', 'POST', '/retainers', {
      token: tokens.owner,
      body: { title: `Retainer ${rand()}`, clientId: client.id, monthlyAmount: 15000, startDate: inDays(0) },
    });
    await check('GET /retainers', 'GET', '/retainers', { token: tokens.owner });

    const payment = await check('POST /payments', 'POST', '/payments', {
      token: tokens.owner,
      body: { title: 'Advance payment', amount: 10000, type: 'REVENUE', status: 'RECEIVED', clientId: client.id },
    });
    await check('GET /payments', 'GET', '/payments', { token: tokens.owner });
    if (payment?.id) await check('PATCH /payments/:id', 'PATCH', `/payments/${payment.id}`, { token: tokens.owner, body: { status: 'RECEIVED' } });
  } else {
    record('Projects/Retainers/Payments block', false, 'skipped — no client id to attach to');
  }

  // ── 6. Messages, Meetings, Tasks ─────────────────────────────────────
  section('6. Messages, Meetings, Tasks');
  const message = await check('POST /messages', 'POST', '/messages', {
    token: tokens.owner,
    body: { body: 'Internal note about onboarding', channel: 'INTERNAL', clientId: client?.id ?? null },
  });
  await check('GET /messages', 'GET', '/messages', { token: tokens.owner });
  if (message?.id) await check('PATCH /messages/:id (mark read)', 'PATCH', `/messages/${message.id}`, { token: tokens.owner, body: { isRead: true } });

  const meeting = await check('POST /meetings', 'POST', '/meetings', {
    token: tokens.owner,
    body: { title: 'Kickoff call', startsAt: inDays(1), status: 'SCHEDULED', clientId: client?.id ?? null },
  });
  await check('GET /meetings', 'GET', '/meetings', { token: tokens.owner });
  if (meeting?.id) await check('PATCH /meetings/:id', 'PATCH', `/meetings/${meeting.id}`, { token: tokens.owner, body: { status: 'COMPLETED' } });

  const task = await check('POST /tasks', 'POST', '/tasks', {
    token: tokens.owner,
    body: { title: 'Send proposal', priority: 1, dueAt: inDays(2), assigneeId: me.sales?.id ?? null },
  });
  await check('GET /tasks', 'GET', '/tasks', { token: tokens.owner });
  if (task?.id) await check('PATCH /tasks/:id', 'PATCH', `/tasks/${task.id}`, { token: tokens.owner, body: { status: 'IN_PROGRESS' } });

  // ── 7. Settings / Organization ───────────────────────────────────────
  section('7. Settings');
  await check('GET /settings/organization', 'GET', '/settings/organization', { token: tokens.owner });
  await check('PATCH /settings/organization (as owner)', 'PATCH', '/settings/organization', { token: tokens.owner, body: { reminderLeadMinutes: 30 } });
  await check('PATCH /settings/organization as SALES → 403', 'PATCH', '/settings/organization', { token: tokens.sales, body: { reminderLeadMinutes: 10 }, expect: 403 });

  // ── 8. Reports ────────────────────────────────────────────────────────
  section('8. Reports (Company Admin / TL only)');
  await check('GET /reports/overview (owner)', 'GET', '/reports/overview', { token: tokens.owner });
  await check('GET /reports/by-source (owner)', 'GET', '/reports/by-source', { token: tokens.owner });
  await check('GET /reports/by-rep (tl)', 'GET', '/reports/by-rep', { token: tokens.tl });
  await check('GET /reports/overview as SALES → 403', 'GET', '/reports/overview', { token: tokens.sales, expect: 403 });

  // ── 9. Company / team management ────────────────────────────────────
  section('9. Company & team management');
  await check('GET /company/dashboard (owner)', 'GET', '/company/dashboard', { token: tokens.owner });
  await check('GET /company/tl-dashboard (tl)', 'GET', '/company/tl-dashboard', { token: tokens.tl });
  await check('GET /company/members', 'GET', '/company/members', { token: tokens.owner });
  await check('GET /company/dashboard as SALES → 403', 'GET', '/company/dashboard', { token: tokens.sales, expect: 403 });

  console.log('  \x1b[33mNote:\x1b[0m skipping live creation of a new TL/Sales member here — that');
  console.log('  flow sends a real WhatsApp OTP (printed to your backend console, not');
  console.log('  returned via the API) and needs a human to read + submit it. See');
  console.log('  "member-activation flow" below for how to test it by hand.');

  // ── 10. Devices & Calls (mobile caller) ─────────────────────────────
  section('10. Devices & Calls (as Sales)');
  const deviceId = `test-device-${rand()}`;
  const device = await check('POST /devices/register', 'POST', '/devices/register', {
    token: tokens.sales,
    body: { deviceId, deviceName: 'E2E Test Phone', platform: 'ANDROID', appVersion: '1.0.0' },
  });
  await check('GET /devices/me', 'GET', '/devices/me', { token: tokens.sales });
  await check('POST /devices/heartbeat', 'POST', '/devices/heartbeat', { token: tokens.sales, body: { deviceId: device?.id } });
  await check('GET /calls/dashboard', 'GET', '/calls/dashboard', { token: tokens.sales });
  await check('GET /calls', 'GET', '/calls', { token: tokens.sales });
  await check('GET /agents/me/talk-time', 'GET', '/agents/me/talk-time', { token: tokens.sales });

  if (device?.id && lead?.id) {
    const initiated = await check('POST /calls/initiate', 'POST', '/calls/initiate', {
      token: tokens.sales,
      body: { leadId: lead.id, deviceId: device.id },
    });
    if (initiated?.id) {
      await check('POST /calls/:id/events (CONNECTED)', 'POST', `/calls/${initiated.id}/events`, {
        token: tokens.sales, body: { eventId: `evt-${rand()}`, state: 'CONNECTED' },
      });
      await check('POST /calls/:id/events (ENDED)', 'POST', `/calls/${initiated.id}/events`, {
        token: tokens.sales, body: { eventId: `evt-${rand()}`, state: 'ENDED' },
      });
      await check('GET /calls/:id', 'GET', `/calls/${initiated.id}`, { token: tokens.sales });
    }
  }
  await check('GET /devices/me/commands', 'GET', '/devices/me/commands', { token: tokens.sales });
  await check('GET /devices (list, as owner)', 'GET', '/devices', { token: tokens.owner });
  if (device?.id) await check('DELETE /devices/:id (revoke, as owner)', 'DELETE', `/devices/${device.id}`, { token: tokens.owner });

  // ── 11. Platform Admin ────────────────────────────────────────────────
  section('11. Platform Admin');
  await check('GET /admin/overview', 'GET', '/admin/overview', { token: tokens.platformAdmin });
  await check('GET /admin/companies', 'GET', '/admin/companies', { token: tokens.platformAdmin });
  await check('GET /admin/plans', 'GET', '/admin/plans', { token: tokens.platformAdmin });
  await check('GET /admin/freelancers', 'GET', '/admin/freelancers', { token: tokens.platformAdmin });

  const newCompany = await check('POST /admin/companies (create tenant)', 'POST', '/admin/companies', {
    token: tokens.platformAdmin,
    body: {
      companyName: `E2E Test Co ${rand()}`,
      ownerEmail: `owner+${rand()}@example.com`,
      ownerPassword: 'TestPass123',
      ownerName: 'E2E Owner',
      planTier: 'COMPANY_STARTER',
    },
  });
  if (newCompany?.id ?? newCompany?.company?.id) {
    const companyId = newCompany.id ?? newCompany.company.id;
    await check('GET /admin/companies/:id', 'GET', `/admin/companies/${companyId}`, { token: tokens.platformAdmin });
    await check('PATCH /admin/companies/:id/status', 'PATCH', `/admin/companies/${companyId}/status`, { token: tokens.platformAdmin, body: { status: 'ACTIVE' } });
    await check('PATCH /admin/companies/:id/subscription', 'PATCH', `/admin/companies/${companyId}/subscription`, { token: tokens.platformAdmin, body: { planTier: 'COMPANY_GROWTH' } });
  }
  if (me.solo?.id) {
    await check('PATCH /admin/freelancers/:id/subscription', 'PATCH', `/admin/freelancers/${me.solo.id}/subscription`, { token: tokens.platformAdmin, body: { planTier: 'SOLO_PRO' } });
    await check('PATCH /admin/freelancers/:id/status', 'PATCH', `/admin/freelancers/${me.solo.id}/status`, { token: tokens.platformAdmin, body: { isActive: true } });
  }
  await check('POST /admin/companies as COMPANY_ADMIN → 403', 'POST', '/admin/companies', {
    token: tokens.owner, body: { companyName: 'x', ownerEmail: 'x@x.com', ownerPassword: 'password1', ownerName: 'x' }, expect: 403,
  });

  // ── 12. Public reviews ────────────────────────────────────────────────
  section('12. Public reviews & org slug');
  const org = await check('GET /settings/organization (to read publicSlug)', 'GET', '/settings/organization', { token: tokens.owner });
  const slug = org?.publicSlug || 'skill99';
  await check('POST /public/reviews', 'POST', '/public/reviews', {
    body: { rating: 5, comment: 'Great service!', reviewer: 'E2E Tester', clientId: client?.id ?? null },
  });
  await check(`GET /public/reviews/${slug}`, 'GET', `/public/reviews/${slug}`);

  // ── 13. Cleanup / delete flows ────────────────────────────────────────
  section('13. Delete flows (as Company Admin, who is allowed to delete)');
  if (task?.id) await check('DELETE /tasks/:id', 'DELETE', `/tasks/${task.id}`, { token: tokens.owner });
  if (meeting?.id) await check('DELETE /meetings/:id', 'DELETE', `/meetings/${meeting.id}`, { token: tokens.owner });
  if (message?.id) await check('DELETE /messages/:id', 'DELETE', `/messages/${message.id}`, { token: tokens.owner });
  if (retainer?.id) await check('DELETE /retainers/:id', 'DELETE', `/retainers/${retainer.id}`, { token: tokens.owner });
  if (project?.id) await check('DELETE /projects/:id', 'DELETE', `/projects/${project.id}`, { token: tokens.owner });
  if (client?.id) await check('DELETE /clients/:id', 'DELETE', `/clients/${client.id}`, { token: tokens.owner });
  if (leadToConvert?.id) await check('DELETE /leads/:id (as owner)', 'DELETE', `/leads/${leadToConvert.id}`, { token: tokens.owner });

  printSummary();
  process.exit(fail > 0 ? 1 : 0);
}

function printSummary() {
  console.log(`\n\x1b[1mSummary:\x1b[0m ${pass} passed, ${fail} failed, ${pass + fail} total\n`);
  if (fail > 0) {
    console.log('Failed checks:');
    for (const r of results.filter((r) => !r.ok)) console.log(`  - ${r.name}: ${r.detail}`);
  }
}

main().catch((err) => {
  console.error('\n\x1b[31mFatal error running the test suite:\x1b[0m', err);
  process.exit(1);
});
