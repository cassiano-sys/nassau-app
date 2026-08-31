import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'

export function RankingScreen({ onBack, session }) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)
  const [tab,     setTab]     = useState('global')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)

    // Busca round_players com info da rodada (para saber o team)
    const { data: players } = await supabase
      .from('round_players')
      .select('player_name, money_result, handicap, team, round_id, rounds(played_at)')
      .order('round_id')

    setData(players || [])
    setLoading(false)
  }

  // ── Ranking geral ──────────────────────────────────────────────
  const ranking = useMemo(() => {
    const map = {}
    ;(data || []).forEach(p => {
      // Normaliza nome para evitar duplicatas (CASSIANO = Cassiano)
      const key = p.player_name?.trim().toLowerCase()
      if (!key) return
      if (!map[key]) map[key] = {
        name:   p.player_name,
        total:  0,
        jogos:  new Set(),
        wins:   0,
        hcp:    p.handicap,
      }
      map[key].total += p.money_result || 0
      map[key].jogos.add(p.round_id)
      if (p.money_result > 0) map[key].wins++
      // Usa o nome com a capitalização mais recente
      map[key].name = p.player_name
    })

    return Object.values(map)
      .map(p => ({ ...p, jogos: p.jogos.size }))
      .sort((a, b) => b.total - a.total)
  }, [data])

  // ── H2H correto — só cruza jogadores de times diferentes ──────
  const h2h = useMemo(() => {
    // Agrupa por rodada
    const byRound = {}
    ;(data || []).forEach(p => {
      if (!byRound[p.round_id]) byRound[p.round_id] = []
      byRound[p.round_id].push(p)
    })

    const h2hMap = {}

    Object.values(byRound).forEach(players => {
      const teamA = players.filter(p => p.team === 'A')
      const teamB = players.filter(p => p.team === 'B')

      // Só cruza jogadores de times DIFERENTES
      teamA.forEach(pA => {
        teamB.forEach(pB => {
          const nameA = pA.player_name?.trim().toLowerCase()
          const nameB = pB.player_name?.trim().toLowerCase()
          if (!nameA || !nameB) return

          const key = [nameA, nameB].sort().join('|||')
          if (!h2hMap[key]) h2hMap[key] = {
            nameA: pA.player_name,
            nameB: pB.player_name,
            balance: 0,
            jogos: 0,
          }

          // Balance: positivo = nameA ganha, negativo = nameB ganha
          const diff = (pA.money_result || 0) - (pB.money_result || 0)
          if (nameA < nameB) {
            h2hMap[key].balance += diff
          } else {
            h2hMap[key].balance -= diff
          }
          h2hMap[key].jogos++
        })
      })
    })

    return Object.values(h2hMap)
      .sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
  }, [data])

  const fmtMoney = (v) => `${v > 0 ? '+' : ''}R$ ${v}`

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
                <span className="rank-num">
                  {i === 0 ? '🏆' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`}
                </span>
                <div style={{ flex: 1 }}>
                  <div className="rank-name">{p.name}</div>
                  <div className="rank-sub">
                    HCP {p.hcp} · {p.jogos} jogo{p.jogos !== 1 ? 's' : ''} · {p.wins} vitória{p.wins !== 1 ? 's' : ''}
                  </div>
                </div>
                <div className={`rank-money ${p.total > 0 ? 'pos' : p.total < 0 ? 'neg' : 'neu'}`}>
                  {fmtMoney(p.total)}
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div className="section-header" style={{ marginBottom: 14 }}>
              <h2>Confrontos Diretos</h2>
              <p>Apenas confrontos individuais entre times diferentes</p>
            </div>

            {h2h.length === 0 ? (
              <div className="empty-state">
                <div className="icon">⚔️</div>
                <p>Nenhum confronto registrado ainda.</p>
              </div>
            ) : h2h.map((h, i) => {
              const winner = h.balance > 0 ? h.nameA :
                             h.balance < 0 ? h.nameB : null
              const loser  = h.balance > 0 ? h.nameB :
                             h.balance < 0 ? h.nameA : null
              const amt    = Math.abs(h.balance)

              return (
                <div key={i} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--cream)' }}>
                        {h.nameA} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>vs</span> {h.nameB}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                        {h.jogos} jogo{h.jogos !== 1 ? 's' : ''}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      {winner ? (
                        <>
                          <div className="pos" style={{ fontWeight: 700, fontSize: 14 }}>
                            {winner} +R$ {amt}
                          </div>
                          <div className="neg" style={{ fontSize: 11 }}>
                            {loser} -R$ {amt}
                          </div>
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

// ── HistoryScreen ─────────────────────────────────────────────────────────────
export function HistoryScreen({ onBack, session }) {
  const [rounds,  setRounds]  = useState([])
  const [loading, setLoading] = useState(true)
  const [filter,  setFilter]  = useState('all')

  const userName = session?.user?.user_metadata?.full_name?.split(' ')[0]?.toLowerCase() || ''

  useEffect(() => { loadRounds() }, [filter])

  const loadRounds = async () => {
    setLoading(true)
    let query = supabase
      .from('rounds')
      .select('*, round_players(*)')
      .order('played_at', { ascending: false })

    if (filter === 'month') {
      const from = new Date()
      from.setDate(1); from.setHours(0, 0, 0, 0)
      query = query.gte('played_at', from.toISOString())
    } else if (filter === 'year') {
      const from = new Date(new Date().getFullYear(), 0, 1)
      query = query.gte('played_at', from.toISOString())
    }

    const { data } = await query.limit(50)
    setRounds(data || [])
    setLoading(false)
  }

  // Stats do usuário logado
  const myStats = useMemo(() => {
    let total = 0, wins = 0, jogos = 0
    rounds.forEach(r => {
      const mine = r.round_players?.find(
        p => p.player_name?.toLowerCase() === userName
      )
      if (mine) {
        total += mine.money_result || 0
        jogos++
        if (mine.money_result > 0) wins++
      }
    })
    return { total, wins, jogos }
  }, [rounds, userName])

  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  })

  const fmtMoney = (v) => {
    if (!v) return 'R$ 0'
    return `${v > 0 ? '+' : ''}R$ ${v}`
  }

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">📋 Histórico</span>
        <div style={{ width: 60 }} />
      </header>

      <div className="screen-body">
        {/* Stats rápidas */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="perf-grid">
            <div className="perf-cell">
              <div className={`perf-val ${myStats.total > 0 ? 'pos' : myStats.total < 0 ? 'neg' : 'neu'}`}>
                {fmtMoney(myStats.total)}
              </div>
              <div className="perf-lbl">Saldo total</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val" style={{ color: 'var(--gold)' }}>{myStats.jogos}</div>
              <div className="perf-lbl">Jogos</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val pos">{myStats.wins}</div>
              <div className="perf-lbl">Vitórias</div>
            </div>
            <div className="perf-cell">
              <div className={`perf-val ${myStats.jogos > 0 ? 'pos' : 'neu'}`}>
                {myStats.jogos > 0
                  ? Math.round(myStats.wins / myStats.jogos * 100)
                  : 0}%
              </div>
              <div className="perf-lbl">Taxa</div>
            </div>
          </div>
        </div>

        {/* Filtro */}
        <div className="toggle-row" style={{ marginBottom: 14 }}>
          {[['all', 'Todas'], ['month', 'Este mês'], ['year', 'Este ano']].map(([v, l]) => (
            <button key={v}
              className={`toggle-btn${filter === v ? ' active' : ''}`}
              onClick={() => setFilter(v)}>
              {l}
            </button>
          ))}
        </div>

        {/* Lista */}
        {loading ? (
          <div className="empty-state"><p>Carregando...</p></div>
        ) : rounds.length === 0 ? (
          <div className="empty-state">
            <div className="icon">🏌️</div>
            <p>Nenhuma rodada encontrada.</p>
          </div>
        ) : rounds.map(r => (
          <div key={r.id} className="hist-card">
            <div className="hist-date">{fmtDate(r.played_at)}</div>
            <div className="hist-course" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
              {r.course_name} · {r.format?.toUpperCase()}
            </div>
            <div className="hist-players">
              {r.round_players
                ?.sort((a, b) => (b.money_result || 0) - (a.money_result || 0))
                .map((p, i) => (
                  <div key={i} className="hist-player">
                    <span className="hist-pname" style={{
                      fontWeight: p.player_name?.toLowerCase() === userName ? 700 : 400,
                      color: p.player_name?.toLowerCase() === userName
                        ? 'var(--gold)' : 'rgba(255,255,255,0.7)'
                    }}>
                      {p.player_name}
                      <small style={{ color: 'var(--muted)', fontWeight: 400 }}> HCP{p.handicap}</small>
                    </span>
                    <span className={p.money_result > 0 ? 'pos' : p.money_result < 0 ? 'neg' : 'neu'}>
                      {fmtMoney(p.money_result || 0)}
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

export default HistoryScreen
