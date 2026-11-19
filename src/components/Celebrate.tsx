import { useMemo } from 'react'
import { useApp } from '../lib/app.tsx'

/** A short burst of autumn leaves and stars (pure CSS, ~1.6 s). Reduced motion: a single gentle badge instead. */
export function Celebrate() {
  const { reducedMotion } = useApp()
  const bits = useMemo(() => Array.from({ length: 34 }, (_, i) => ({
    ch: ['🍂', '🍁', '✨', '⭐', '💛', '🧡'][i % 6],
    x: Math.round((Math.random() - 0.5) * 520), y: Math.round(-140 - Math.random() * 220), r: Math.round((Math.random() - 0.5) * 540), d: (Math.random() * 0.25).toFixed(2),
  })), [])
  if (reducedMotion) return <div className="celebrate-static" aria-hidden="true">✨</div>
  return (
    <div className="celebrate" aria-hidden="true">
      {bits.map((b, i) => <span key={i} style={{ '--x': `${b.x}px`, '--y': `${b.y}px`, '--r': `${b.r}deg`, animationDelay: `${b.d}s` } as React.CSSProperties}>{b.ch}</span>)}
    </div>
  )
}
