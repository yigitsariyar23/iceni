// Pure formatters, deliberately in their own module.
//
// They used to live in components.tsx, which destructures Spicetify.React at
// module scope -- so importing a formatter dragged in the whole client, and
// anything that wanted one under Node had to stand up a fake Spicetify first.
// Nothing here touches the client.

export const fmtInt = (n: number) => n.toLocaleString();

export function fmtDuration(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export const fmtDate = (ms: number) => (ms ? new Date(ms).toISOString().slice(0, 10) : '—');
