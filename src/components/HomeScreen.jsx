import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { loadDraft, clearDraft, draftSummary } from '../lib/draft'

function firstNameLower(fullName) {
  if (!fullName) return ''
  return fullName.trim().split(' ')[0].toLowerCase()
}

export default function HomeScreen({ nav, session, onResume, notice, onDismissNotice }) {
  const [draft,   setDraft]   = useState(() => loadDraft(session?.user?.id))
  const [confirmNew, setConfirmNew] = useState(false)
  const [stats,   setStats]   = useState(null)
  const [rounds,  setRounds]  = useState([])
  const [loading, setLoading] = useState(true)

  const fullName  = session?.user?.user_metadata?.full_name || ''
  const firstName = firstNameLower(fullName)
  const displayName = session?.user?.user_metadata?.nickname || fullName.split(' ')[0] || 'Jogador'
  const nick = (session?.user?.user_metadata?.nickname || '').trim().toLowerCase()

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
        // "Eu" na rodada: pelo vínculo da conta; nas rodadas antigas (sem
        // vínculo), pelo primeiro nome / apelido, como antes.
        const mine = r.round_players?.find(p => p.player_user_id === session?.user?.id)
          || r.round_players?.find(p => !p.player_user_id && (firstNameLower(p.player_name) === firstName || (nick && p.player_name?.trim().toLowerCase() === nick)))
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

        {notice && (
          <div className="card" style={{ borderColor: 'var(--green2, #5dba7a)', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, fontSize: 13, color: 'var(--cream)', lineHeight: 1.5 }}>{notice}</div>
            <button type="button" onClick={onDismissNotice} aria-label="Fechar aviso"
              style={{ background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 16, cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* Rodada em andamento (guardada no aparelho) */}
        {draft && (() => {
          const { holesDone } = draftSummary(draft)
          const when = new Date(draft.savedAt)
          const hhmm = when.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
          const names = draft.config.players.map(p => p.name).join(', ')
          return (
            <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: 12 }}>
              <h2 style={{ marginBottom: 6 }}>⏸️ Rodada em andamento</h2>
              <div style={{ fontSize: 13, color: 'var(--cream)', marginBottom: 2 }}>
                {draft.config.course?.name || 'Campo'} · {holesDone > 0 ? `${holesDone} buraco${holesDone > 1 ? 's' : ''} lançado${holesDone > 1 ? 's' : ''}` : 'nenhum score ainda'}
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 12 }}>{names} · salva às {hhmm}</div>
              <button className="btn-primary" onClick={onResume} style={{ marginBottom: 8 }}>▶  Continuar rodada</button>
              <button type="button" onClick={() => { clearDraft(session?.user?.id); setDraft(null) }}
                style={{ width: '100%', background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'var(--sans)' }}>
                Descartar esta rodada
              </button>
            </div>
          )
        })()}

        {/* Nova Rodada — se já existe uma em andamento, confirma antes de descartar */}
        {confirmNew ? (
          <div className="card" style={{ marginBottom: 16 }}>
            <p style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.5, marginBottom: 12 }}>
              Começar uma rodada nova <strong>descarta a rodada em andamento</strong>, que ainda não foi salva. Continuar?
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn-secondary" style={{ marginBottom: 0 }} onClick={() => setConfirmNew(false)}>Voltar</button>
              <button className="btn-danger" style={{ width: '100%', padding: 12 }} onClick={() => { clearDraft(session?.user?.id); setDraft(null); nav('setup') }}>Descartar e começar</button>
            </div>
          </div>
        ) : (
          <button className={draft ? 'btn-secondary' : 'btn-primary'} onClick={() => draft ? setConfirmNew(true) : nav('setup')} style={{ marginBottom: 16 }}>
            ⛳  Nova Rodada
          </button>
        )}

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
            <img src="/mascot/retrato.jpg" alt="" style={{
              width: 64, height: 64, borderRadius: '50%', objectFit: 'cover',
              border: '2px solid var(--gold)', margin: '0 auto 12px', display: 'block',
              filter: 'saturate(0.9)',
            }}/>
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
