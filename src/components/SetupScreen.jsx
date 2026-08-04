import { useState } from 'react'
import { COURSES } from '../lib/golf'

const FORMATS = [
  { id: 'nassau', label: 'Nassau', icon: '⚔️', desc: 'Front 9 / Back 9 / Total com press automático' },
  { id: 'skins',  label: 'Skins',  icon: '💰', desc: 'Cada buraco vale 1 skin. Empates acumulam.' },
  { id: 'stableford', label: 'Stableford', icon: '📊', desc: 'Pontos por buraco (birdie=3, par=2, bogey=1)' },
]

export default function SetupScreen({ onStart, onBack, session }) {
  const [format, setFormat]       = useState('nassau')
  const [numPlayers, setNumPlayers] = useState(4)
  const [players, setPlayers]     = useState([
    { name: '', handicap: 0 },
    { name: '', handicap: 0 },
    { name: '', handicap: 0 },
    { name: '', handicap: 0 },
  ])
  const [course, setCourse]       = useState(COURSES[0])
  const [si, setSi]               = useState([...COURSES[0].si])
  const [par, setPar]             = useState([...COURSES[0].par])
  const [teamA, setTeamA]         = useState([0, 1])
  const [teamB, setTeamB]         = useState([2, 3])
  const [playWithin, setPlayWithin] = useState(false)

  // Nassau bets
  const [betValues, setBetValues] = useState({ frontVal: 20, backVal: 20, totalVal: 40 })
  // Skins / Stableford bet
  const [betUnit, setBetUnit]     = useState(20)

  const updPlayer = (i, f, v) =>
    setPlayers(prev => prev.map((p, pi) => pi === i ? { ...p, [f]: f === 'handicap' ? Number(v) : v } : p))

  const toggleTeam = (pi) => {
    if (teamA.includes(pi)) {
      if (teamA.length > 1) { setTeamA(teamA.filter(x => x !== pi)); setTeamB([...teamB, pi].sort()) }
    } else {
      if (teamB.length > 1) { setTeamB(teamB.filter(x => x !== pi)); setTeamA([...teamA, pi].sort()) }
    }
  }

  const selectCourse = (c) => { setCourse(c); setSi([...c.si]); setPar([...c.par]) }

  const canStart = players.slice(0, numPlayers).every(p => p.name.trim())

  const handleStart = () => {
    onStart({
      format,
      players: players.slice(0, numPlayers),
      course, si, par,
      teamA, teamB, playWithin,
      betValues: format === 'nassau' ? betValues : { frontVal: betUnit, backVal: betUnit, totalVal: betUnit },
      betUnit,
      numPlayers,
    })
  }

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">⛳ Nassau<span>App</span></span>
        <div style={{ width: 60 }}/>
      </header>

      <div className="screen-body">

        {/* Format */}
        <div className="card">
          <h2>Formato de jogo</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FORMATS.map(f => (
              <button key={f.id}
                className={`toggle-btn${format === f.id ? ' active' : ''}`}
                style={{ textAlign: 'left', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}
                onClick={() => setFormat(f.id)}>
                <span style={{ fontSize: 20 }}>{f.icon}</span>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{f.label}</div>
                  <div style={{ fontSize: 11, opacity: 0.7, marginTop: 1 }}>{f.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Players */}
        <div className="card">
          <h2>Jogadores</h2>
          <div className="toggle-row">
            {[2,3,4].map(n => (
              <button key={n} className={`toggle-btn${numPlayers === n ? ' active' : ''}`}
                onClick={() => setNumPlayers(n)}>{n} jogadores</button>
            ))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {Array.from({ length: numPlayers }, (_, i) => (
              <div key={i} style={{
                background: 'rgba(0,0,0,0.2)', borderRadius: 10, padding: 12,
                borderLeft: `3px solid ${i < 2 ? '#4488cc' : '#cc4444'}`
              }}>
                <input
                  className="text-input" placeholder={`Jogador ${i + 1}`}
                  value={players[i].name}
                  onChange={e => updPlayer(i, 'name', e.target.value)}
                  style={{ marginBottom: 8, fontSize: 13, padding: '7px 10px' }}
                />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                  <span>HCP</span>
                  <input type="number" min="-10" max="54"
                    className="num-input"
                    value={players[i].handicap}
                    onChange={e => updPlayer(i, 'handicap', e.target.value)}
                    style={{ width: 52, height: 32, fontSize: 13 }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Teams (Nassau only with 4 players) */}
        {format === 'nassau' && numPlayers === 4 && (
          <div className="card">
            <h2>Formação das duplas</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <button key={i}
                  style={{
                    padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
                    border: `2px solid ${teamA.includes(i) ? '#4488cc' : '#cc4444'}`,
                    background: teamA.includes(i) ? 'rgba(68,136,204,0.15)' : 'rgba(204,68,68,0.15)',
                    color: teamA.includes(i) ? '#7ab5f0' : '#f07a7a',
                    fontFamily: "'DM Sans', sans-serif",
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                  }}
                  onClick={() => toggleTeam(i)}>
                  <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.8 }}>
                    {teamA.includes(i) ? 'Dupla A' : 'Dupla B'}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700 }}>{players[i].name || `J${i+1}`}</span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 10 }}>
              <span style={{ color: '#7ab5f0' }}>A: {teamA.map(i => players[i].name || `J${i+1}`).join(' / ')}</span>
              <span style={{ color: '#f07a7a' }}>B: {teamB.map(i => players[i].name || `J${i+1}`).join(' / ')}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.08)' }}
              onClick={() => setPlayWithin(v => !v)}>
              <div style={{
                width: 44, height: 24, borderRadius: 12, padding: 2,
                background: playWithin ? 'var(--green2)' : 'rgba(255,255,255,0.15)',
                transition: 'background .2s', flexShrink: 0,
              }}>
                <div style={{
                  width: 20, height: 20, background: '#fff', borderRadius: '50%',
                  transform: playWithin ? 'translateX(20px)' : 'translateX(0)',
                  transition: 'transform .2s',
                }}/>
              </div>
              <span style={{ fontSize: 13, color: 'var(--cream)' }}>
                Individual dentro da dupla ({playWithin ? 'sim' : 'não'})
              </span>
            </div>
          </div>
        )}

        {/* Bets */}
        <div className="card">
          <h2>Valores das apostas (R$)</h2>
          {format === 'nassau' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[['frontVal','Front 9'],['backVal','Back 9'],['totalVal','Total 18']].map(([k,l]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div className="field-label" style={{ textAlign: 'center' }}>{l}</div>
                  <input type="number" min="1"
                    style={{ width: 72, height: 44, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'var(--gold)', fontSize: 18, fontWeight: 700, textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}
                    value={betValues[k]}
                    onChange={e => setBetValues(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div className="field-label">{format === 'skins' ? 'Valor por Skin' : 'Valor por Ponto'}</div>
              <input type="number" min="1"
                style={{ width: 80, height: 44, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, color: 'var(--gold)', fontSize: 20, fontWeight: 700, textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}
                value={betUnit}
                onChange={e => setBetUnit(Number(e.target.value))}
              />
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>R$</span>
            </div>
          )}
        </div>

        {/* Course */}
        <div className="card">
          <h2>Campo</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {COURSES.map(c => (
              <button key={c.id}
                style={{
                  padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                  border: `1px solid ${course.id === c.id ? 'var(--gold)' : 'rgba(255,255,255,0.12)'}`,
                  background: course.id === c.id ? 'rgba(201,168,76,0.12)' : 'rgba(0,0,0,0.2)',
                  color: 'var(--cream)', fontFamily: "'DM Sans', sans-serif",
                }}
                onClick={() => selectCourse(c)}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{c.name}</div>
                {c.city && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{c.city}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* SI (collapsible) */}
        <div className="card">
          <h2>Índice Stroke — {course.name}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 5 }}>
            {Array.from({ length: 18 }, (_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>B{i+1}</div>
                <input type="number" min="1" max="18"
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'var(--cream)', fontSize: 11, fontWeight: 600, padding: '3px 2px', textAlign: 'center', fontFamily: "'DM Sans', sans-serif" }}
                  value={si[i]}
                  onChange={e => setSi(prev => prev.map((v,vi) => vi===i ? Number(e.target.value) : v))}
                />
              </div>
            ))}
          </div>
        </div>

        <button className="btn-primary" onClick={handleStart} disabled={!canStart}>
          Iniciar Rodada →
        </button>
      </div>
    </div>
  )
}
