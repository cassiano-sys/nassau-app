import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { loadDraft, clearDraft, draftSummary } from '../lib/draft'
import { fmtSigned } from '../lib/money'
import { needsNickname, suggestNickname, syncProfile } from '../lib/friends'
import { shouldShowInstall, dismissInstall, canPromptInstall, promptInstall, subscribeInstall, platform, INSTALL_GUIDE_URL } from '../lib/install'

// Primeira vez pelo navegador do celular: convida a instalar na tela inicial.
function InstallCard() {
  const [show, setShow] = useState(shouldShowInstall)
  const [, force] = useState(0)
  useEffect(() => subscribeInstall(() => { force(x => x + 1); setShow(shouldShowInstall()) }), [])
  if (!show) return null
  const close = () => { dismissInstall(); setShow(false) }
  const ios = platform() === 'ios'
  return (
    <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: 12, position: 'relative' }}>
      <button type="button" onClick={close} aria-label="Fechar"
        style={{ position: 'absolute', top: 6, right: 8, background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', padding: 4 }}>×</button>
      <div style={{ fontSize: 14, color: 'var(--cream)', fontWeight: 600, marginBottom: 4, paddingRight: 24 }}>📲 Tenha o Caddie na tela do celular</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 10 }}>
        {ios
          ? <>Instale em poucos segundos: no <strong>Safari</strong>, toque em Compartilhar <span aria-hidden>⬆️</span> e depois em <strong>“Adicionar à Tela de Início”</strong>.</>
          : 'Instale em poucos segundos e abra como qualquer outro aplicativo.'}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {canPromptInstall()
          ? <button type="button" className="btn-primary" style={{ marginBottom: 0, flex: 1 }} onClick={async () => { if (await promptInstall()) setShow(false) }}>Instalar agora</button>
          : <a className="btn-primary" href={INSTALL_GUIDE_URL} target="_blank" rel="noopener noreferrer"
              style={{ marginBottom: 0, flex: 1, display: 'block', textAlign: 'center', textDecoration: 'none', boxSizing: 'border-box' }}>Ver como instalar</a>}
        <button type="button" className="btn-secondary" style={{ marginBottom: 0, flex: '0 0 auto', width: 'auto', padding: '0 14px' }} onClick={close}>Agora não</button>
      </div>
    </div>
  )
}

// Contas antigas (de antes do apelido ser obrigatório): pede uma vez, já
// sugerindo "Nome + inicial", pra não ficarem dois "Alexandre" iguais.
function NicknameCard({ session }) {
  const user = session?.user
  const [val, setVal] = useState(() => suggestNickname(user?.user_metadata?.full_name || ''))
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)
  if (done || !needsNickname(user)) return null
  const save = async () => {
    setSaving(true); setErr('')
    const { data, error } = await supabase.auth.updateUser({ data: { nickname: val.trim() } })
    setSaving(false)
    if (error) return setErr('Não deu pra salvar agora. Tente de novo.')
    if (data?.user) syncProfile(data.user)
    setDone(true)
  }
  return (
    <div className="card" style={{ borderColor: 'var(--gold)', marginBottom: 12 }}>
      <div style={{ fontSize: 14, color: 'var(--cream)', fontWeight: 600, marginBottom: 4 }}>Como você aparece no cartão?</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 8 }}>
        Seus amigos te encontram por esse nome. Use nome + inicial do sobrenome pra não confundir com outro de mesmo nome.
      </div>
      <input className="text-input" value={val} maxLength={24} placeholder="Ex.: Paulo S." onChange={e => setVal(e.target.value)} style={{ marginBottom: 8 }}/>
      <button type="button" className="btn-primary" disabled={saving || !val.trim()} onClick={save} style={{ marginBottom: 0 }}>
        {saving ? '...' : 'Salvar'}
      </button>
      {err && <div style={{ fontSize: 12, color: 'var(--red, #e07a7a)', marginTop: 6 }}>{err}</div>}
    </div>
  )
}

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
    // Saldo/jogos/vitórias somam TODAS as rodadas (antes só as 20 mais recentes);
    // a lista "Últimas rodadas" continua com as 3 mais novas.
    const [{ data }, { data: recentData }] = await Promise.all([
      supabase.from('rounds').select('id, round_players(player_name,player_user_id,money_result)'),
      supabase.from('rounds').select('id, played_at, course_name, round_players(*)')
        .order('played_at', { ascending: false }).limit(3),
    ])

    if (data) {
      let total = 0, jogos = 0, wins = 0
      const recent = recentData || []
      data.forEach(r => {
        // "Eu" na rodada: pelo vínculo da conta; nas rodadas antigas (sem
        // vínculo), pelo primeiro nome / apelido, como antes.
        const mine = r.round_players?.find(p => p.player_user_id === session?.user?.id)
          || r.round_players?.find(p => !p.player_user_id && (firstNameLower(p.player_name) === firstName || (nick && p.player_name?.trim().toLowerCase() === nick)))
        if (mine) { total += mine.money_result || 0; jogos++; if (mine.money_result > 0) wins++ }
      })
      setStats({ total, jogos, wins })
      setRounds(recent)
    }
    setLoading(false)
  }

  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
  const fmtMoney = v => fmtSigned(v)

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

        <NicknameCard session={session}/>
        {!needsNickname(session?.user) && <InstallCard/>}

        {notice && (
          <div className="card" style={{ borderColor: 'var(--green2, #5dba7a)', marginBottom: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, fontSize: 13, color: 'var(--cream)', lineHeight: 1.5 }}>
              {typeof notice === 'string' ? notice : notice.text}
              {notice.retry && (
                <button type="button" className="btn-secondary" onClick={notice.retry} style={{ marginTop: 8, marginBottom: 0, padding: '8px' }}>
                  Tentar de novo
                </button>
              )}
              {notice.detail && (
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 6, wordBreak: 'break-word' }}>Detalhe: {notice.detail}</div>
              )}
            </div>
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
