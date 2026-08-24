// Pure formatters, deliberately in their own module.
//
// They used to live in components.tsx, which destructures Spicetify.React at
// module scope -- so importing a formatter dragged in the whole client, and
// anything that wanted one under Node had to stand up a fake Spicetify first.
// Nothing here touches the client.

export const fmtInt = (n: number) => n.toLocaleString();

/** 1.2M rather than 1,234,567: play counts are read, not audited. */
export function fmtCompact(n: number): string {
  if (!n) return '';
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(n < 10_000_000 ? 1 : 0)}M`;
  return `${(n / 1_000_000_000).toFixed(1)}B`;
}

export function fmtDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * A single track's length, as a listing shows it: 3:42, or 1:02:15 for
 * something long. fmtDuration rounds to whole minutes, which is right for
 * "how much music is in this library" and useless per track -- every song
 * came out as "3m" or "4m".
 */
export function fmtTrackLength(ms: number): string {
  if (!ms) return '—';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export const fmtDate = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
