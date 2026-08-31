import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function HomeScreen({ nav, session }) {
  const [stats, setStats]         = useState(null)
  const [recentRounds, setRecent] = useState([])
  const [loading, setLoading]     = useState(true)

  const userName = session?.user?.user_metadata?.full_name?.split(' ')[0] || 'Jogador'

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    setLoading(true)

    // Busca todas as rodadas com jogadores
    const { data: rounds } = await supabase
      .from('rounds')
      .select('id, played_at, course_name, round_players(*)')
      .order('played_at', { ascending: false })
      .limit(10)

    if (rounds) {
      // Calcula stats do usuário logado pelo nome (case-insensitive)
      const myName = userName.toLowerCase()

      let totalMoney = 0
      let totalJogos = 0
      let vitorias   = 0
      const recentList = []

      rounds.forEach(round => {
        // Encontra o jogador desta rodada que é o usuário logado
        const myPlayer = round.round_players?.find(
          p => p.player_name?.toLowerCase() === myName
        )

        if (myPlayer) {
          totalJogos++
          totalMoney += myPlayer.money_result || 0
          if (myPlayer.money_result > 0) vitorias++
        }

        // Para a lista de recentes, mostra sempre (com ou sem o usuário)
        if (recentList.length < 3) {
          recentList.push(round)
        }
      })

      setStats({ totalMoney, totalJogos, vitorias })
      setRecent(recentList)
    }

    setLoading(false)
  }

  const fmtDate = (iso) => {
    const d = new Date(iso)
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  }

  const fmtMoney = (v) => {
    if (v === 0) return 'R$ 0'
    return `${v > 0 ? '+' : ''}R$ ${Math.abs(v)}`
  }

  return (
    <div className="screen">
      <div className="screen-body">

        {/* Saudação */}
        <div style={{ marginBottom: 20, paddingTop: 8 }}>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>Bem-vindo de volta,</p>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 28, color: 'var(--cream)' }}>
            {userName} <span style={{ color: 'var(--gold)' }}>⛳</span>
          </h1>
        </div>

        {/* Stats */}
        {!loading && stats && (
          <div className="card" style={{ marginBottom: 20 }}>
            <div className="perf-grid">
              <div className="perf-cell">
                <div className={`perf-val ${
                  stats.totalMoney > 0 ? 'pos' :
                  stats.totalMoney < 0 ? 'neg' : 'neu'
                }`}>
                  {fmtMoney(stats.totalMoney)}
                </div>
                <div className="perf-lbl">Saldo geral</div>
              </div>
              <div className="perf-cell">
                <div className="perf-val" style={{ color: 'var(--gold)' }}>
                  {stats.totalJogos}
                </div>
                <div className="perf-lbl">Jogos</div>
              </div>
              <div className="perf-cell">
                <div className="perf-val pos">{stats.vitorias}</div>
                <div className="perf-lbl">Vitórias</div>
              </div>
              <div className="perf-cell">
                <div className={`perf-val ${stats.totalJogos > 0 ? 'pos' : 'neu'}`}>
                  {stats.totalJogos > 0
                    ? Math.round(stats.vitorias / stats.totalJogos * 100)
                    : 0}%
                </div>
                <div className="perf-lbl">Taxa vitória</div>
              </div>
            </div>
          </div>
        )}

        {/* Botão Nova Rodada */}
        <button className="btn-primary" onClick={() => nav('setup')} style={{ marginBottom: 12 }}>
          ⛳ Nova Rodada
        </button>

        {/* Últimas rodadas */}
        {recentRounds.length > 0 && (
          <div className="card">
            <h2>Últimas rodadas</h2>
            {recentRounds.map(round => (
              <div key={round.id} className="hist-card" style={{ marginBottom: 8 }}>
                <div className="hist-date">
                  {fmtDate(round.played_at)} · {round.course_name}
                </div>
                <div className="hist-players">
                  {round.round_players
                    ?.sort((a, b) => (b.money_result || 0) - (a.money_result || 0))
                    .map((p, i) => (
                      <div key={i} className="hist-player">
                        <span className="hist-pname" style={{
                          fontWeight: p.player_name?.toLowerCase() === userName.toLowerCase() ? 700 : 400,
                          color: p.player_name?.toLowerCase() === userName.toLowerCase()
                            ? 'var(--gold)' : 'rgba(255,255,255,0.7)'
                        }}>
                          {p.player_name}
                        </span>
                        <span className={
                          p.money_result > 0 ? 'pos' :
                          p.money_result < 0 ? 'neg' : 'neu'
                        }>
                          {fmtMoney(p.money_result || 0)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && recentRounds.length === 0 && (
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
