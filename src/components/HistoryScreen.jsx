import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { resizeImageToBase64 } from '../lib/image'
import PixSettlement, { PixKeyForm } from './PixSettlement'
import ScorecardScreen from './ScorecardScreen'
import { COURSES } from '../lib/golf'

// Remonta a configuração de uma rodada salva pra abrir o Resumo dela.
// Rodadas novas trazem um "snapshot" completo; nas antigas, o que falta
// (opções de dupla/individual) vai com o padrão do formato.
async function buildViewConfig(r) {
  const bv = r.bet_values || {}
  const snap = bv.snapshot
  const rps = r.round_players || []
  let players, scores, si, par, course, teamA, teamB, extra, legacy = false, stored
  if (snap?.players?.length) {
    const used = new Set()
    const rows = snap.players.map(sp => {
      const i = rps.findIndex((rp, k) => !used.has(k) && rp.player_name === sp.name)
      if (i >= 0) used.add(i)
      return rps[i] || {}
    })
    players = snap.players.map(sp => ({ name: sp.name, handicap: sp.handicap, userId: sp.userId || null }))
    scores  = rows.map(rp => rp.gross_scores || Array(18).fill(null))
    stored  = rows.map(rp => Number(rp.money_result || 0))
    ;({ si, par, course, teamA, teamB } = snap)
    extra = { playWithin: snap.playWithin, teamsEnabled: snap.teamsEnabled, playsIndividual: snap.playsIndividual, betUnit: snap.betUnit }
  } else {
    legacy = true
    const ord = [...rps].sort((a, b) => (a.team || 'A').localeCompare(b.team || 'A'))
    players = ord.map(rp => ({ name: rp.player_name, handicap: Number(rp.handicap || 0), userId: rp.player_user_id || null }))
    scores  = ord.map(rp => rp.gross_scores || Array(18).fill(null))
    stored  = ord.map(rp => Number(rp.money_result || 0))
    teamA = ord.map((rp, i) => rp.team === 'B' ? -1 : i).filter(i => i >= 0)
    teamB = ord.map((rp, i) => rp.team === 'B' ? i : -1).filter(i => i >= 0)
    if (teamA.length !== 2 || teamB.length !== 2) { teamA = [0, 1]; teamB = [2, 3] }
    const fixed = COURSES.find(c => c.id === r.course_id)
    if (fixed && fixed.id !== 'custom') { si = fixed.si; par = fixed.par; course = fixed }
    else {
      const { data } = await supabase.from('saved_courses').select('id,name,si,par').eq('id', r.course_id).maybeSingle()
      const c = data || COURSES[0]
      si = c.si; par = c.par; course = { id: c.id, name: r.course_name || c.name, si: c.si, par: c.par }
    }
    extra = { playWithin: false, teamsEnabled: true, playsIndividual: null, betUnit: bv.frontVal ?? 20 }
  }
  const { snapshot, medalSide, ...betValues } = bv
  return {
    legacy, stored,
    config: {
      format: r.format, players, si, par, course: course || { name: r.course_name }, teamA, teamB,
      numPlayers: players.length, betValues, medalSide: medalSide || null, ...extra,
    },
    scores,
  }
}
import { displayPixKey, PIX_TYPES } from '../lib/pix'
import { listFriends, createInviteLink, claimRounds, removeFriend, syncProfile } from '../lib/friends'

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
        // O sinal salvo deve ser relativo a nameA (fixado no primeiro confronto registrado),
        // não à ordem alfabética de keyA/keyB do confronto atual
        const sameOrder = firstNameLower(map[key].nameA) === keyA
        map[key].balance += (sameOrder ? m.result_a : -m.result_a)
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
          // Sinal relativo a nameA (fixado no primeiro confronto registrado)
          const sameOrder = firstNameLower(map[key].nameA) === keyA
          map[key].balance += (sameOrder ? diff : -diff)
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
  const [pixOpen, setPixOpen] = useState(null) // id da rodada com o acerto PIX aberto
  const [viewing, setViewing] = useState(null) // rodada aberta no Resumo (somente leitura)
  const [opening, setOpening] = useState(null)

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

  const myId = session?.user?.id
  const myNick = (session?.user?.user_metadata?.nickname || '').trim().toLowerCase()
  // "Eu" na rodada: pela conta vinculada; nas rodadas antigas sem vínculo,
  // pelo primeiro nome ou apelido (como antes).
  const isMe = (p) => p.player_user_id ? p.player_user_id === myId
    : (firstName.length > 0 && firstNameLower(p.player_name) === firstName) || (!!myNick && (p.player_name || '').trim().toLowerCase() === myNick)

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
  }, [rounds, firstName])

  const fmtDate = iso => new Date(iso).toLocaleDateString('pt-BR', { day:'2-digit', month:'2-digit', year:'numeric' })
  const fmtMoney = (v) => !v ? 'R$ 0' : `${v > 0 ? '+' : ''}R$ ${Math.abs(v)}`

  const openRound = async (r) => {
    setOpening(r.id)
    try {
      const v = await buildViewConfig(r)
      const meIndex = v.config.players.findIndex((p, i) => isMe({ player_name: p.name, player_user_id: p.userId }))
      setViewing({ ...v, meIndex, dateLabel: fmtDate(r.played_at), id: r.id })
    } catch (e) { console.error('Erro ao abrir rodada:', e) }
    setOpening(null)
  }

  if (viewing) return (
    <ScorecardScreen
      key={viewing.id}
      readOnly
      config={viewing.config}
      initialDraft={{ scores: viewing.scores }}
      storedMoney={viewing.stored}
      viewMeta={{ dateLabel: viewing.dateLabel, legacy: viewing.legacy, meIndex: viewing.meIndex }}
      session={session}
      onBack={() => setViewing(null)}
      onFinish={() => setViewing(null)}
    />
  )

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
            <button type="button" onClick={() => openRound(r)} disabled={opening === r.id}
              style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(255,255,255,0.05)', border: '0.5px solid rgba(255,255,255,0.15)',
                color: 'var(--cream)', fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 700 }}>
              {opening === r.id ? 'Abrindo...' : '📄 Ver resumo da rodada'}
            </button>
            {r.round_players?.some(p => Math.abs(p.money_result || 0) >= 0.01) && (
              <button type="button" onClick={() => setPixOpen(pixOpen === r.id ? null : r.id)}
                style={{ marginTop: 10, width: '100%', padding: '8px', borderRadius: 8, cursor: 'pointer',
                  background: 'rgba(201,168,76,0.08)', border: '0.5px solid rgba(201,168,76,0.3)',
                  color: 'var(--gold)', fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 700 }}>
                {pixOpen === r.id ? 'Fechar acerto' : '💸 Acerto via PIX'}
              </button>
            )}
            {pixOpen === r.id && (
              <div style={{ marginTop: 10 }}>
                <PixSettlement
                  players={(r.round_players || []).map(p => ({ name: p.player_name, handicap: p.handicap, money: p.money_result || 0 }))}
                  meIndex={(r.round_players || []).findIndex(p => isMe(p))}
                  description={`Golfe ${r.course_name || ''} ${new Date(r.played_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ProfileScreen({ onBack, session, onSignOut }) {
  const [name,   setName]   = useState(session?.user?.user_metadata?.full_name || '')
  const [hcp,    setHcp]    = useState(session?.user?.user_metadata?.handicap  || 0)
  const [nickname, setNickname] = useState(session?.user?.user_metadata?.nickname || (session?.user?.user_metadata?.full_name || '').split(' ')[0] || '')
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)
  const [pixKey,  setPixKey]  = useState(session?.user?.user_metadata?.pix_key  || '')
  const [pixType, setPixType] = useState(session?.user?.user_metadata?.pix_type || 'phone')
  const [pixEdit, setPixEdit] = useState(false)

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

  const handleHwSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      // Redimensiona antes de guardar - essa amostra é reenviada junto em
      // TODA leitura de cartão por foto, então se ela também vier gigante
      // (foto de celular em alta resolução) só piora o risco de timeout.
      const { dataUrl, base64 } = await resizeImageToBase64(file, 1000, 0.85)
      setHwPreview(dataUrl)
      setHwB64(base64)
    } catch (err) {
      console.error('Erro ao processar a amostra de caligrafia:', err)
    }
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
    const { data } = await supabase.auth.updateUser({ data: { full_name: name, handicap: hcp, nickname: nickname.trim() } })
    if (data?.user) syncProfile(data.user) // amigos passam a ver o apelido novo
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
            <div className="field-label">Como você aparece no cartão</div>
            <input className="text-input" value={nickname}
              onChange={e => setNickname(e.target.value)} placeholder="Apelido ou nome + sobrenome"/>
            <div style={{ fontSize:11, color:'var(--muted2)', marginTop:4, lineHeight:1.5 }}>
              É assim que seus amigos te acham e que seu nome vai no cartão (ex.: "Paulinho" ou "Paulo S.").
            </div>
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
        <FriendsCard session={session}/>

        <div className="card">
          <h2>Minha chave PIX</h2>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12, lineHeight: 1.6 }}>
            No fim da rodada, quem perdeu pra você recebe um QR code / Pix Copia e Cola já com o valor certo. O app não movimenta dinheiro — só monta o código.
          </p>
          {pixKey && !pixEdit ? (
            <>
              <div style={{ fontSize: 14, color: 'var(--cream)', marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--muted2)' }}>{PIX_TYPES.find(t => t.id === pixType)?.label}: </span>
                <strong>{displayPixKey(pixType, pixKey)}</strong>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" style={{ marginBottom: 0 }} onClick={() => setPixEdit(true)}>Trocar chave</button>
                <button className="btn-danger" style={{ width: '100%', padding: 12 }} onClick={async () => {
                  await supabase.auth.updateUser({ data: { pix_key: null, pix_type: null } })
                  setPixKey('')
                }}>Remover</button>
              </div>
            </>
          ) : (
            <PixKeyForm
              initialType={pixType}
              onCancel={pixKey ? () => setPixEdit(false) : undefined}
              onSave={async (type, key) => {
                const { error } = await supabase.auth.updateUser({ data: { pix_key: key, pix_type: type } })
                if (error) return error.message
                setPixKey(key); setPixType(type); setPixEdit(false)
                return null
              }}
            />
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
          <h2>Caddie Stakes Golf</h2>
          <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.8 }}>
            <div>Versão 1.0</div>
            <div>Nassau · Match Play · Catraca · Medal</div>
            <div>Skins · Stableford · Sindicato</div>
            <div>Press automático · Foto do cartão · Acerto via PIX</div>
            <div>Histórico na nuvem · Ranking</div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Meus amigos: convite por link, lista, vincular rodadas antigas ─────────────
function FriendsCard({ session }) {
  const uid = session?.user?.id
  const [friends, setFriends] = useState(null)
  const [error,   setError]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [claimFor, setClaimFor] = useState(null)   // id do amigo com o vínculo aberto
  const [claimName, setClaimName] = useState('')
  const [claimMsg, setClaimMsg] = useState('')
  const [copied, setCopied] = useState(false)

  const load = () => listFriends(uid).then(setFriends).catch(() => setFriends([]))
  useEffect(() => { if (uid) load() }, [uid])

  const invite = async (how) => {
    setBusy(true); setError('')
    try {
      const link = await createInviteLink()
      const nick = session?.user?.user_metadata?.nickname || (session?.user?.user_metadata?.full_name || '').split(' ')[0] || ''
      const text = `⛳ ${nick ? nick + ' te convidou pro' : 'Bora usar o'} Caddie Stakes — o app que calcula as apostas do golfe (Nassau, Skins, Medal…) e fecha a conta no final.\n\nToque no link pra entrar e a gente fica conectado:\n${link}`
      if (how === 'copy') {
        try { await navigator.clipboard.writeText(link) } catch {}
        setCopied(true); setTimeout(() => setCopied(false), 2000)
      } else {
        window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
      }
    } catch (e) {
      console.error('Erro ao gerar convite:', e.message)
      setError('Não foi possível gerar o convite agora. Tente de novo em instantes.')
    }
    setBusy(false)
  }

  const doClaim = async (f) => {
    const nm = claimName.trim()
    if (!nm) return
    setBusy(true); setClaimMsg('')
    try {
      const n = await claimRounds(f.id, nm)
      setClaimMsg(n > 0 ? `✓ ${n} rodada${n > 1 ? 's' : ''} vinculada${n > 1 ? 's' : ''} a ${f.nickname}.` : `Nenhuma rodada sua com o nome "${nm}" sem vínculo.`)
    } catch (e) {
      setClaimMsg('Não foi possível vincular agora.')
    }
    setBusy(false)
  }

  const unfriend = async (f) => {
    setBusy(true)
    try { await removeFriend(f.id); await load() } catch {}
    setBusy(false)
  }

  return (
    <div className="card">
      <h2>Meus amigos</h2>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10, lineHeight: 1.6 }}>
        Amigo conectado aparece com <strong style={{ color: 'var(--green2, #5dba7a)' }}>✓</strong> na hora de montar a rodada — e as rodadas que vocês jogarem juntos aparecem no app dos dois. Ninguém mais vê.
      </p>
      {friends === null ? (
        <p style={{ fontSize: 12, color: 'var(--muted)' }}>Carregando...</p>
      ) : friends.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--muted2)', marginBottom: 6 }}>Nenhum amigo conectado ainda.</p>
      ) : friends.map(f => (
        <div key={f.id} style={{ padding: '9px 0', borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 14, color: 'var(--cream)' }}>{f.nickname} <span style={{ color: 'var(--green2, #5dba7a)', fontWeight: 700 }}>✓</span></span>
            <button type="button" onClick={() => { setClaimFor(claimFor === f.id ? null : f.id); setClaimName(f.nickname); setClaimMsg('') }}
              style={{ background: 'rgba(201,168,76,0.1)', border: '0.5px solid var(--gold)', color: 'var(--gold)', borderRadius: 8, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--sans)' }}>
              Vincular rodadas antigas
            </button>
          </div>
          {claimFor === f.id && (
            <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.25)' }}>
              <div style={{ fontSize: 11, color: 'var(--muted2)', marginBottom: 6, lineHeight: 1.5 }}>
                Nome com que {f.nickname} aparece nas rodadas antigas que <strong>você</strong> lançou:
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="text-input" style={{ flex: 1, marginBottom: 0 }} value={claimName} onChange={e => setClaimName(e.target.value)}/>
                <button className="btn-secondary" style={{ width: 'auto', padding: '0 14px', marginBottom: 0 }} disabled={busy} onClick={() => doClaim(f)}>Vincular</button>
              </div>
              {claimMsg && <div style={{ fontSize: 12, color: 'var(--cream)', marginTop: 8 }}>{claimMsg}</div>}
              <button type="button" onClick={() => unfriend(f)} disabled={busy}
                style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 11, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'var(--sans)' }}>
                Desfazer amizade com {f.nickname}
              </button>
            </div>
          )}
        </div>
      ))}
      <button className="btn-primary" onClick={() => invite('whatsapp')} disabled={busy} style={{ marginTop: 12, marginBottom: 8 }}>
        📲 Convidar amigo pelo WhatsApp
      </button>
      <button type="button" onClick={() => invite('copy')} disabled={busy}
        style={{ width: '100%', background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 12, textDecoration: 'underline', cursor: 'pointer', fontFamily: 'var(--sans)' }}>
        {copied ? '✓ Link copiado' : 'Copiar link de convite'}
      </button>
      {error && <p style={{ fontSize: 12, color: 'var(--red, #e05555)', marginTop: 8 }}>⚠️ {error}</p>}
    </div>
  )
}

export default HistoryScreen
