/** GitHub repository activity timestamps. Do not confuse these with the catalog's publication date. */
export function safeUpdatedTime(value?: string | null, now = Date.now()): number | null {
  if (!value || typeof value !== 'string') return null;
  const t = Date.parse(value);
  if (!Number.isFinite(t) || t < 0 || t > now + 24 * 60 * 60 * 1000) return null;
  return t;
}

export function daysSinceUpdated(value?: string | null, now = Date.now()): number | null {
  const time = safeUpdatedTime(value, now);
  return time === null ? null : Math.max(0, Math.floor((now - time) / 86_400_000));
}

export function isUpdatedWithinDays(value: string | null | undefined, days: number, now = Date.now()): boolean {
  const elapsed = daysSinceUpdated(value, now);
  return elapsed !== null && elapsed <= days;
}

export function readableUpdatedAt(value: string | null | undefined, now = Date.now()): string {
  const days = daysSinceUpdated(value, now);
  if (days === null) return 'date unavailable';
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 35) { const weeks = Math.floor(days / 7); return `${weeks} week${weeks !== 1 ? 's' : ''} ago`; }
  if (days < 365) { const months = Math.floor(days / 30); return `${months} month${months !== 1 ? 's' : ''} ago`; }
  const years = Math.floor(days / 365);
  return `${years} year${years !== 1 ? 's' : ''} ago`;
}
