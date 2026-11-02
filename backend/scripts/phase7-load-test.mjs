import { performance } from 'node:perf_hooks';

const baseUrl = new URL(process.env.HMS_LOAD_TEST_BASE_URL ?? 'http://127.0.0.1:8080');
if (!['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname)) {
  throw new Error('This load test is restricted to localhost; remote targets are not allowed.');
}

const tenantSlug = process.env.HMS_LOAD_TEST_TENANT;
const login = process.env.HMS_LOAD_TEST_LOGIN;
const password = process.env.HMS_LOAD_TEST_PASSWORD;
if (!tenantSlug || !login || !password) {
  throw new Error('Set HMS_LOAD_TEST_TENANT, HMS_LOAD_TEST_LOGIN, and HMS_LOAD_TEST_PASSWORD for the local seeded test account.');
}

const durationSeconds = Number(process.env.HMS_LOAD_TEST_DURATION_SECONDS ?? 30);
const targetRps = Number(process.env.HMS_LOAD_TEST_TARGET_RPS ?? 100);
if (!Number.isInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 60) {
  throw new Error('HMS_LOAD_TEST_DURATION_SECONDS must be from 1 to 60.');
}
if (!Number.isInteger(targetRps) || targetRps < 1 || targetRps > 100) {
  throw new Error('HMS_LOAD_TEST_TARGET_RPS must be from 1 to 100.');
}

async function requestJson(path, options) {
  const response = await fetch(new URL(path, baseUrl), options);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`Setup request ${path} failed with HTTP ${response.status}.`);
  }
  return body;
}

const loginResponse = await fetch(new URL('/api/v1/auth/login', baseUrl), {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ tenantSlug, login, password }),
});
const auth = await loginResponse.json().catch(() => null);
if (!loginResponse.ok) throw new Error(`Local login failed with HTTP ${loginResponse.status}.`);
if (typeof auth?.accessToken !== 'string') throw new Error('Local login did not return an access token.');
const refreshToken = loginResponse.headers.get('set-cookie')?.match(/hms_refresh=([^;]+)/)?.[1];
if (!refreshToken) throw new Error('Local login did not return the expected refresh cookie; refusing to leave an untracked test session.');

try {
const branches = await requestJson('/api/v1/branches', {
  headers: { authorization: `Bearer ${auth.accessToken}` },
});
const requestedBranch = process.env.HMS_LOAD_TEST_BRANCH_ID;
const branch = Array.isArray(branches)
  ? branches.find((candidate) => !requestedBranch || candidate.id === requestedBranch)
  : null;
if (!branch?.id) throw new Error('No authorized branch matched the optional HMS_LOAD_TEST_BRANCH_ID.');

const endpoint = `/api/v1/branches/${branch.id}/offline-dashboard`;
const durations = [];
const statusCounts = new Map();
let failures = 0;
let networkErrors = 0;
let firstNetworkError = null;
const start = performance.now();
const end = start + durationSeconds * 1000;
const interval = 1000 / targetRps;
const requests = [];

async function measure() {
  const requestStart = performance.now();
  try {
    const response = await fetch(new URL(endpoint, baseUrl), {
      headers: { authorization: `Bearer ${auth.accessToken}` },
    });
    durations.push(performance.now() - requestStart);
    statusCounts.set(response.status, (statusCounts.get(response.status) ?? 0) + 1);
    if (!response.ok) failures += 1;
    await response.body?.cancel();
  } catch (error) {
    durations.push(performance.now() - requestStart);
    failures += 1;
    networkErrors += 1;
    if (!firstNetworkError) {
      firstNetworkError = error instanceof Error ? error.message : String(error);
    }
  }
}

for (let scheduledAt = start; scheduledAt < end; scheduledAt += interval) {
  requests.push(measure());
  const remaining = scheduledAt + interval - performance.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
}
await Promise.all(requests);

durations.sort((a, b) => a - b);
const percentile = (p) => durations.length
  ? durations[Math.min(durations.length - 1, Math.ceil(durations.length * p) - 1)]
  : Number.POSITIVE_INFINITY;
const elapsedSeconds = (performance.now() - start) / 1000;
const achievedRps = durations.length / elapsedSeconds;
const p95Ms = percentile(0.95);
const results = {
  endpoint,
  requestedRps: targetRps,
  achievedRps: Number(achievedRps.toFixed(2)),
  elapsedSeconds: Number(elapsedSeconds.toFixed(2)),
  requests: durations.length,
  failures,
  networkErrors,
  firstNetworkError,
  statuses: Object.fromEntries(statusCounts),
  p50Ms: Number(percentile(0.5).toFixed(2)),
  p95Ms: Number(p95Ms.toFixed(2)),
  target: 'p95 <= 500ms at 100 requests/second',
};
console.log(JSON.stringify(results, null, 2));

if (achievedRps < targetRps * 0.95 || failures > 0 || p95Ms > 500) {
  console.error('FAIL: local run did not meet the documented performance target.');
  process.exitCode = 1;
} else {
  console.log('PASS: local synthetic run met the documented target.');
}
} finally {
  const logout = await fetch(new URL('/api/v1/auth/logout', baseUrl), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!logout.ok) {
    console.error(`Cleanup warning: could not revoke the load-test refresh session (HTTP ${logout.status}).`);
    process.exitCode = 1;
  }
}
