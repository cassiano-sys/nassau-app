import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

function firstNameLower(fullName) {
  if (!fullName) return ''
  return fullName.trim().split(' ')[0].toLowerCase()
}

export function RankingScreen({ onBack, session }) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('global')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    const { data: players } = await supabase
      .from('round_players')
      .select('player_name, money_result, handicap, team, round_id')
    setData(players || [])
    setLoading(false)
  }

  // Ranking geral — agrupa por primeiro nome normalizado
  const ranking = useMemo(() => {
    const map = {}
    ;(data || []).forEach(p => {
      const key = firstNameLower(p.player_name)
      if (!key) return
      if (!map[key]) map[key] = { name: p.player_name, total: 0, jogos: new Set(), wins: 0, hcp: p.handicap }
      map[key].total += p.money_result || 0
      map[key].jogos.add(p.round_id)
      if (p.money_result > 0) map[key].wins++
      // Prefere capitalização normal (Cassiano > CASSIANO)
      const curr = map[key].name
      const isProper = p.player_name === p.player_name[0].toUpperCase() + p.player_name.slice(1).toLowerCase()
      if (isProper) map[key].name = p.player_name
    })
    return Object.values(map)
      .map(p => ({ ...p, jogos: p.jogos.size }))
      .sort((a, b) => b.total - a.total)
  }, [data])

  // H2H — só cruza times diferentes (A vs B)
  const h2h = useMemo(() => {
    const byRound = {}
    ;(data || []).forEach(p => {
      if (!byRound[p.round_id]) byRound[p.round_id] = []
      byRound[p.round_id].push(p)
    })
    const h2hMap = {}
    Object.values(byRound).forEach(players => {
      const teamA = players.filter(p => p.team === 'A')
      const teamB = players.filter(p => p.team === 'B')
      teamA.forEach(pA => {
        teamB.forEach(pB => {
          const keyA = firstNameLower(pA.player_name)
          const keyB = firstNameLower(pB.player_name)
          if (!keyA || !keyB) return
          const key = [keyA, keyB].sort().join('|||')
          if (!h2hMap[key]) h2hMap[key] = { nameA: pA.player_name, nameB: pB.player_name, balance: 0, jogos: 0 }
          const diff = (pA.money_result || 0) - (pB.money_result || 0)
          h2hMap[key].balance += (keyA < keyB ? diff : -diff)
          h2hMap[key].jogos++
        })
      })
    })
    return Object.values(h2hMap).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
  }, [data])

  const fmt = (v) => `${v > 0 ? '+' : ''}R$ ${v}`

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
            {ranking.map((p, i) => (
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
              <p>Apenas confrontos entre times diferentes</p>
            </div>
            {h2h.length === 0 ? (
              <div className="empty-state"><div className="icon">⚔️</div><p>Nenhum confronto registrado.</p></div>
            ) : h2h.map((h, i) => {
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
                        {h.jogos} jogo{h.jogos!==1?'s':''}
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

  // Usa primeiro nome OU user_id para identificar o jogador logado
  const fullName  = session?.user?.user_metadata?.full_name || ''
  const firstName = firstNameLower(fullName)
  const userId    = session?.user?.id

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

  // Verifica se um jogador é o usuário logado
  // Usa user_id se disponível, senão usa primeiro nome
  const isMe = (p) => {
    if (p.user_id && userId && p.user_id === userId) return true
    if (firstName && firstNameLower(p.player_name) === firstName) return true
    return false
  }

  const myStats = useMemo(() => {
    let total = 0, wins = 0, jogos = 0
    rounds.forEach(r => {
      const mine = r.round_players?.find(p => isMe(p))
      if (mine) {
        total += mine.money_result || 0
        jogos++
        if (mine.money_result > 0) wins++
      }
    })
    return { total, wins, jogos }
  }, [rounds, firstName, userId])

  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })
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
            <button key={v} className={`toggle-btn${filter===v?' active':''}`} onClick={() => setFilter(v)}>{l}</button>
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
                      fontWeight: isMe(p) ? 700 : 400,
                      color: isMe(p) ? 'var(--gold)' : 'rgba(255,255,255,0.7)'
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
  const [name,    setName]    = useState(session?.user?.user_metadata?.full_name || '')
  const [hcp,     setHcp]     = useState(session?.user?.user_metadata?.handicap  || 0)
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

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
            <input className="text-input" value={name} onChange={e => setName(e.target.value)} placeholder="Seu nome completo"/>
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

        <div className="card">
          <h2>Conta</h2>
          <div style={{ fontSize:13, color:'var(--muted)', marginBottom:14 }}>
            Conectado com: <strong style={{ color:'var(--cream)' }}>{email}</strong>
          </div>
          <button className="btn-danger" style={{ width:'100%', padding:12, borderRadius:'var(--r)' }}
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
