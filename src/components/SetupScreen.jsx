import { useState, useEffect } from 'react'
import { COURSES } from '../lib/golf'
import { supabase } from '../lib/supabase'

const FORMATS = [
  { id: 'nassau',     label: 'Nassau',     icon: '⚔️', desc: 'Front 9 / Back 9 / Total com press automático' },
  { id: 'skins',     label: 'Skins',      icon: '💰', desc: 'Cada buraco vale 1 skin. Empates acumulam.' },
  { id: 'stableford',label: 'Stableford', icon: '📊', desc: 'Pontos por buraco (birdie=3, par=2, bogey=1)' },
]

export default function SetupScreen({ onStart, onBack, session }) {
  const [format,     setFormat]     = useState('nassau')
  const [numPlayers, setNumPlayers] = useState(4)
  const [players,    setPlayers]    = useState([
    { name: '', handicap: 0 },
    { name: '', handicap: 0 },
    { name: '', handicap: 0 },
    { name: '', handicap: 0 },
  ])
  const [course,     setCourse]     = useState(COURSES[0])
  const [si,         setSi]         = useState([...COURSES[0].si])
  const [par,        setPar]        = useState([...COURSES[0].par])
  const [teamA,      setTeamA]      = useState([0, 1])
  const [teamB,      setTeamB]      = useState([2, 3])
  const [playWithin, setPlayWithin] = useState(false)
  const [betValues,  setBetValues]  = useState({ frontVal: 20, backVal: 20, totalVal: 40 })
  const [betUnit,    setBetUnit]    = useState(20)
  const [savedPlayers, setSavedPlayers] = useState([]) // jogadores parceiros cadastrados
  const [savedCourses, setSavedCourses] = useState([]) // campos customizados cadastrados
  const [newCourseName, setNewCourseName] = useState('')
  const [savingCourse,  setSavingCourse]  = useState(false)
  const [courseSaved,   setCourseSaved]   = useState(false)
  const [courseError,   setCourseError]   = useState('')

  // Pré-preenche Jogador 1 com dados do perfil logado
  useEffect(() => {
    const meta = session?.user?.user_metadata
    if (meta) {
      setPlayers(prev => prev.map((p, i) =>
        i === 0
          ? { name: meta.full_name?.split(' ')[0] || '', handicap: meta.handicap || 0 }
          : p
      ))
    }
  }, [session])

  // Carrega os jogadores parceiros já cadastrados, para sugerir nos campos de nome
  useEffect(() => {
    if (!session?.user?.id) return
    supabase.from('saved_players').select('name,handicap')
      .eq('user_id', session.user.id)
      .order('last_used_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error('Erro ao carregar jogadores parceiros:', error.message)
        else if (data) setSavedPlayers(data)
      })
  }, [session?.user?.id])

  // Carrega os campos customizados cadastrados (por qualquer usuário do grupo)
  useEffect(() => {
    supabase.from('saved_courses').select('id,name,par,si')
      .order('name', { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error('Erro ao carregar campos cadastrados:', error.message)
        else if (data) setSavedCourses(data)
      })
  }, [])

  const updPlayer = (i, f, v) =>
    setPlayers(prev => prev.map((p, pi) =>
      pi === i ? { ...p, [f]: f === 'handicap' ? Number(v) : v } : p
    ))

  const toggleTeam = (pi) => {
    if (teamA.includes(pi)) {
      if (teamA.length > 1) { setTeamA(teamA.filter(x => x !== pi)); setTeamB([...teamB, pi].sort()) }
    } else {
      if (teamB.length > 1) { setTeamB(teamB.filter(x => x !== pi)); setTeamA([...teamA, pi].sort()) }
    }
  }

  const selectCourse = (c) => { setCourse(c); setSi([...c.si]); setPar([...c.par]); setNewCourseName('') }

  // Campos fixos do app + campos customizados cadastrados pelo grupo
  const courseList = [
    ...COURSES,
    ...savedCourses.map(c => ({ id: c.id, name: c.name, city: '', si: c.si, par: c.par })),
  ]

  const saveCourse = async () => {
    const name = newCourseName.trim()
    if (!name || !session?.user?.id) return
    setSavingCourse(true)
    setCourseError('')
    const { data, error } = await supabase.from('saved_courses')
      .upsert({ user_id: session.user.id, name, par, si }, { onConflict: 'user_id,name' })
      .select('id,name,par,si').single()
    setSavingCourse(false)
    if (error) {
      setCourseError(error.message || 'Não foi possível salvar o campo.')
      return
    }
    if (data) {
      setSavedCourses(prev => {
        const exists = prev.some(c => c.id === data.id)
        return exists ? prev.map(c => c.id === data.id ? data : c) : [...prev, data]
      })
      setCourse({ id: data.id, name: data.name, city: '', si: data.si, par: data.par })
      setNewCourseName('')
      setCourseSaved(true)
      setTimeout(() => setCourseSaved(false), 2500)
    }
  }

  const canStart = players.slice(0, numPlayers).every(p => p.name.trim())

  const handleStart = () => {
    // Salva/atualiza os jogadores desta rodada como parceiros, pra sugerir
    // o nome (e o handicap) da próxima vez que você montar um jogo. Não
    // bloqueia o início da rodada — é feito em segundo plano.
    if (session?.user?.id) {
      const rows = players.slice(0, numPlayers)
        .filter(p => p.name.trim())
        .map(p => ({
          user_id: session.user.id,
          name: p.name.trim(),
          handicap: p.handicap,
          last_used_at: new Date().toISOString(),
        }))
      if (rows.length > 0) {
        supabase.from('saved_players')
          .upsert(rows, { onConflict: 'user_id,name' })
          .then(({ error }) => { if (error) console.error('Erro ao salvar jogadores parceiros:', error.message) })
      }
    }

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

  const inputStyle = {
    width: '100%',
    background: 'rgba(0,0,0,0.3)',
    border: '0.5px solid rgba(255,255,255,0.12)',
    borderRadius: 'var(--rr)',
    color: 'var(--cream)',
    fontFamily: 'var(--sans)',
    fontSize: 14,
    padding: '8px 10px',
  }

  const hcpStyle = {
    width: 60, height: 34,
    background: 'rgba(0,0,0,0.3)',
    border: '0.5px solid rgba(255,255,255,0.12)',
    borderRadius: 'var(--rr)',
    color: 'var(--cream)',
    fontFamily: 'var(--sans)',
    fontSize: 14, fontWeight: 700,
    textAlign: 'center',
  }

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title" style={{ fontFamily: 'var(--serif)', fontSize: 20 }}>
          ⛳ Nassau<span style={{ color: 'var(--gold)' }}>App</span>
        </span>
        <div style={{ width: 60 }}/>
      </header>

      <div className="screen-body">

        {/* Formato */}
        <div className="card">
          <h2>Formato de jogo</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {FORMATS.map(f => (
              <button key={f.id}
                onClick={() => setFormat(f.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 10, cursor: 'pointer',
                  background: format === f.id ? 'rgba(201,168,76,0.12)' : 'rgba(0,0,0,0.2)',
                  border: `0.5px solid ${format === f.id ? 'var(--gold)' : 'rgba(255,255,255,0.08)'}`,
                  textAlign: 'left', fontFamily: 'var(--sans)',
                }}>
                <span style={{ fontSize: 22 }}>{f.icon}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: format === f.id ? 'var(--gold)' : 'var(--cream)' }}>
                    {f.label}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 2 }}>{f.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Jogadores */}
        <div className="card">
          <h2>Jogadores</h2>
          <div className="toggle-row">
            {[2,3,4].map(n => (
              <button key={n}
                className={`toggle-btn${numPlayers === n ? ' active' : ''}`}
                onClick={() => setNumPlayers(n)}>
                {n} jogadores
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {Array.from({ length: numPlayers }, (_, i) => (
              <div key={i} style={{
                background: 'rgba(0,0,0,0.2)',
                borderRadius: 10, padding: '12px 14px',
                borderLeft: `2px solid ${i < 2 ? '#4a7acc' : '#aa4444'}`,
              }}>
                {i === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--gold)', letterSpacing: '1px', marginBottom: 8 }}>
                    ★ Você
                  </div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <PlayerNameField
                    style={{ ...inputStyle, flex: 1 }}
                    placeholder={`Jogador ${i + 1}`}
                    value={players[i].name}
                    suggestions={savedPlayers}
                    onChange={v => updPlayer(i, 'name', v)}
                    onPick={s => {
                      updPlayer(i, 'name', s.name)
                      if (s.handicap !== null && s.handicap !== undefined) updPlayer(i, 'handicap', s.handicap)
                    }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <span style={{ fontSize: 11, color: 'var(--muted2)', letterSpacing: '1px' }}>HCP</span>
                    <input
                      type="number" min="-10" max="54"
                      style={hcpStyle}
                      value={players[i].handicap}
                      onChange={e => updPlayer(i, 'handicap', e.target.value)}
                    />
                  </div>
                </div>
                {i === 0 && (
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, letterSpacing: '0.3px' }}>
                    Handicap do seu perfil — ajuste conforme o tee de hoje
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Duplas — Nassau com 4 jogadores */}
        {format === 'nassau' && numPlayers === 4 && (
          <div className="card">
            <h2>Formação das duplas</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 10 }}>
              {Array.from({ length: 4 }, (_, i) => (
                <button key={i}
                  onClick={() => toggleTeam(i)}
                  style={{
                    padding: '10px 8px', borderRadius: 10, cursor: 'pointer',
                    border: `1.5px solid ${teamA.includes(i) ? '#4a7acc' : '#aa4444'}`,
                    background: teamA.includes(i) ? 'rgba(74,122,204,0.12)' : 'rgba(170,68,68,0.12)',
                    fontFamily: 'var(--sans)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                  }}>
                  <span style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '1.5px', color: teamA.includes(i) ? '#6aaaee' : '#ee6666', fontWeight: 600 }}>
                    {teamA.includes(i) ? 'Dupla A' : 'Dupla B'}
                  </span>
                  <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--cream)' }}>
                    {players[i].name || `J${i+1}`}
                  </span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 12 }}>
              <span style={{ color: '#6aaaee' }}>A: {teamA.map(i => players[i].name || `J${i+1}`).join(' / ')}</span>
              <span style={{ color: '#ee6666' }}>B: {teamB.map(i => players[i].name || `J${i+1}`).join(' / ')}</span>
            </div>
            {/* Toggle individual dentro da dupla */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', paddingTop: 10, borderTop: '0.5px solid var(--border)' }}
              onClick={() => setPlayWithin(v => !v)}>
              <div style={{
                width: 44, height: 24, borderRadius: 12, padding: 2,
                background: playWithin ? 'var(--green2)' : 'rgba(255,255,255,0.12)',
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

        {/* Apostas */}
        <div className="card">
          <h2>Valores das apostas (R$)</h2>
          {format === 'nassau' ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
              {[['frontVal','Front 9'],['backVal','Back 9'],['totalVal','Total 18']].map(([k,l]) => (
                <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '1px' }}>{l}</div>
                  <input type="number" min="1"
                    style={{ width: 70, height: 44, background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'var(--gold)', fontSize: 18, fontWeight: 700, textAlign: 'center', fontFamily: 'var(--serif)' }}
                    value={betValues[k]}
                    onChange={e => setBetValues(prev => ({ ...prev, [k]: Number(e.target.value) }))}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {format === 'skins' ? 'Valor por Skin' : 'Valor por Ponto'}
              </div>
              <input type="number" min="1"
                style={{ width: 80, height: 44, background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.12)', borderRadius: 8, color: 'var(--gold)', fontSize: 20, fontWeight: 700, textAlign: 'center', fontFamily: 'var(--serif)' }}
                value={betUnit}
                onChange={e => setBetUnit(Number(e.target.value))}
              />
              <span style={{ color: 'var(--muted2)', fontSize: 13 }}>R$</span>
            </div>
          )}
        </div>

        {/* Campo */}
        <div className="card">
          <h2>Campo</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {courseList.map(c => (
              <button key={c.id}
                onClick={() => selectCourse(c)}
                style={{
                  padding: '11px 14px', borderRadius: 10, cursor: 'pointer', textAlign: 'left',
                  border: `0.5px solid ${course.id === c.id ? 'var(--gold)' : 'rgba(255,255,255,0.08)'}`,
                  background: course.id === c.id ? 'rgba(201,168,76,0.08)' : 'rgba(0,0,0,0.2)',
                  fontFamily: 'var(--sans)',
                }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: course.id === c.id ? 'var(--gold)' : 'var(--cream)' }}>{c.name}</div>
                {c.city && <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 2 }}>{c.city}</div>}
              </button>
            ))}
          </div>
        </div>

        {/* Par + SI */}
        <div className="card">
          <h2>Par e Índice Stroke — {course.name}</h2>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
            Ajuste os valores se precisar — dá pra salvar como um campo novo logo abaixo.
          </p>
          <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--muted2)', letterSpacing: '0.5px' }}>PAR</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 5, marginBottom: 10 }}>
            {Array.from({ length: 18 }, (_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ fontSize: 9, color: 'var(--muted2)' }}>B{i+1}</div>
                <input type="number" min="3" max="6"
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 5, color: 'var(--cream)', fontSize: 11, fontWeight: 600, padding: '3px 2px', textAlign: 'center', fontFamily: 'var(--sans)' }}
                  value={par[i]}
                  onChange={e => setPar(prev => prev.map((v,vi) => vi===i ? Number(e.target.value) : v))}
                />
              </div>
            ))}
          </div>
          <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--muted2)', letterSpacing: '0.5px' }}>STROKE INDEX</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 5 }}>
            {Array.from({ length: 18 }, (_, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div style={{ fontSize: 9, color: 'var(--muted2)' }}>B{i+1}</div>
                <input type="number" min="1" max="18"
                  style={{ width: '100%', background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.08)', borderRadius: 5, color: 'var(--cream)', fontSize: 11, fontWeight: 600, padding: '3px 2px', textAlign: 'center', fontFamily: 'var(--sans)' }}
                  value={si[i]}
                  onChange={e => setSi(prev => prev.map((v,vi) => vi===i ? Number(e.target.value) : v))}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Cadastrar campo novo */}
        <div className="card">
          <h2>Cadastrar este campo</h2>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
            Dê um nome e salve os valores de Par/SI acima como um campo novo — ele fica disponível pra você (e pro seu grupo) escolher nas próximas rodadas.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              style={{ ...inputStyle, flex: 1 }}
              placeholder="Nome do campo"
              value={newCourseName}
              onChange={e => setNewCourseName(e.target.value)}
            />
            <button className="btn-secondary" onClick={saveCourse} disabled={!newCourseName.trim() || savingCourse}
              style={{ width: 'auto', flex: '0 0 auto', whiteSpace: 'nowrap', padding: '0 16px', marginBottom: 0 }}>
              {savingCourse ? 'Salvando...' : courseSaved ? '✓ Salvo' : '💾 Salvar'}
            </button>
          </div>
          {courseError && (
            <p style={{ fontSize: 12, color: 'var(--red, #e05555)', marginTop: 8 }}>
              ⚠️ {courseError}
            </p>
          )}
        </div>

        <button className="btn-primary" onClick={handleStart} disabled={!canStart}>
          Iniciar Rodada →
        </button>

      </div>
    </div>
  )
}

// Campo de nome de jogador com sugestões dos parceiros já cadastrados
// (tabela saved_players). Autocomplete próprio em vez de <datalist> porque
// o Safari no iPhone não exibe as sugestões do datalist de forma confiável.
function PlayerNameField({ style, placeholder, value, suggestions, onChange, onPick }) {
  const [open, setOpen] = useState(false)

  const q = value.trim().toLowerCase()
  const filtered = (suggestions || [])
    .filter(s => s.name.toLowerCase() !== q)
    .filter(s => !q || s.name.toLowerCase().includes(q))
    .slice(0, 6)

  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        style={style}
        placeholder={placeholder}
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && filtered.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 30,
          background: '#101a30', border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 10, marginTop: 4, maxHeight: 180, overflowY: 'auto',
          boxShadow: '0 8px 20px rgba(0,0,0,0.4)',
        }}>
          {filtered.map(s => (
            <div key={s.name}
              onMouseDown={() => { onPick(s); setOpen(false) }}
              style={{
                padding: '9px 12px', fontSize: 13, color: 'var(--cream)', cursor: 'pointer',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}>
              <span>{s.name}</span>
              <span style={{ fontSize: 10, color: 'var(--muted2)' }}>HCP {s.handicap ?? 0}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
