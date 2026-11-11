export function fmt(msLeft: number) {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
export function clock(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
export function duration(ms: number) {
  const m = Math.round(ms / 60000);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
