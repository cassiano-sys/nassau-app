import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'

function firstNameLower(fullName) {
  if (!fullName) return ''
  return fullName.trim().split(' ')[0].toLowerCase()
}

export function RankingScreen({ onBack, session }) {
  const [players,    setPlayers]    = useState([])
  const [matchups,   setMatchups]   = useState([])
  const [roundDates, setRoundDates] = useState({}) // round_id -> played_at (Date)
  const [loading,    setLoading]    = useState(true)
  const [tab,        setTab]        = useState('global')
  const [h2hSearch,  setH2hSearch]  = useState('')
  const [h2hPeriod,  setH2hPeriod]  = useState('all') // all | week | month | year

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    const [{ data: pData }, { data: mData }, { data: rData }] = await Promise.all([
      supabase.from('round_players').select('player_name, money_result, handicap, team, round_id'),
      supabase.from('round_matchups').select('*'),
      supabase.from('rounds').select('id, played_at'),
    ])
    setPlayers(pData || [])
    setMatchups(mData || [])
    const dates = {}
    ;(rData || []).forEach(r => { dates[r.id] = new Date(r.played_at) })
    setRoundDates(dates)
    setLoading(false)
  }

  // Data de corte do período selecionado para o H2H (null = sem filtro)
  const h2hSince = useMemo(() => {
    const now = new Date()
    if (h2hPeriod === 'week')  { const d = new Date(now); d.setDate(d.getDate() - 7);  return d }
    if (h2hPeriod === 'month') { const d = new Date(now); d.setDate(d.getDate() - 30); return d }
    if (h2hPeriod === 'year')  { return new Date(now.getFullYear(), 0, 1) }
    return null // 'all'
  }, [h2hPeriod])

  const inPeriod = (roundId) => {
    if (!h2hSince) return true
    const d = roundDates[roundId]
    return d ? d >= h2hSince : true // sem data conhecida → não exclui (rodadas antigas)
  }

  const myFirstName = firstNameLower(session?.user?.user_metadata?.full_name || '')

  // Ranking geral — agrupa por primeiro nome
  const ranking = useMemo(() => {
    const map = {}
    ;(players || []).forEach(p => {
      const key = firstNameLower(p.player_name)
      if (!key) return
      if (!map[key]) map[key] = { name: p.player_name, total: 0, jogos: new Set(), wins: 0, hcp: p.handicap }
      map[key].total += p.money_result || 0
      map[key].jogos.add(p.round_id)
      if (p.money_result > 0) map[key].wins++
      // Prefere capitalização normal
      if (p.player_name && p.player_name[0] === p.player_name[0].toUpperCase() &&
          p.player_name.slice(1) === p.player_name.slice(1).toLowerCase()) {
        map[key].name = p.player_name
      }
    })
    return Object.values(map)
      .map(p => ({ ...p, jogos: p.jogos.size }))
      .sort((a, b) => b.total - a.total)
  }, [players])

  // H2H correto — usa round_matchups (confrontos individuais salvos separadamente)
  const h2h = useMemo(() => {
    // Usa matchups se disponíveis, senão fallback para cálculo por team
    if (matchups.length > 0) {
      const map = {}
      matchups.filter(m => m.type === 'individual' && inPeriod(m.round_id)).forEach(m => {
        const keyA = firstNameLower(m.player_a)
        const keyB = firstNameLower(m.player_b)
        const key  = [keyA, keyB].sort().join('|||')
        if (!map[key]) map[key] = { nameA: m.player_a, nameB: m.player_b, balance: 0, jogos: 0 }
        // result_a = quanto A ganhou de B neste confronto
        map[key].balance += (keyA < keyB ? m.result_a : -m.result_a)
        map[key].jogos++
      })
      return Object.values(map).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    }

    // Fallback: calcula por team (rodadas antigas sem matchups)
    const byRound = {}
    ;(players || []).forEach(p => {
      if (!inPeriod(p.round_id)) return
      if (!byRound[p.round_id]) byRound[p.round_id] = []
      byRound[p.round_id].push(p)
    })
    const map = {}
    Object.values(byRound).forEach(rPlayers => {
      const teamA = rPlayers.filter(p => p.team === 'A')
      const teamB = rPlayers.filter(p => p.team === 'B')
      teamA.forEach(pA => {
        teamB.forEach(pB => {
          const keyA = firstNameLower(pA.player_name)
          const keyB = firstNameLower(pB.player_name)
          const key  = [keyA, keyB].sort().join('|||')
          if (!map[key]) map[key] = { nameA: pA.player_name, nameB: pB.player_name, balance: 0, jogos: 0 }
          const diff = (pA.money_result || 0) - (pB.money_result || 0)
          map[key].balance += (keyA < keyB ? diff : -diff)
          map[key].jogos++
        })
      })
    })
    return Object.values(map).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
  }, [matchups, players, roundDates, h2hSince])

  const fmt = (v) => `${v > 0 ? '+' : ''}R$ ${v}`

  // H2H é pessoal: só confrontos que incluem o usuário logado.
  // Sem nome de perfil definido, mostra tudo (fallback) em vez de esconder tudo.
  const h2hMine = useMemo(() => {
    if (!myFirstName) return h2h
    return h2h.filter(h =>
      firstNameLower(h.nameA) === myFirstName || firstNameLower(h.nameB) === myFirstName
    )
  }, [h2h, myFirstName])

  const h2hFiltered = useMemo(() => {
    const q = h2hSearch.trim().toLowerCase()
    if (!q) return h2hMine
    return h2hMine.filter(h =>
      h.nameA.toLowerCase().includes(q) || h.nameB.toLowerCase().includes(q)
    )
  }, [h2hMine, h2hSearch])

  // Saldo do usuário (positivo a favor dele) somado sobre os confrontos exibidos —
  // respeita o período selecionado e, se houver busca, o(s) adversário(s) filtrado(s).
  const h2hTotal = useMemo(() => {
    return h2hFiltered.reduce((acc, h) => {
      const mine = !myFirstName || firstNameLower(h.nameA) === myFirstName ? h.balance : -h.balance
      return { valor: acc.valor + mine, jogos: acc.jogos + h.jogos }
    }, { valor: 0, jogos: 0 })
  }, [h2hFiltered, myFirstName])

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">🏆 Ranking</span>
        <div className="view-toggle">
          <button className={tab === 'global' ? 'active' : ''} onClick={() => setTab('global')}>Geral</button>
          <button className={tab === 'h2h'    ? 'active' : ''} onClick={() => setTab('h2h')}>H2H</button>
        </div>
      </header>
      <div className="screen-body">
        {loading ? <div className="empty-state"><p>Carregando...</p></div>
        : tab === 'global' ? (
          <>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <h2>Ranking Geral</h2>
              <p>Saldo acumulado de todas as rodadas</p>
            </div>
            {ranking.length === 0 ? (
              <div className="empty-state"><div className="icon">🏆</div><p>Nenhuma rodada ainda.</p></div>
            ) : ranking.map((p, i) => (
              <div key={p.name} className={`rank-row${i === 0 ? ' leader' : ''}`}>
                <span className="rank-num">{i===0?'🏆':i===1?'🥈':i===2?'🥉':`${i+1}º`}</span>
                <div style={{ flex: 1 }}>
                  <div className="rank-name">{p.name}</div>
                  <div className="rank-sub">HCP {p.hcp} · {p.jogos} jogo{p.jogos!==1?'s':''} · {p.wins} vitória{p.wins!==1?'s':''}</div>
                </div>
                <div className={`rank-money ${p.total>0?'pos':p.total<0?'neg':'neu'}`}>{fmt(p.total)}</div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <h2>Confrontos Diretos</h2>
              <p>Resultado acumulado de confrontos individuais</p>
            </div>
            <input
              className="text-input"
              style={{ marginBottom: 10 }}
              placeholder="🔍  Buscar jogador..."
              value={h2hSearch}
              onChange={e => setH2hSearch(e.target.value)}
            />
            <div className="toggle-row" style={{ marginBottom: 14 }}>
              {[['all','Todos'],['week','Semana'],['month','Mês'],['year','Ano']].map(([v,l]) => (
                <button key={v} className={`toggle-btn${h2hPeriod===v?' active':''}`}
                  onClick={() => setH2hPeriod(v)}>{l}</button>
              ))}
            </div>

            {/* Saldo somado do período (+ adversário buscado, se houver) */}
            {h2hFiltered.length > 0 && (
              <div className="card" style={{ marginBottom: 10, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '1px', marginBottom: 2 }}>
                    Seu saldo {h2hSearch.trim() ? `vs "${h2hSearch.trim()}"` : ''} · {{all:'Todos os jogos',week:'Última semana',month:'Último mês',year:'Este ano'}[h2hPeriod]}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{h2hTotal.jogos} confronto{h2hTotal.jogos !== 1 ? 's' : ''}</div>
                </div>
                <div className={h2hTotal.valor > 0 ? 'pos' : h2hTotal.valor < 0 ? 'neg' : 'neu'}
                  style={{ fontFamily: 'var(--serif)', fontSize: 22, fontWeight: 700 }}>
                  {fmt(h2hTotal.valor)}
                </div>
              </div>
            )}

            {matchups.length === 0 && (
              <div style={{ padding: '8px 0 14px', fontSize: 12, color: 'var(--muted)' }}>
                ℹ️ Rodadas antigas usam cálculo aproximado. Novas rodadas terão H2H exato.
              </div>
            )}
            {h2hMine.length === 0 ? (
              <div className="empty-state"><div className="icon">⚔️</div>
                <p>{h2hPeriod === 'all' ? 'Nenhum confronto registrado.' : 'Nenhum confronto neste período.'}</p>
              </div>
            ) : h2hFiltered.length === 0 ? (
              <div className="empty-state"><div className="icon">🔍</div><p>Nenhum confronto encontrado para "{h2hSearch}".</p></div>
            ) : h2hFiltered.map((h, i) => {
              const winner = h.balance > 0 ? h.nameA : h.balance < 0 ? h.nameB : null
              const loser  = h.balance > 0 ? h.nameB : h.balance < 0 ? h.nameA : null
              const amt    = Math.abs(h.balance)
              return (
                <div key={i} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--cream)' }}>
                        {h.nameA} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>vs</span> {h.nameB}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {h.jogos} confronto{h.jogos!==1?'s':''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {winner ? (
                        <>
                          <div className="pos" style={{ fontWeight: 700, fontSize: 14 }}>{winner} +R$ {amt}</div>
                          <div className="neg" style={{ fontSize: 11 }}>{loser} -R$ {amt}</div>
                        </>
                      ) : <div className="neu">Empatado</div>}
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    </div>
  )
}

export function HistoryScreen({ onBack, session }) {
  const [rounds,  setRounds]  = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('all')

  const firstName = firstNameLower(session?.user?.user_metadata?.full_name || '')

  useEffect(() => { loadRounds() }, [filter])

  const loadRounds = async () => {
    setLoading(true)
    let query = supabase
      .from('rounds')
      .select('*, round_players(*)')
      .order('played_at', { ascending: false })

    if (filter === 'month') {
      const from = new Date(); from.setDate(1); from.setHours(0,0,0,0)
      query = query.gte('played_at', from.toISOString())
    } else if (filter === 'year') {
      query = query.gte('played_at', new Date(new Date().getFullYear(), 0, 1).toISOString())
    }

    const { data } = await query.limit(50)
    setRounds(data || [])
    setLoading(false)
  }

  const isMe = (name) => firstName.length > 0 && firstNameLower(name) === firstName

  const myStats = useMemo(() => {
    let total = 0, wins = 0, jogos = 0
    rounds.forEach(r => {
      const mine = r.round_players?.find(p => isMe(p.player_name))
      if (mine) {
        total += mine.money_result || 0
        jogos++
        if (mine.money_result > 0) wins++
      }
    })
    return { total, wins, jogos }
  }, [rounds, firstName])

  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
  const fmtMoney = (v) => !v ? 'R$ 0' : `${v > 0 ? '+' : ''}R$ ${Math.abs(v)}`

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">📋 Histórico</span>
        <div style={{ width: 60 }} />
      </header>
      <div className="screen-body">
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="perf-grid">
            <div className="perf-cell">
              <div className={`perf-val ${myStats.total>0?'pos':myStats.total<0?'neg':'neu'}`}>
                {fmtMoney(myStats.total)}
              </div>
              <div className="perf-lbl">Saldo total</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val" style={{ color:'var(--gold)' }}>{myStats.jogos}</div>
              <div className="perf-lbl">Jogos</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val pos">{myStats.wins}</div>
              <div className="perf-lbl">Vitórias</div>
            </div>
            <div className="perf-cell">
              <div className={`perf-val ${myStats.jogos>0?'pos':'neu'}`}>
                {myStats.jogos>0 ? Math.round(myStats.wins/myStats.jogos*100) : 0}%
              </div>
              <div className="perf-lbl">Taxa</div>
            </div>
          </div>
        </div>

        <div className="toggle-row" style={{ marginBottom: 14 }}>
          {[['all','Todas'],['month','Este mês'],['year','Este ano']].map(([v,l]) => (
            <button key={v} className={`toggle-btn${filter===v?' active':''}`}
              onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>

        {loading ? <div className="empty-state"><p>Carregando...</p></div>
        : rounds.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏌️</div>
            <p>Nenhuma rodada encontrada.</p>
          </div>
        ) : rounds.map(r => (
          <div key={r.id} className="hist-card">
            <div className="hist-date">{fmtDate(r.played_at)}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              {r.course_name} · {r.format?.toUpperCase()}
            </div>
            <div className="hist-players">
              {r.round_players
                ?.sort((a,b) => (b.money_result||0) - (a.money_result||0))
                .map((p,i) => (
                  <div key={i} className="hist-player">
                    <span className="hist-pname" style={{
                      fontWeight: isMe(p.player_name) ? 700 : 400,
                      color: isMe(p.player_name) ? 'var(--gold)' : 'rgba(255,255,255,0.7)'
                    }}>
                      {p.player_name}
                      <small style={{ color:'var(--muted)', fontWeight:400 }}> HCP{p.handicap}</small>
                    </span>
                    <span className={p.money_result>0?'pos':p.money_result<0?'neg':'neu'}>
                      {fmtMoney(p.money_result||0)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProfileScreen({ onBack, session, onSignOut }) {
  const [name,   setName]   = useState(session?.user?.user_metadata?.full_name || '')
  const [hcp,    setHcp]    = useState(session?.user?.user_metadata?.handicap  || 0)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  // ── Calibração de caligrafia (amostra dos números 0-9) ──
  const [hwSample,  setHwSample]  = useState(null)   // amostra já salva (base64)
  const [hwPreview, setHwPreview] = useState(null)   // foto nova, ainda não salva
  const [hwB64,     setHwB64]     = useState(null)
  const [hwLoading, setHwLoading] = useState(true)
  const [hwSaving,  setHwSaving]  = useState(false)
  const [hwSaved,   setHwSaved]   = useState(false)
  const hwFileRef = useRef()

  useEffect(() => {
    if (!session?.user?.id) { setHwLoading(false); return }
    supabase.from('handwriting_samples').select('image_base64').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => { setHwSample(data?.image_base64 || null); setHwLoading(false) })
  }, [session?.user?.id])

  const handleHwSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      setHwPreview(ev.target.result)
      setHwB64(ev.target.result.split(',')[1])
    }
    reader.readAsDataURL(file)
  }

  const saveHandwriting = async () => {
    if (!hwB64 || !session?.user?.id) return
    setHwSaving(true)
    await supabase.from('handwriting_samples').upsert({
      user_id: session.user.id, image_base64: hwB64, updated_at: new Date().toISOString(),
    })
    setHwSample(hwB64); setHwPreview(null); setHwB64(null)
    setHwSaving(false); setHwSaved(true)
    setTimeout(() => setHwSaved(false), 2000)
  }

  const removeHandwriting = async () => {
    if (!session?.user?.id) return
    await supabase.from('handwriting_samples').delete().eq('user_id', session.user.id)
    setHwSample(null)
  }

  const handleSave = async () => {
    setSaving(true)
    await supabase.auth.updateUser({ data: { full_name: name, handicap: hcp } })
    setSaved(true); setSaving(false)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut()
    onSignOut()
  }

  const email    = session?.user?.email || ''
  const initials = name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase() || '?'

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">👤 Perfil</span>
        <div style={{ width: 60 }} />
      </header>
      <div className="screen-body">
        <div style={{ textAlign:'center', marginBottom:24, paddingTop:8 }}>
          <div className="avatar">{initials}</div>
          <div style={{ fontSize:18, fontWeight:700, color:'var(--cream)' }}>{name || 'Jogador'}</div>
          <div style={{ fontSize:13, color:'var(--muted)', marginTop:4 }}>{email}</div>
        </div>
        <div className="card">
          <h2>Meus dados</h2>
          <div style={{ marginBottom:14 }}>
            <div className="field-label">Nome</div>
            <input className="text-input" value={name}
              onChange={e => setName(e.target.value)} placeholder="Seu nome completo"/>
          </div>
          <div style={{ marginBottom:14 }}>
            <div className="field-label">Handicap de jogo</div>
            <input type="number" min="-10" max="54" className="text-input"
              value={hcp} onChange={e => setHcp(Number(e.target.value))} style={{ width:100 }}/>
          </div>
          {saved ? (
            <div style={{ textAlign:'center', color:'var(--green2)', fontWeight:600, padding:10 }}>✅ Salvo!</div>
          ) : (
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          )}
        </div>
        <div className="card" style={{ borderColor: 'rgba(68,136,204,0.25)' }}>
          <h2>Calibração de leitura (IA)</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
            Escreva os números de 0 a 9, em ordem, numa folha de papel e fotografe. A IA usa essa amostra como referência para ler os cartões deste grupo com mais precisão.
          </p>

          {hwLoading ? (
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>Carregando...</p>
          ) : hwPreview ? (
            <>
              <img src={hwPreview} alt="Amostra de caligrafia" className="photo-preview"/>
              <button className="btn-primary" onClick={saveHandwriting} disabled={hwSaving} style={{ marginBottom: 10 }}>
                {hwSaving ? 'Salvando...' : '✓  Salvar calibração'}
              </button>
              <button className="btn-secondary" onClick={() => { setHwPreview(null); setHwB64(null) }}>
                Cancelar
              </button>
            </>
          ) : hwSaved ? (
            <div style={{ textAlign: 'center', color: 'var(--green2)', fontWeight: 600, padding: 10 }}>✅ Calibração salva!</div>
          ) : hwSample ? (
            <>
              <img src={`data:image/jpeg;base64,${hwSample}`} alt="Amostra de caligrafia" className="photo-preview"/>
              <button className="photo-btn" onClick={() => hwFileRef.current?.click()} style={{ marginBottom: 8 }}>
                📷  Trocar foto
              </button>
              <button className="btn-danger" style={{ width: '100%', padding: 12 }} onClick={removeHandwriting}>
                Remover calibração
              </button>
            </>
          ) : (
            <button className="photo-btn" onClick={() => hwFileRef.current?.click()} style={{ marginBottom: 0 }}>
              📷  Fotografar números 0-9
            </button>
          )}
          <input ref={hwFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleHwSelect}/>
        </div>

        <div className="card">
          <h2>Conta</h2>
          <div style={{ fontSize:13, color:'var(--muted)', marginBottom:14 }}>
            Conectado com: <strong style={{ color:'var(--cream)' }}>{email}</strong>
          </div>
          <button className="btn-danger"
            style={{ width:'100%', padding:12, borderRadius:'var(--r)' }}
            onClick={handleSignOut}>
            Sair da conta
          </button>
        </div>
        <div className="card" style={{ borderColor:'rgba(201,168,76,0.2)' }}>
          <h2>Nassau App</h2>
          <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.8 }}>
            <div>Versão 1.0</div>
            <div>Nassau · Skins · Stableford</div>
            <div>Press automático · Foto do cartão</div>
            <div>Histórico na nuvem · Ranking</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default HistoryScreen
