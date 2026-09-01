import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

function firstNameLower(fullName) {
  if (!fullName) return ''
  return fullName.trim().split(' ')[0].toLowerCase()
}

export default function HomeScreen({ nav, session }) {
  const [stats,   setStats]   = useState(null)
  const [rounds,  setRounds]  = useState([])
  const [loading, setLoading] = useState(true)

  const fullName  = session?.user?.user_metadata?.full_name || ''
  const firstName = firstNameLower(fullName)
  const displayName = fullName.split(' ')[0] || 'Jogador'

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('rounds')
      .select('id, played_at, course_name, round_players(*)')
      .order('played_at', { ascending: false })
      .limit(20)

    if (data) {
      let total = 0, jogos = 0, wins = 0
      const recent = []
      data.forEach(r => {
        const mine = r.round_players?.find(p => firstNameLower(p.player_name) === firstName)
        if (mine) { total += mine.money_result || 0; jogos++; if (mine.money_result > 0) wins++ }
        if (recent.length < 3) recent.push(r)
      })
      setStats({ total, jogos, wins })
      setRounds(recent)
    }
    setLoading(false)
  }

  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const fmtMoney = v => !v ? 'R$ 0' : `${v > 0 ? '+' : ''}R$ ${Math.abs(v)}`

  return (
    <div className="screen">
      <div className="screen-body" style={{ paddingTop: 20 }}>

        {/* Saudação */}
        <div style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: '2px', textTransform: 'uppercase', marginBottom: 4 }}>
            Bem-vindo de volta
          </p>
          <h1 style={{ fontFamily: 'var(--serif)', fontSize: 32, color: 'var(--cream)', fontWeight: 600, letterSpacing: 1 }}>
            {displayName} <span style={{ color: 'var(--gold)' }}>⛳</span>
          </h1>
          <div className="gold-line" style={{ marginTop: 10 }}/>
        </div>

        {/* Stats */}
        {!loading && stats && (
          <div className="perf-grid" style={{ marginBottom: 16 }}>
            <div className={`perf-cell ${stats.total !== 0 ? 'highlight' : ''}`}>
              <div className={`perf-val ${stats.total > 0 ? 'pos' : stats.total < 0 ? 'neg' : 'neu'}`}>
                {fmtMoney(stats.total)}
              </div>
              <div className="perf-lbl">Saldo geral</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val" style={{ color: 'var(--gold)' }}>{stats.jogos}</div>
              <div className="perf-lbl">Jogos</div>
            </div>
            <div className="perf-cell">
              <div className="perf-val pos">{stats.wins}</div>
              <div className="perf-lbl">Vitórias</div>
            </div>
            <div className="perf-cell">
              <div className={`perf-val ${stats.jogos > 0 ? 'pos' : 'neu'}`}>
                {stats.jogos > 0 ? Math.round(stats.wins / stats.jogos * 100) : 0}%
              </div>
              <div className="perf-lbl">Taxa vitória</div>
            </div>
          </div>
        )}

        {/* Nova Rodada */}
        <button className="btn-primary" onClick={() => nav('setup')} style={{ marginBottom: 16 }}>
          ⛳  Nova Rodada
        </button>

        {/* Últimas rodadas */}
        {rounds.length > 0 && (
          <div className="card">
            <h2>Últimas rodadas</h2>
            {rounds.map(r => (
              <div key={r.id} style={{
                marginBottom: 10, paddingBottom: 10,
                borderBottom: '0.5px solid var(--border)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--muted2)', letterSpacing: '0.5px', marginBottom: 6 }}>
                  {fmtDate(r.played_at)} · {r.course_name}
                </div>
                <div className="hist-players">
                  {r.round_players
                    ?.sort((a, b) => (b.money_result || 0) - (a.money_result || 0))
                    .map((p, i) => (
                      <div key={i} className="hist-player">
                        <span style={{
                          fontWeight: firstNameLower(p.player_name) === firstName ? 700 : 400,
                          color: firstNameLower(p.player_name) === firstName ? 'var(--gold)' : 'rgba(255,255,255,0.6)',
                          fontSize: 13,
                        }}>
                          {p.player_name}
                        </span>
                        <span className={p.money_result > 0 ? 'pos' : p.money_result < 0 ? 'neg' : 'neu'}
                          style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 700 }}>
                          {fmtMoney(p.money_result || 0)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && rounds.length === 0 && (
          <div className="empty-state">
            <div className="icon">🏌️</div>
            <p>Nenhuma rodada ainda.<br/>Toque em <strong>Nova Rodada</strong> para começar.</p>
          </div>
        )}
      </div>

      <nav className="bottom-nav">
        <button className="nav-btn active">
          <span className="nav-icon">🏠</span>
          <span className="nav-label">Início</span>
        </button>
        <button className="nav-btn" onClick={() => nav('history')}>
          <span className="nav-icon">📋</span>
          <span className="nav-label">Histórico</span>
        </button>
        <button className="nav-btn" onClick={() => nav('ranking')}>
          <span className="nav-icon">🏆</span>
          <span className="nav-label">Ranking</span>
        </button>
        <button className="nav-btn" onClick={() => nav('profile')}>
          <span className="nav-icon">👤</span>
          <span className="nav-label">Perfil</span>
        </button>
      </nav>
    </div>
  )
}
