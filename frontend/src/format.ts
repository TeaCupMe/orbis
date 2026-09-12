export function pct(x: number) {
  return `${(x * 100).toFixed(1)}%`
}

export function formatTime(s: number) {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${h}ч ${m.toString().padStart(2, '0')}м`
}

export function formatSavedAt(iso?: string) {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

export function deltaPct(a: number, b: number) {
  const d = (b - a) * 100
  const sign = d > 0 ? '+' : ''
  return `${sign}${d.toFixed(1)} п.п.`
}
