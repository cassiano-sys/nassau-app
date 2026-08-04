import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function HomeScreen({ nav, session }) {
  const [recentRounds, setRecentRounds] = useState([])
  const [stats, setStats] = useState(null)
  const name = session?.user?.user_metadata?.full_name?.split(' ')[0] || 'Jogador'

  useEffect(() => {
    loadRecent()
  }, [])

  const loadRecent = async () => {
    const { data } = await supabase
      .from('rounds')
      .select('*, round_players(*)')
      .order('played_at', { ascending: false })
      .limit(3)
    if (data) setRecentRounds(data)

    // Quick stats for this user
    const { data: playerData } = await supabase
      .from('round_players')
      .select('money_result, rounds(played_at)')
      .eq('user_id', session.user.id)
    if (playerData) {
      const total = playerData.reduce((s, r) => s + (r.money_result || 0), 0)
      const wins  = playerData.filter(r => r.money_result > 0).length
      setStats({ total, wins, rounds: playerData.length })
    }
  }

  const fmtDate = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit' })

  return (
    <div className="screen">
      <div className="screen-body">
        {/* Welcome */}
        <div style={{ marginBottom: 24, paddingTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Bem-vindo de volta,</p>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, color: 'var(--cream)' }}>
            {name} <span style={{ color: 'var(--gold)' }}>⛳</span>
          </h1>
        </div>

        {/* Quick stats */}
        {stats && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="perf-grid">
              <div className="perf-cell">
                <div className={`perf-val ${stats.total > 0 ? 'pos' : stats.total < 0 ? 'neg' : 'neu'}`}>
                  {stats.total > 0 ? '+' : ''}R$ {stats.total}
                </div>
                <div className="perf-lbl">Saldo geral</div>
              </div>
              <div className="perf-cell">
                <div className="perf-val" style={{ color: 'var(--gold)' }}>{stats.rounds}</div>
                <div className="perf-lbl">Rodadas</div>
              </div>
              <div className="perf-cell">
                <div className="perf-val pos">{stats.wins}</div>
                <div className="perf-lbl">Vitórias</div>
              </div>
              <div className="perf-cell">
                <div className={`perf-val ${stats.rounds > 0 ? 'pos' : 'neu'}`}>
                  {stats.rounds > 0 ? Math.round(stats.wins / stats.rounds * 100) : 0}%
                </div>
                <div className="perf-lbl">Taxa vitória</div>
              </div>
            </div>
          </div>
        )}

        {/* New round button */}
        <button className="btn-primary" onClick={() => nav('setup')} style={{ marginBottom: 12 }}>
          ⛳ Nova Rodada
        </button>

        {/* Recent */}
        {recentRounds.length > 0 && (
          <div className="card">
            <h2>Últimas rodadas</h2>
            {recentRounds.map(r => (
              <div key={r.id} className="hist-card" style={{ marginBottom: 6 }}>
                <div className="hist-date">{fmtDate(r.played_at)} · {r.course_name}</div>
                <div className="hist-players">
                  {r.round_players?.map((p, i) => (
                    <div key={i} className="hist-player">
                      <span className="hist-pname">{p.player_name}</span>
                      <span className={p.money_result > 0 ? 'pos' : p.money_result < 0 ? 'neg' : 'neu'}>
                        {p.money_result > 0 ? '+' : ''}R$ {p.money_result || 0}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {recentRounds.length === 0 && !stats && (
          <div className="empty-state">
            <div className="icon">🏌️</div>
            <p>Nenhuma rodada ainda.<br/>Toque em <strong>Nova Rodada</strong> para começar!</p>
          </div>
        )}
      </div>

      {/* Bottom nav */}
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
