// Strava sign-in and sync, straight from the browser: there's no Overload
// server. Each lifter brings their own Strava API app (client ID + secret),
// stored on this device like the AI key.

import { fromStrava, type StravaActivity } from '../engine/strava';
export { codeFromPaste } from '../engine/strava';
import type { Activity, StravaLink } from '../engine/types';
import { db } from '../db/db';
import { refreshPlan } from '../db/repo';

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API_URL = 'https://www.strava.com/api/v3';
export const STRAVA_APPS_URL = 'https://www.strava.com/settings/api';

const STATE_KEY = 'overload.strava.state';
const DAY = 86_400_000;
/** How far back the first sync reaches. Recovery only looks back days; this also fills the history. */
const FIRST_SYNC_DAYS = 60;
/** Each sync re-reads a few days, for activities uploaded late from a watch. */
const OVERLAP = 3 * DAY;
const AUTO_SYNC_EVERY = 20 * 60_000;
const PER_PAGE = 100;
const MAX_PAGES = 10;
const MAX_REMOVED = 300;

export class StravaError extends Error {}

/** Where Strava sends the lifter back: this app, without the hash. */
export const redirectUri = () => `${location.origin}${location.pathname}`;
/** What goes in the Strava app's "Authorization Callback Domain". */
export const callbackDomain = () => location.hostname;

export const isConnected = (link: StravaLink | undefined): link is StravaLink & { refreshToken: string } => !!link?.refreshToken;

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

async function link(): Promise<StravaLink | undefined> {
  return (await db.profile.get('me'))?.strava;
}

async function saveLink(patch: Partial<StravaLink> | null): Promise<void> {
  const current = await link();
  if (patch === null) {
    await db.profile.update('me', { strava: undefined });
    return;
  }
  if (!current && !(patch.clientId && patch.clientSecret)) return;
  await db.profile.update('me', { strava: { ...current, ...patch } as StravaLink });
}

/** Stores the lifter's Strava API app, keeping any connection to the same app. */
export async function saveStravaApp(clientId: string, clientSecret: string): Promise<void> {
  const current = await link();
  const same = current?.clientId === clientId && current.clientSecret === clientSecret;
  await db.profile.update('me', { strava: same ? current : { clientId, clientSecret } });
}

/** Sends the lifter to Strava to approve access. They come back to `redirectUri()` with a code. */
export function beginConnect(clientId: string): void {
  const state = crypto.randomUUID();
  storage()?.setItem(STATE_KEY, state);
  const url = new URL(AUTHORIZE_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: 'read,activity:read_all',
    state,
  }).toString();
  location.assign(url.toString());
}

export interface StravaReturn {
  code?: string;
  error?: string;
  /** This browser started the sign-in; false when it began somewhere else (an installed iPhone app opens Strava in Safari). */
  ours: boolean;
}

/** The Strava sign-in result in the address bar, if this page load is one. */
export function readStravaReturn(): StravaReturn | null {
  const q = new URLSearchParams(location.search);
  const code = q.get('code') ?? undefined;
  const error = q.get('error') ?? undefined;
  if (!code && !error) return null;
  if (!q.has('state') && !q.has('scope')) return null;
  const pending = storage()?.getItem(STATE_KEY);
  return { code, error, ours: !!pending && pending === q.get('state') };
}

/** Takes the sign-in result out of the address bar, landing on `hash`. */
export function clearStravaReturn(hash = '#/settings'): void {
  storage()?.removeItem(STATE_KEY);
  history.replaceState(null, '', `${location.pathname}${hash}`);
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  /** Seconds since the epoch. */
  expires_at: number;
  athlete?: { firstname?: string; lastname?: string; username?: string };
}

/** fetch, turning network failures (including a browser blocking the request) into a plain message. */
async function call(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new StravaError(
      navigator.onLine === false
        ? "You're offline. Strava will sync when you're back online."
        : "Couldn't reach Strava. If this keeps happening, Strava may be blocking requests from browsers. Importing your Strava activities.csv works instead.",
    );
  }
}

async function failure(res: Response, during: string): Promise<StravaError> {
  if (res.status === 429) return new StravaError("Strava's rate limit is hit. Try again in 15 minutes.");
  let detail = '';
  try {
    const body = (await res.json()) as { message?: string; errors?: { resource?: string; field?: string; code?: string }[] };
    const e = body.errors?.[0];
    if (e?.field === 'client_id' || e?.field === 'client_secret' || e?.resource === 'Application') {
      return new StravaError('Strava didn\'t accept the Client ID or Client Secret. Copy them again from strava.com/settings/api.');
    }
    if (e?.field === 'code') return new StravaError('That sign-in code has expired or was already used. Connect again.');
    detail = [body.message, e && [e.resource, e.field, e.code].filter(Boolean).join(' ')].filter(Boolean).join(': ');
  } catch {
    // Not JSON; the status will do.
  }
  return new StravaError(`Strava said no while ${during} (${res.status}${detail ? `, ${detail}` : ''}).`);
}

async function requestToken(params: Record<string, string>, during: string): Promise<TokenResponse> {
  // A form-encoded POST is a "simple" request: no CORS preflight for Strava to refuse.
  const res = await call(TOKEN_URL, { method: 'POST', body: new URLSearchParams(params) });
  if (!res.ok) throw await failure(res, during);
  return (await res.json()) as TokenResponse;
}

const athleteName = (t: TokenResponse) =>
  [t.athlete?.firstname, t.athlete?.lastname].filter(Boolean).join(' ') || t.athlete?.username || undefined;

/** Swaps the code from Strava's redirect for tokens, then runs the first sync. */
export async function finishConnect(code: string): Promise<{ athlete?: string; added: number }> {
  const current = await link();
  if (!current?.clientId || !current.clientSecret) throw new StravaError('Add your Strava app’s Client ID and Secret first.');
  const t = await requestToken(
    { client_id: current.clientId, client_secret: current.clientSecret, code, grant_type: 'authorization_code' },
    'signing in',
  );
  const athlete = athleteName(t);
  await saveLink({ accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at * 1000, athlete, lastError: undefined, lastSyncAt: undefined, newestAt: undefined });
  const { added } = await syncStrava();
  return { athlete, added };
}

/** A working access token, refreshed when it's about to run out. */
async function accessToken(l: StravaLink & { refreshToken: string }): Promise<string> {
  if (l.accessToken && (l.expiresAt ?? 0) - 5 * 60_000 > Date.now()) return l.accessToken;
  const t = await requestToken(
    { client_id: l.clientId, client_secret: l.clientSecret, refresh_token: l.refreshToken, grant_type: 'refresh_token' },
    'refreshing access',
  );
  await saveLink({ accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: t.expires_at * 1000 });
  return t.access_token;
}

async function getActivities(token: string, after: number, page: number): Promise<StravaActivity[]> {
  const url = `${API_URL}/athlete/activities?after=${Math.floor(after / 1000)}&per_page=${PER_PAGE}&page=${page}`;
  const res = await call(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) throw new StravaError('Strava access was revoked or expired. Connect again.');
  if (!res.ok) throw await failure(res, 'reading activities');
  return (await res.json()) as StravaActivity[];
}

let running: Promise<{ added: number }> | null = null;

/** Pulls new Strava activities into the log. Safe to call often; it won't double up. */
export function syncStrava(): Promise<{ added: number }> {
  running ??= doSync().finally(() => {
    running = null;
  });
  return running;
}

async function doSync(): Promise<{ added: number }> {
  const l = await link();
  if (!isConnected(l)) throw new StravaError('Strava isn’t connected.');
  try {
    const token = await accessToken(l);
    const now = Date.now();
    const after = l.newestAt ? l.newestAt - OVERLAP : now - FIRST_SYNC_DAYS * DAY;
    const fetched: StravaActivity[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await getActivities(token, after, page);
      fetched.push(...batch);
      if (batch.length < PER_PAGE) break;
    }

    const removed = new Set(l.removed ?? []);
    const incoming = fetched
      .map(fromStrava)
      .filter((a): a is Activity => a !== null && !removed.has(a.id));
    const existing = new Set((await db.activities.bulkGet(incoming.map((a) => a.id))).filter(Boolean).map((a) => a!.id));
    const added = incoming.filter((a) => !existing.has(a.id));
    await db.activities.bulkPut(incoming);

    const starts = fetched.map((s) => Date.parse(s.start_date)).filter(Number.isFinite);
    const newestAt = Math.max(l.newestAt ?? 0, ...starts) || undefined;
    await saveLink({ lastSyncAt: now, newestAt, lastError: undefined });
    // Fresh cardio changes what's recovered; rebuild the waiting plan around it.
    if (added.some((a) => a.at > now - 2 * DAY)) await refreshPlan();
    return { added: added.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await saveLink({ lastError: message });
    throw err;
  }
}

/** Syncs quietly when the app opens or comes back to the front, at most every 20 minutes. */
export async function autoSyncStrava(): Promise<void> {
  const l = await link();
  if (!isConnected(l) || Date.now() - (l.lastSyncAt ?? 0) < AUTO_SYNC_EVERY) return;
  if (navigator.onLine === false) return;
  try {
    await syncStrava();
  } catch {
    // Recorded on the link; Settings shows it.
  }
}

/** Forgets the connection. Synced activities stay unless `removeActivities`. */
export async function disconnectStrava(removeActivities: boolean): Promise<void> {
  const l = await link();
  if (l?.accessToken) {
    // Best effort: also revoke the app's access on Strava's side.
    void fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', body: new URLSearchParams({ access_token: l.accessToken }) }).catch(() => undefined);
  }
  if (removeActivities) {
    const ids = (await db.activities.toArray()).filter((a) => a.source === 'strava').map((a) => a.id);
    await db.activities.bulkDelete(ids);
  }
  await saveLink(l ? { accessToken: undefined, refreshToken: undefined, expiresAt: undefined, athlete: undefined, lastSyncAt: undefined, newestAt: undefined, lastError: undefined, removed: undefined } : null);
}

/** Remembers a Strava activity the lifter deleted, so syncing doesn't restore it. */
export async function forgetStravaActivity(id: string): Promise<void> {
  const l = await link();
  if (!l) return;
  await saveLink({ removed: [...(l.removed ?? []).filter((x) => x !== id), id].slice(-MAX_REMOVED) });
}

