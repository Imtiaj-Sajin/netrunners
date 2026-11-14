// Token & cost accounting. Prices are USD per million tokens (approximate, from Anthropic's
// published rates; edit PRICES if they change). Cache writes are the 5-minute TTL rate.

export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }
export const PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 }, // possible server-side fallback for Sonnet 5.5
};
export const WEB_SEARCH_USD = 0.01; // $10 per 1,000 searches

export interface Bucket {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  webSearches: number;
  costUsd: number;
  errors: number;
}

export const emptyBucket = (): Bucket => ({ calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, webSearches: 0, costUsd: 0, errors: 0 });

export interface Ledger {
  total: Bucket;
  byModel: Record<string, Bucket>;
  byPurpose: Record<string, Bucket>;
  byNetrunner: Record<string, Bucket>;
}

export const emptyLedger = (): Ledger => ({ total: emptyBucket(), byModel: {}, byPurpose: {}, byNetrunner: {} });

export interface CallUsage { input: number; output: number; cacheRead: number; cacheWrite: number; webSearches: number }

export function costOf(model: string, u: CallUsage): number {
  const p = PRICES[model] ?? PRICES["claude-sonnet-5-5"];
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.cacheWrite) / 1e6 + u.webSearches * WEB_SEARCH_USD;
}

function add(b: Bucket, u: CallUsage, cost: number, error: boolean) {
  b.calls += 1;
  b.input += u.input;
  b.output += u.output;
  b.cacheRead += u.cacheRead;
  b.cacheWrite += u.cacheWrite;
  b.webSearches += u.webSearches;
  b.costUsd = Math.round((b.costUsd + cost) * 1e6) / 1e6;
  if (error) b.errors += 1;
}

export function record(l: Ledger, model: string, purpose: string, netrunner: string, u: CallUsage, cost: number, error = false) {
  add(l.total, u, cost, error);
  add((l.byModel[model] ??= emptyBucket()), u, cost, error);
  add((l.byPurpose[purpose] ??= emptyBucket()), u, cost, error);
  add((l.byNetrunner[netrunner] ??= emptyBucket()), u, cost, error);
}

export function mergeLedgers(ls: Ledger[]): Ledger {
  const out = emptyLedger();
  const merge = (dst: Bucket, src: Bucket) => {
    for (const k of Object.keys(src) as (keyof Bucket)[]) dst[k] = Math.round(((dst[k] ?? 0) + (src[k] ?? 0)) * 1e6) / 1e6;
  };
  for (const l of ls) {
    if (!l?.total) continue;
    merge(out.total, l.total);
    for (const [k, b] of Object.entries(l.byModel ?? {})) merge((out.byModel[k] ??= emptyBucket()), b);
    for (const [k, b] of Object.entries(l.byPurpose ?? {})) merge((out.byPurpose[k] ??= emptyBucket()), b);
  }
  return out;
}
