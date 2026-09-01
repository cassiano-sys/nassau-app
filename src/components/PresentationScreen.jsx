import { useState, useEffect } from 'react'

export default function PresentationScreen({ onBack }) {
  const data = window._nassauPresentation || null
  const [current, setCurrent] = useState(0)
  const [revealed, setRevealed] = useState(false)

  if (!data) return (
    <div className="presentation-screen">
      <div style={{ textAlign: 'center', color: 'var(--muted2)' }}>
        <p style={{ fontFamily: 'var(--serif)', fontSize: 18, marginBottom: 8 }}>Nenhum resultado disponível</p>
        <button className="back-btn" onClick={onBack}>← Voltar</button>
      </div>
    </div>
  )

  const { players, playerMoney, course, tLA, tLB } = data

  // Sort by money descending for reveal (winner last = most suspense)
  const sorted = [...players.map((p, i) => ({ name: p.name, money: playerMoney[i] }))]
    .sort((a, b) => a.money - b.money) // losers first, winner last

  const current_player = sorted[current]
  const isLast = current >= sorted.length - 1
  const fmtMoney = v => `${v > 0 ? '+' : ''}R$${Math.abs(v)}`

  const handleNext = () => {
    if (isLast) { onBack(); return }
    setRevealed(false)
    setTimeout(() => { setCurrent(c => c + 1); setRevealed(true) }, 150)
  }

  useEffect(() => {
    setTimeout(() => setRevealed(true), 300)
  }, [])

  return (
    <div className="presentation-screen" onClick={handleNext}
      style={{ cursor: 'pointer', userSelect: 'none' }}>

      {/* Top */}
      <div style={{ position: 'absolute', top: 20, left: 0, right: 0, display: 'flex', justifyContent: 'space-between', padding: '0 20px' }}>
        <button className="back-btn" onClick={e => { e.stopPropagation(); onBack() }}
          style={{ fontSize: 12, padding: '5px 12px' }}>
          ← Sair
        </button>
        <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '2px', textTransform: 'uppercase', lineHeight: '28px' }}>
          {current + 1} / {sorted.length}
        </div>
      </div>

      {/* Course info */}
      <div className="presentation-course">{course?.name || 'Nassau'}</div>
      <div className="presentation-date" style={{ marginBottom: 32 }}>
        {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
      </div>

      <div className="presentation-divider"/>

      {/* Player result */}
      <div style={{
        opacity: revealed ? 1 : 0,
        transform: revealed ? 'translateY(0)' : 'translateY(20px)',
        transition: 'all 0.4s ease',
        textAlign: 'center',
      }}>
        <div className="presentation-name">{current_player?.name}</div>
        <div className={`presentation-amount ${current_player?.money > 0 ? 'pos' : current_player?.money < 0 ? 'neg' : 'neu'}`}>
          {fmtMoney(current_player?.money || 0)}
        </div>
      </div>

      <div className="presentation-divider"/>

      {/* Others (shown small) */}
      {current > 0 && (
        <div className="presentation-others">
          {sorted.slice(0, current).map((p, i) => (
            <div key={i} className="presentation-other">
              <div className="presentation-other-name">{p.name}</div>
              <div className={`presentation-other-val ${p.money > 0 ? 'pos' : p.money < 0 ? 'neg' : 'neu'}`}>
                {fmtMoney(p.money)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Next button */}
      <div className="presentation-next" style={{ marginTop: 32 }}>
        {isLast ? '✓  Encerrar' : '▶  Próximo jogador'}
      </div>

      <p style={{ fontSize: 9, color: 'var(--muted)', marginTop: 12, letterSpacing: '1px', opacity: 0.5 }}>
        Toque em qualquer lugar para avançar
      </p>
    </div>
  )
}
