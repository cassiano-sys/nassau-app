import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

// ── HistoryScreen ─────────────────────────────────────────────────────────────
export function HistoryScreen({ onBack, session }) {
  const [rounds, setRounds]   = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState('all') // all | month | year

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
      const from = new Date(new Date().getFullYear(), 0, 1)
      query = query.gte('played_at', from.toISOString())
    }

    const { data } = await query.limit(50)
    setRounds(data || [])
    setLoading(false)
  }

  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })

  // Stats
  const myStats = useMemo(() => {
    let total = 0, wins = 0, count = 0
    rounds.forEach(r => {
      r.round_players?.forEach(p => {
        if (p.user_id === session.user.id) {
          total += p.money_result || 0
          if (p.money_result > 0) wins++
          count++
        }
      })
    })
    return { total, wins, count }
  }, [rounds, session])

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">📋 Histórico</span>
        <div style={{ width: 60 }}/>
      </header>
      <div className="screen-body">

        {/* Quick stats */}
        <div className="card">
          <div className="perf-grid">
            <div className="perf-cell">
              <div className={`perf-val ${myStats.total > 0 ? 'pos' : myStats.total < 0 ? 'neg' : 'neu'}`}>
                {myStats.total > 0 ? '+' : ''}R$ {myStats.total}
              </div>
              <div className="perf-lbl">Saldo total</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val" style={{ color: 'var(--gold)' }}>{myStats.count}</div>
              <div className="perf-lbl">Rodadas</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val pos">{myStats.wins}</div>
              <div className="perf-lbl">Vitórias</div>
            </div>
            <div className="perf-cell">
              <div className={`perf-val ${myStats.count > 0 ? 'pos' : 'neu'}`}>
                {myStats.count > 0 ? Math.round(myStats.wins / myStats.count * 100) : 0}%
              </div>
              <div className="perf-lbl">Taxa</div>
            </div>
          </div>
        </div>

        {/* Filter */}
        <div className="toggle-row">
          {[['all','Todas'],['month','Este mês'],['year','Este ano']].map(([v,l]) => (
            <button key={v} className={`toggle-btn${filter===v?' active':''}`} onClick={() => setFilter(v)}>{l}</button>
          ))}
        </div>

        {/* Rounds list */}
        {loading ? (
          <div className="empty-state"><p>Carregando...</p></div>
        ) : rounds.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏌️</div>
            <p>Nenhuma rodada encontrada.<br/>Salve uma rodada para ver o histórico.</p>
          </div>
        ) : rounds.map(r => (
          <div key={r.id} className="hist-card">
            <div className="hist-date">{fmtDate(r.played_at)}</div>
            <div className="hist-course">{r.course_name} · {r.format?.toUpperCase()}</div>
            <div className="hist-players">
              {r.round_players?.map((p, i) => (
                <div key={i} className="hist-player">
                  <span className="hist-pname">{p.player_name} <small style={{ color: 'var(--muted)' }}>HCP{p.handicap}</small></span>
                  <span className={p.money_result > 0 ? 'pos' : p.money_result < 0 ? 'neg' : 'neu'}>
                    {p.money_result > 0 ? '+' : ''}R$ {p.money_result || 0}
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

// ── RankingScreen ─────────────────────────────────────────────────────────────
export function RankingScreen({ onBack, session }) {
  const [ranking, setRanking] = useState([])
  const [h2h, setH2h]         = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState('global') // global | h2h

  useEffect(() => { loadRanking() }, [])

  const loadRanking = async () => {
    setLoading(true)

    // Global ranking: aggregate money per player name
    const { data } = await supabase
      .from('round_players')
      .select('player_name, money_result, handicap, rounds(played_at)')

    if (data) {
      const map = {}
      data.forEach(p => {
        const key = p.player_name
        if (!map[key]) map[key] = { name: key, total: 0, rounds: 0, wins: 0, hcp: p.handicap }
        map[key].total  += p.money_result || 0
        map[key].rounds += 1
        if (p.money_result > 0) map[key].wins++
      })
      setRanking(Object.values(map).sort((a, b) => b.total - a.total))

      // H2H: find pairings
      // Group by round to build h2h
      const roundMap = {}
      data.forEach(p => {
        const rid = p.rounds?.played_at // use date as rough key
        if (!roundMap[rid]) roundMap[rid] = []
        roundMap[rid].push(p)
      })
      // Simple h2h: collect all unique pairs from same round
      const h2hMap = {}
      Object.values(roundMap).forEach(players => {
        for (let i = 0; i < players.length; i++) {
          for (let j = i + 1; j < players.length; j++) {
            const a = players[i], b = players[j]
            const key = [a.player_name, b.player_name].sort().join('|||')
            if (!h2hMap[key]) h2hMap[key] = { a: a.player_name, b: b.player_name, balanceA: 0, games: 0 }
            const aWon = a.money_result > b.money_result
            const bWon = b.money_result > a.money_result
            if (aWon) h2hMap[key].balanceA += Math.abs(a.money_result)
            if (bWon) h2hMap[key].balanceA -= Math.abs(b.money_result)
            h2hMap[key].games++
          }
        }
      })
      setH2h(Object.values(h2hMap))
    }
    setLoading(false)
  }

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">🏆 Ranking</span>
        <div className="view-toggle">
          <button className={tab==='global'?'active':''} onClick={() => setTab('global')}>Geral</button>
          <button className={tab==='h2h'?'active':''} onClick={() => setTab('h2h')}>H2H</button>
        </div>
      </header>
      <div className="screen-body">
        {loading ? (
          <div className="empty-state"><p>Carregando...</p></div>
        ) : tab === 'global' ? (
          <>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <h2>Ranking Geral</h2>
              <p>Saldo acumulado de todas as rodadas</p>
            </div>
            {ranking.length === 0 ? (
              <div className="empty-state">
                <div className="icon">🏆</div>
                <p>Nenhuma rodada salva ainda.</p>
              </div>
            ) : ranking.map((p, i) => (
              <div key={p.name} className={`rank-row${i === 0 ? ' leader' : ''}`}>
                <span className="rank-num">{i===0?'🏆':i===1?'🥈':i===2?'🥉':`${i+1}º`}</span>
                <div style={{ flex: 1 }}>
                  <div className="rank-name">{p.name}</div>
                  <div className="rank-sub">HCP {p.hcp} · {p.rounds} rodadas · {p.wins} vitórias</div>
                </div>
                <div className={`rank-money ${p.total > 0 ? 'pos' : p.total < 0 ? 'neg' : 'neu'}`}>
                  {p.total > 0 ? '+' : ''}R$ {p.total}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <h2>Confrontos Diretos</h2>
              <p>Saldo acumulado entre pares de jogadores</p>
            </div>
            {h2h.length === 0 ? (
              <div className="empty-state"><p>Nenhum confronto registrado.</p></div>
            ) : h2h.sort((a,b) => Math.abs(b.balanceA) - Math.abs(a.balanceA)).map((h, i) => {
              const winner = h.balanceA > 0 ? h.a : h.balanceA < 0 ? h.b : null
              const loser  = h.balanceA > 0 ? h.b : h.balanceA < 0 ? h.a : null
              return (
                <div key={i} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--cream)' }}>
                        {h.a} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>vs</span> {h.b}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{h.games} jogo{h.games!==1?'s':''}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {winner ? (
                        <>
                          <div className="pos" style={{ fontWeight: 700, fontSize: 14 }}>
                            {winner} +R$ {Math.abs(h.balanceA)}
                          </div>
                          <div className="neg" style={{ fontSize: 11 }}>{loser} -R$ {Math.abs(h.balanceA)}</div>
                        </>
                      ) : (
                        <div className="neu">Empatado</div>
                      )}
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

// ── ProfileScreen ─────────────────────────────────────────────────────────────
export function ProfileScreen({ onBack, session, onSignOut }) {
  const [name, setName]   = useState(session?.user?.user_metadata?.full_name || '')
  const [hcp, setHcp]     = useState(session?.user?.user_metadata?.handicap || 0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)

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

  const email = session?.user?.email || ''
  const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() || '?'

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">👤 Perfil</span>
        <div style={{ width: 60 }}/>
      </header>
      <div className="screen-body">

        <div style={{ textAlign: 'center', marginBottom: 24, paddingTop: 8 }}>
          <div className="avatar">{initials}</div>
          <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--cream)' }}>{name || 'Jogador'}</div>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>{email}</div>
        </div>

        <div className="card">
          <h2>Meus dados</h2>

          <div style={{ marginBottom: 14 }}>
            <div className="field-label">Nome</div>
            <input className="text-input" value={name}
              onChange={e => setName(e.target.value)} placeholder="Seu nome completo"/>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div className="field-label">Handicap de jogo</div>
            <input type="number" min="-10" max="54" className="text-input"
              value={hcp} onChange={e => setHcp(Number(e.target.value))}
              style={{ width: 100 }}/>
          </div>

          {saved ? (
            <div style={{ textAlign: 'center', color: 'var(--green2)', fontWeight: 600, padding: 10 }}>
              ✅ Salvo!
            </div>
          ) : (
            <button className="btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Salvando...' : 'Salvar'}
            </button>
          )}
        </div>

        <div className="card">
          <h2>Conta</h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
            Conectado com: <strong style={{ color: 'var(--cream)' }}>{email}</strong>
          </div>
          <button className="btn-danger" style={{ width: '100%', padding: 12, borderRadius: 'var(--r)' }}
            onClick={handleSignOut}>
            Sair da conta
          </button>
        </div>

        <div className="card" style={{ borderColor: 'rgba(201,168,76,0.2)' }}>
          <h2>Nassau App</h2>
          <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
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
