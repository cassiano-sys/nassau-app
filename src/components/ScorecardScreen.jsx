import { useState, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  HOLES, FRONT, BACK,
  getStrokesGlobal, getStrokesPair,
  calcIndiv, calcTeam, calcMoney, segMoney,
  calcSkins, calcStableford, cmp,
} from '../lib/golf'

// ── Photo capture via IA ───────────────────────────────────────────────────────

async function readCardWithVision(imageBase64, players, si, par) {
  const response = await fetch('/api/read-card', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, players, si, par }),
  })
  if (!response.ok) throw new Error('Erro na leitura: ' + response.status)
  return await response.json()
}


// ── Main Component ────────────────────────────────────────────────────────────
export default function ScorecardScreen({ config, onFinish, onBack, session }) {
  const { format, players, si, par, betValues, betUnit, numPlayers, teamA, teamB, playWithin, course } = config

  const [scores, setScores]     = useState(() => players.map(() => Array(18).fill(null)))
  const [activeHole, setActiveHole] = useState(0)
  const [tab, setTab]           = useState('card') // card | results
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)

  // Photo states
  const [photoMode, setPhotoMode]   = useState(false)
  const [photoImg, setPhotoImg]     = useState(null)
  const [photoB64, setPhotoB64]     = useState(null)
  const [processing, setProcessing] = useState(false)
  const [photoResult, setPhotoResult] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const fileRef = useRef()

  const lowestHcp = Math.min(...players.map(p => p.handicap))

  const upd = (pi, i, v) => setScores(prev => {
    const n = prev.map(r => [...r])
    n[pi][i] = v === '' ? null : Number(v)
    return n
  })

  // ── Pairs ──
  const pairs = useMemo(() => {
    const p = []
    for (let a = 0; a < numPlayers; a++)
      for (let b = a + 1; b < numPlayers; b++) {
        const sameTeam = (teamA.includes(a) && teamA.includes(b)) || (teamB.includes(a) && teamB.includes(b))
        if (!playWithin && sameTeam) continue
        p.push([a, b])
      }
    return p
  }, [numPlayers, teamA, teamB, playWithin])

  // ── Nassau calculations ──
  const indivResults = useMemo(() =>
    format === 'nassau' ? pairs.map(([a, b]) =>
      calcIndiv(scores[a], scores[b], players[a].handicap, players[b].handicap, si, 2)
    ) : []
  , [scores, pairs, players, si, format])

  const indivMoney = useMemo(() =>
    indivResults.map(r => calcMoney(r, betValues))
  , [indivResults, betValues])

  const teamResult = useMemo(() =>
    format === 'nassau' && numPlayers === 4
      ? calcTeam(scores, players, teamA, teamB, si, 4)
      : null
  , [scores, players, teamA, teamB, si, numPlayers, format])

  const teamMoney = useMemo(() =>
    teamResult ? calcMoney(teamResult, betValues) : null
  , [teamResult, betValues])

  // ── Skins ──
  const skinsResult = useMemo(() =>
    format === 'skins' ? calcSkins(scores, players, si, betUnit) : null
  , [scores, players, si, betUnit, format])

  // ── Stableford ──
  const stableResult = useMemo(() =>
    format === 'stableford' ? calcStableford(scores, players, si, par, betUnit) : null
  , [scores, players, si, par, betUnit, format])

  // ── Money per player ──
  const playerMoney = useMemo(() => {
    const m = players.map(() => 0)
    if (format === 'nassau') {
      indivMoney.forEach((im, mi) => {
        const [a, b] = pairs[mi]
        m[a] += im.grand; m[b] -= im.grand
      })
      if (teamMoney) {
        teamA.forEach(i => { m[i] += teamMoney.grand })
        teamB.forEach(i => { m[i] -= teamMoney.grand })
      }
    } else if (format === 'skins' && skinsResult) {
      skinsResult.money.forEach((v, i) => { m[i] = v })
    } else if (format === 'stableford' && stableResult) {
      stableResult.money.forEach((v, i) => { m[i] = v })
    }
    return m
  }, [indivMoney, teamMoney, skinsResult, stableResult, format, pairs, teamA, teamB, players])

  // ── Photo handling ──
  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const dataUrl = ev.target.result
      setPhotoImg(dataUrl)
      setPhotoB64(dataUrl.split(',')[1])
    }
    reader.readAsDataURL(file)
  }

  const processPhoto = async () => {
    if (!photoB64) return
    setProcessing(true); setPhotoError('')
    try {
      const result = await readCardWithVision(photoB64, players, si, par)
      setPhotoResult(result)
    } catch (e) {
      // Even on error, show an empty editable table so user can fill manually
      setPhotoResult({
        scores: players.map(() => Array(18).fill(null)),
        confidence: 'low',
        notes: 'Leitura automática não foi possível. Preencha ou corrija os scores abaixo.'
      })
    }
    setProcessing(false)
  }

  const applyPhotoScores = (editedScores) => {
    const src = editedScores || photoResult?.scores
    if (!src) return
    setScores(src.map(row =>
      row.map(v => v === null ? null : Number(v))
    ))
    setPhotoMode(false); setPhotoImg(null); setPhotoB64(null); setPhotoResult(null)
  }

 // ── Save round ──
  const saveRound = async () => {
    setSaving(true)
    try {
      const { data: round, error: rErr } = await supabase.from('rounds').insert({
        user_id:     session.user.id,
        format,
        course_name: course?.name || 'Campo',
        course_id:   course?.id || 'custom',
        played_at:   new Date().toISOString(),
        bet_values:  betValues,
        num_players: numPlayers,
      }).select().single()
      if (rErr) throw rErr

      const playerRows = players.map((p, pi) => ({
        round_id:      round.id,
        user_id:       session.user.id,
        player_name:   p.name,
        handicap:      p.handicap,
        gross_scores:  scores[pi],
        money_result:  playerMoney[pi],
        team:          teamA.includes(pi) ? 'A' : 'B',
      }))
      await supabase.from('round_players').insert(playerRows)

      if (format === 'nassau' && indivMoney.length > 0) {
        const matchupRows = pairs.map(([a, b], mi) => {
          const m = indivMoney[mi]
          return {
            round_id: round.id,
            type:     'individual',
            player_a: players[a].name,
            player_b: players[b].name,
            result_a:  m.grand,
            result_b: -m.grand,
            front_a:   m.front.total,
            back_a:    m.back.total,
            total_a:   m.total18,
          }
        })
        if (numPlayers === 4 && teamMoney) {
          const tLA = teamA.map(i => players[i].name).join('/')
          const tLB = teamB.map(i => players[i].name).join('/')
          matchupRows.push({
            round_id: round.id,
            type:     'team',
            player_a: tLA,
            player_b: tLB,
            team_a:   tLA,
            team_b:   tLB,
            result_a:  teamMoney.grand,
            result_b: -teamMoney.grand,
            front_a:   teamMoney.front.total,
            back_a:    teamMoney.back.total,
            total_a:   teamMoney.total18,
          })
        }
        await supabase.from('round_matchups').insert(matchupRows)
      }

      setSaved(true)
    } catch (e) {
      console.error('Save error:', e)
    }
    setSaving(false)
  }
  // ── Photo mode UI ──
  if (photoMode) return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={() => { setPhotoMode(false); setPhotoImg(null); setPhotoResult(null) }}>←</button>
        <span className="header-title">📷 Foto do Cartão</span>
        <div style={{ width: 60 }}/>
      </header>
      <div className="screen-body">
        {!photoImg ? (
          <>
            <div className="card">
              <h2>Fotografe o cartão</h2>
              <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.7 }}>
                Tire uma foto do cartão de score. A IA vai ler os scores de cada jogador automaticamente — você poderá corrigir antes de confirmar.
              </p>
              <button className="photo-btn" onClick={() => fileRef.current?.click()}>
                📷 Selecionar foto
              </button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment"
                style={{ display: 'none' }} onChange={handlePhotoSelect}/>
            </div>
            <div className="card" style={{ borderColor: 'rgba(68,136,204,0.3)' }}>
              <h3>Dicas para melhor leitura</h3>
              <ul style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 2, paddingLeft: 16 }}>
                <li>Foto na horizontal, cartão inteiro visível</li>
                <li>Boa iluminação, sem sombras</li>
                <li>Cartão plano, sem dobras</li>
                <li>Foco nos números, não no fundo</li>
              </ul>
            </div>
          </>
        ) : !photoResult ? (
          <>
            <img src={photoImg} alt="Cartão" className="photo-preview"/>
            {processing ? (
              <div className="processing-msg">
                <div style={{ fontSize: 32, marginBottom: 10 }}>🤖</div>
                <p style={{ fontFamily: "var(--serif)", fontSize: 16, color: "var(--cream)", letterSpacing: "1px" }}>Lendo o cartão...</p>
              </div>
            ) : (
              <>
                  <button className="btn-primary" onClick={processPhoto} style={{ marginBottom: 10 }}>
                  Ler scores automaticamente
                </button>
                <button className="btn-secondary" onClick={() => { setPhotoImg(null); setPhotoB64(null) }}>
                  Trocar foto
                </button>
              </>
            )}
          </>
        ) : (
          <PhotoConfirm
            players={players}
            photoResult={photoResult}
            par={par}
            onConfirm={applyPhotoScores}
            onRetry={() => { setPhotoResult(null); setPhotoImg(null) }}
          />
        )}
      </div>
    </div>
  )

  return (
    <div className="screen">
      <header className="app-header">
        <button className="back-btn" onClick={onBack}>←</button>
        <span className="header-title">⛳ Nassau<span>App</span></span>
        <div className="view-toggle">
          <button className={tab === 'card' ? 'active' : ''} onClick={() => setTab('card')}>Cartão</button>
          <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>Resumo</button>
        </div>
      </header>

      {tab === 'card' ? (
        <div className="screen-body">
          {/* Photo button */}
          <button className="photo-btn" onClick={() => setPhotoMode(true)}
            style={{ marginBottom: 10, fontSize: 14, fontWeight: 600 }}>
            📷  Foto do Cartão
          </button>

          {/* Hole nav */}
          <div className="hole-nav">
            {HOLES.map((h, i) => {
              const filled = players.every((_, pi) => scores[pi][i] !== null)
              return (
                <button key={h}
                  className={`hole-btn${activeHole === i ? ' active' : ''}${filled ? ' filled' : ''}`}
                  onClick={() => setActiveHole(i)}>{h}</button>
              )
            })}
          </div>

          {/* Hole input card */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <span style={{ fontFamily: 'var(--serif)', fontSize: 22, color: 'var(--gold)', fontWeight: 600 }}>
                  Buraco {activeHole + 1}
                </span>
                <span style={{ fontSize: 10, color: 'var(--muted2)', marginLeft: 8, letterSpacing: '0.5px' }}>
                  {activeHole < 9 ? 'Front 9' : 'Back 9'}
                </span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 13, color: 'var(--cream)', fontFamily: 'var(--serif)', fontWeight: 700 }}>
                  Par {par[activeHole]}
                </div>
                <div style={{ fontSize: 10, color: 'var(--muted)', letterSpacing: '0.5px' }}>
                  SI {si[activeHole]}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {players.map((p, pi) => {
                const strokes = getStrokesGlobal(p.handicap, lowestHcp, si, activeHole)
                const g       = scores[pi][activeHole]
                const isSet   = g !== null
                const net     = isSet ? g - strokes : null
                const holePar = par[activeHole]
                const diff    = isSet ? g - holePar : null
                const diffLabel = diff === null ? '' : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : String(diff)
                const diffCls   = diff === null ? '' : diff < 0 ? 'under' : diff === 0 ? 'even' : 'over'

                // Score color class
                const scoreColorCls = isSet
                  ? diff <= -2 ? 'eagle' : diff === -1 ? 'birdie'
                  : diff === 1 ? 'bogey' : diff >= 2 ? 'double' : ''
                  : ''
                return (
                  <div key={pi} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 12px', borderRadius: 10,
                    background: 'rgba(0,0,0,0.2)',
                    borderLeft: `2px solid ${teamA.includes(pi) ? '#4a7acc' : '#aa4444'}`,
                    marginBottom: 6,
                  }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--cream)', letterSpacing: '0.3px' }}>{p.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 2, letterSpacing: '0.3px' }}>
                        HCP {p.handicap}{strokes > 0 ? ` · +${strokes}` : ' · scratch'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <button className="adj-btn"
                        onClick={() => upd(pi, activeHole, isSet ? g - 1 : holePar - 1)}>−</button>
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                        {isSet ? (
                          <>
                            <input type="number" min="1" max="20"
                              className={`score-input-set ${scoreColorCls}`}
                              value={g}
                              onChange={e => upd(pi, activeHole, e.target.value === '' ? null : e.target.value)}
                            />
                            <span className={`pardiff ${diffCls}`}>{diffLabel}</span>
                          </>
                        ) : (
                          <div className="score-unset" onClick={() => upd(pi, activeHole, holePar)}>
                            <span className="unset-par">{holePar}</span>
                            <span className="unset-label">par</span>
                          </div>
                        )}
                      </div>
                      <button className="adj-btn"
                        onClick={() => upd(pi, activeHole, isSet ? g + 1 : holePar + 1)}>+</button>
                      {net !== null && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 36 }}>
                          <span style={{ fontSize: 11, color: 'var(--gold)', fontFamily: 'var(--serif)', fontWeight: 700 }}>
                            {net}
                          </span>
                          <span style={{ fontSize: 8, color: 'var(--muted)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>net</span>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button className="back-btn" style={{ flex: 1, opacity: activeHole === 0 ? 0.3 : 1 }}
                onClick={() => setActiveHole(h => Math.max(0, h - 1))} disabled={activeHole === 0}>
                ← Anterior
              </button>
              <button className="back-btn" style={{
                flex: 1,
                background: activeHole < 17 ? 'rgba(201,168,76,0.08)' : 'transparent',
                borderColor: activeHole < 17 ? 'var(--border-gold)' : 'rgba(255,255,255,0.1)',
                color: activeHole < 17 ? 'var(--gold)' : 'var(--muted)',
                opacity: activeHole === 17 ? 0.3 : 1
              }}
                onClick={() => setActiveHole(h => Math.min(17, h + 1))} disabled={activeHole === 17}>
                Próximo →
              </button>
            </div>
          </div>

          {/* Live scores */}
          <LiveScores format={format} pairs={pairs} players={players} indivResults={indivResults}
            indivMoney={indivMoney} teamResult={teamResult} teamMoney={teamMoney}
            skinsResult={skinsResult} stableResult={stableResult}
            tLA={tLA} tLB={tLB} betValues={betValues} betUnit={betUnit} scores={scores}/>
        </div>
      ) : (
        <div className="screen-body">
          {/* Full scorecard */}
          <FullScorecard players={players} scores={scores} si={si} par={par}
            lowestHcp={lowestHcp} teamA={teamA}/>

          {/* Format results */}
          {format === 'nassau' && (
            <>
              <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0 12px' }}/>
              <NassauResults pairs={pairs} players={players} indivResults={indivResults}
                indivMoney={indivMoney} teamResult={teamResult} teamMoney={teamMoney}
                tLA={tLA} tLB={tLB} betValues={betValues}/>
            </>
          )}
          {format === 'skins' && skinsResult && (
            <SkinsResults players={players} result={skinsResult} betUnit={betUnit}/>
          )}
          {format === 'stableford' && stableResult && (
            <StablefordResults players={players} result={stableResult} betUnit={betUnit}/>
          )}

          {/* Final money — números grandes */}
          <div className="card">
            <h2>Saldo Final</h2>
            <div className="saldo-grid">
              {players.map((p, pi) => (
                <div key={pi} className={`saldo-cell ${playerMoney[pi] > 0 ? 'win' : playerMoney[pi] < 0 ? 'lose' : 'tie'}`}>
                  <div className="saldo-name">{p.name}</div>
                  <div className={`saldo-val ${playerMoney[pi] > 0 ? 'pos' : playerMoney[pi] < 0 ? 'neg' : 'neu'}`}>
                    {playerMoney[pi] > 0 ? '+' : ''}R${Math.abs(playerMoney[pi])}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save */}
          {!saved ? (
            <button className="btn-green" onClick={saveRound} disabled={saving}
              style={{ marginBottom: 10 }}>
              {saving ? 'Salvando...' : '💾  Salvar rodada'}
            </button>
          ) : (
            <>
              <div style={{
                textAlign: 'center', padding: 13, color: 'var(--green)',
                fontWeight: 600, background: 'rgba(45,90,45,0.15)',
                borderRadius: 'var(--r)', border: '0.5px solid rgba(93,186,122,0.3)',
                marginBottom: 10, fontSize: 14, letterSpacing: '0.5px',
              }}>
                ✅  Rodada salva!
              </div>
              <button
                onClick={() => onFinish('presentation')}
                style={{
                  width: '100%', padding: 13,
                  background: 'rgba(201,168,76,0.07)',
                  border: '0.5px solid var(--border-gold)',
                  borderRadius: 'var(--r)', color: 'var(--gold)',
                  fontFamily: 'var(--sans)', fontSize: 14, fontWeight: 500,
                  cursor: 'pointer', letterSpacing: '0.5px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                📺  Modo Apresentação
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LiveScores({ format, pairs, players, indivResults, indivMoney, teamResult, teamMoney,
  skinsResult, stableResult, tLA, tLB, betValues, betUnit, scores }) {

  if (format === 'skins' && skinsResult) return (
    <div className="card">
      <h2>Skins</h2>
      {players.map((p, pi) => (
        <div key={pi} className="seg-row">
          <span>{p.name}</span>
          <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {skinsResult.skins[pi]} skin{skinsResult.skins[pi] !== 1 ? 's' : ''} · +R$ {skinsResult.money[pi]}
          </span>
        </div>
      ))}
      {skinsResult.carryover > 0 && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--muted)' }}>
          🏌 {skinsResult.carryover} skin(s) acumulado(s) no próximo buraco
        </div>
      )}
    </div>
  )

  if (format === 'stableford' && stableResult) return (
    <div className="card">
      <h2>Stableford</h2>
      {players.map((p, pi) => (
        <div key={pi} className="seg-row">
          <span>{p.name}</span>
          <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {stableResult.points[pi]} pts
          </span>
        </div>
      ))}
    </div>
  )

  // Nassau live
  return (
    <div>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 16, color: 'var(--gold)', marginBottom: 10, fontWeight: 600, letterSpacing: '0.5px' }}>Placar Corrido</div>
      {indivResults.map((res, mi) => {
        const [a, b] = pairs[mi]
        const m = indivMoney[mi]
        return (
          <div key={mi} className="card" style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>
              ⚔ {players[a].name} vs {players[b].name}
            </div>
            {res.frontPlayed > 0 && <NassauSegRow seg={res.front} money={m.front} label={`Front (${res.frontPlayed}/9)`} nA={players[a].name} nB={players[b].name} unit={betValues.frontVal}/>}
            {res.backPlayed > 0  && <NassauSegRow seg={res.back}  money={m.back}  label={`Back (${res.backPlayed}/9)`}  nA={players[a].name} nB={players[b].name} unit={betValues.backVal}/>}
            {(res.frontPlayed + res.backPlayed) > 0 && (
              <div className="seg-row" style={{ paddingTop: 6 }}>
                <div><span className="seg-label">Total 18</span>
                  <span className="seg-info" style={{ color: res.total18 > 0 ? '#7ab5f0' : res.total18 < 0 ? '#f07a7a' : 'var(--muted)' }}>
                    {res.total18 === 0 ? 'AS' : `${res.total18 > 0 ? players[a].name : players[b].name} ${res.total18 > 0 ? '+' : ''}${res.total18}`}
                  </span>
                </div>
                <MoneyTag val={Math.sign(res.total18) * betValues.totalVal}/>
              </div>
            )}
            {(res.frontPlayed + res.backPlayed) > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 12, fontWeight: 700, color: 'var(--cream)' }}>
                <span>Saldo</span>
                <MoneyTag val={m.grand} nameA={players[a].name} nameB={players[b].name}/>
              </div>
            )}
          </div>
        )
      })}

      {teamResult && teamMoney && (
        <div className="card" style={{ borderColor: 'rgba(201,168,76,0.25)' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 8 }}>
            🏌 {tLA} vs {tLB}
          </div>
          {teamResult.frontPlayed > 0 && <NassauSegRow seg={teamResult.front} money={teamMoney.front} label={`Front (${teamResult.frontPlayed}/9)`} nA={tLA} nB={tLB} unit={betValues.frontVal}/>}
          {teamResult.backPlayed > 0  && <NassauSegRow seg={teamResult.back}  money={teamMoney.back}  label={`Back (${teamResult.backPlayed}/9)`}  nA={tLA} nB={tLB} unit={betValues.backVal}/>}
          {(teamResult.frontPlayed + teamResult.backPlayed) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,0.08)', fontSize: 12, fontWeight: 700, color: 'var(--cream)' }}>
              <span>Saldo</span>
              <MoneyTag val={teamMoney.grand}/>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function NassauSegRow({ seg, money, label, nA, nB, unit }) {
  const w = seg.mainScore > 0 ? nA : seg.mainScore < 0 ? nB : 'AS'
  return (
    <div className="seg-row">
      <div style={{ flex: 1 }}>
        <span className="seg-label">{label}</span>
        <span className="seg-info" style={{ color: seg.mainScore > 0 ? '#7ab5f0' : seg.mainScore < 0 ? '#f07a7a' : 'var(--muted)' }}>
          {seg.mainScore === 0 ? 'AS' : `${w} ${seg.mainScore > 0 ? '+' : ''}${seg.mainScore}`}
          {seg.pressScores.map((ps, i) => (
            <span key={i} style={{ marginLeft: 4, fontSize: 10, opacity: 0.8 }}>
              P{i+1}:{ps > 0 ? '+' : ''}{ps}
            </span>
          ))}
        </span>
      </div>
      <MoneyTag val={money.total}/>
    </div>
  )
}

function MoneyTag({ val }) {
  if (val === undefined || val === null) return null
  return (
    <span className={`money-tag ${val > 0 ? 'pos' : val < 0 ? 'neg' : 'neu'}`}>
      {val > 0 ? '+' : ''}R$ {val}
    </span>
  )
}

function FullScorecard({ players, scores, si, par, lowestHcp, teamA }) {
  const parF9  = par.slice(0,9).reduce((a,b)=>a+b,0)
  const parB9  = par.slice(9).reduce((a,b)=>a+b,0)
  const parTot = parF9 + parB9

  return (
    <div className="card" style={{ padding: '14px 8px' }}>
      <div style={{ fontFamily: 'var(--serif)', fontSize: 18, color: 'var(--gold)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 10, paddingLeft: 8 }}>
        Scorecard
        <span style={{ fontFamily: 'var(--sans)', fontSize: 10, color: 'var(--muted2)', fontWeight: 400, marginLeft: 10, letterSpacing: '1px' }}>
          🟢 birdie · 🟡 eagle · 🟠 bogey · 🔴 double
        </span>
      </div>
      <div className="sc-wrap">
        <table className="sct">
          <thead>
            <tr>
              <th>Jogador</th>
              {HOLES.map(h => <th key={h} className={h > 9 ? 'bk' : ''}>{h}</th>)}
              <th className="tot-h">F9</th>
              <th className="tot-h">B9</th>
              <th className="tot-h">Gross</th>
              <th className="tot-h">Net</th>
            </tr>
            <tr>
              <th className="par-r">Par</th>
              {par.map((p, i) => <th key={i} className={`par-r ${i >= 9 ? 'bk' : ''}`}>{p}</th>)}
              <th className="par-r">{parF9}</th>
              <th className="par-r">{parB9}</th>
              <th className="par-r">{parTot}</th>
              <th className="si-r">–</th>
            </tr>
            <tr>
              <th className="si-r">SI</th>
              {si.map((s, i) => <th key={i} className={`si-r ${i >= 9 ? 'bk' : ''}`}>{s}</th>)}
              <th className="si-r">–</th>
              <th className="si-r">–</th>
              <th className="si-r">–</th>
              <th className="si-r">–</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, pi) => {
              let f9Gross=0, b9Gross=0
              let f9Count=0, b9Count=0
              HOLES.forEach((_, i) => {
                const g = scores[pi][i]
                if (g !== null) {
                  if (i < 9)  { f9Gross += g; f9Count++ }
                  else        { b9Gross += g; b9Count++ }
                }
              })
              const totalGross = f9Gross + b9Gross
              // Net medal = total gross - course handicap (not per-hole stroke distribution)
              const totalNet   = (f9Count + b9Count) > 0 ? totalGross - p.handicap : 0
              const f9Net      = f9Count > 0 ? f9Gross - Math.round(p.handicap * f9Count / (f9Count + b9Count)) : 0
              const b9Net      = b9Count > 0 ? b9Gross - Math.round(p.handicap * b9Count / (f9Count + b9Count)) : 0
              return (
                <tr key={pi}>
                  <td className="pnc" style={{
                    color: teamA.includes(pi) ? '#6aaaee' : '#ee6666',
                    fontSize: 11, fontWeight: 700,
                  }}>
                    {p.name}
                    <br/>
                    <small style={{ color: 'var(--muted2)', fontWeight: 400, fontSize: 9 }}>HCP {p.handicap}</small>
                  </td>
                  {HOLES.map((h, i) => {
                    const g = scores[pi][i]
                    const st = getStrokesPair(0, p.handicap, si, i)
                    const net = g !== null ? g - st : null
                    const diffPar = g !== null ? g - par[i] : null
                    const scoreColor = diffPar === null ? '' :
                      diffPar <= -2 ? '#ffd700' :
                      diffPar === -1 ? 'var(--green)' :
                      diffPar === 0  ? 'var(--cream)' :
                      diffPar === 1  ? '#e8a070' : 'var(--red)'
                    return (
                      <td key={h} className={h > 9 ? 'bk' : ''}>
                        {g !== null ? <>
                          <span className="gc" style={{ color: scoreColor }}>{g}</span>
                          <span className="nc">{net}</span>
                        </> : <span style={{ color: 'var(--muted)', fontSize: 10 }}>–</span>}
                      </td>
                    )
                  })}
                  <td className="tot-c">
                    <span className="gc">{f9Count ? f9Gross : '–'}</span>
                    <span className="nc">{f9Count ? f9Net : ''}</span>
                  </td>
                  <td className="tot-c">
                    <span className="gc">{b9Count ? b9Gross : '–'}</span>
                    <span className="nc">{b9Count ? b9Net : ''}</span>
                  </td>
                  <td className="tot-c">
                    <span className="gc">{(f9Count+b9Count) ? totalGross : '–'}</span>
                  </td>
                  <td className="tot-c">
                    <span className="gc" style={{ color: 'var(--green2)' }}>{(f9Count+b9Count) ? totalNet : '–'}</span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── PhotoConfirm — editable confirmation after card reading ───────────────────
function PhotoConfirm({ players, photoResult, par, onConfirm, onRetry }) {
  const [editScores, setEditScores] = useState(
    () => (photoResult.scores || []).map(row =>
      Array.from({ length: 18 }, (_, i) => row[i] ?? null)
    )
  )

  const updScore = (pi, hi, val) => {
    setEditScores(prev => {
      const next = prev.map(r => [...r])
      next[pi][hi] = val === '' ? null : Number(val)
      return next
    })
  }

  const confLbl = photoResult.confidence === 'high' ? '🟢 Alta' :
                  photoResult.confidence === 'medium' ? '🟡 Média' : '🔴 Baixa'

  return (
    <>
      {photoResult.card_complete === false && (
        <div style={{
          background: 'rgba(224,85,85,0.15)', border: '1px solid var(--red)',
          borderRadius: 'var(--r)', padding: '10px 14px', marginBottom: 10,
          fontSize: 13, color: 'var(--red)',
        }}>
          ⚠️ <strong>Cartão possivelmente incompleto</strong>
          {photoResult.missing_holes && <div style={{marginTop:4, fontSize:12}}>{photoResult.missing_holes}</div>}
          <div style={{marginTop:4, fontSize:12, color:'var(--muted)'}}>
            Tire uma nova foto garantindo que todos os buracos estejam visíveis, ou corrija manualmente abaixo.
          </div>
        </div>
      )}
      <div className="card">
        <h2>Confirme e corrija os scores</h2>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          Confiança da leitura: <strong>{confLbl}</strong>
          {photoResult.notes && <><br/><em style={{fontSize:11}}>{photoResult.notes}</em></>}
        </p>
        <p style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 12 }}>
          Toque em qualquer número para corrigir. Campos em branco = buraco não jogado.
        </p>

        {players.map((p, pi) => (
          <div key={pi} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: pi % 2 === 0 ? '#7ab5f0' : '#f07a7a', marginBottom: 6 }}>
              {p.name} — HCP {p.handicap}
            </div>
            <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--muted)' }}>Front 9</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 3, marginBottom: 6 }}>
              {Array.from({length:9},(_,hi) => (
                <div key={hi} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:2 }}>
                  <div style={{fontSize:9,color:'var(--muted)'}}>B{hi+1}<br/>p{par[hi]}</div>
                  <input type="number" min="1" max="15"
                    value={editScores[pi]?.[hi] ?? ''}
                    onChange={e => updScore(pi, hi, e.target.value)}
                    placeholder="–"
                    style={{
                      width:'100%', height:32, textAlign:'center', fontSize:13, fontWeight:700,
                      background: editScores[pi]?.[hi] !== null ? 'rgba(201,168,76,0.1)' : 'rgba(0,0,0,0.3)',
                      border: `1px solid ${editScores[pi]?.[hi] !== null ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius:5, color:'var(--cream)', fontFamily:"'DM Sans',sans-serif",
                    }}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginBottom: 4, fontSize: 10, color: 'var(--muted)' }}>Back 9</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9,1fr)', gap: 3 }}>
              {Array.from({length:9},(_,hi) => (
                <div key={hi} style={{ display:'flex',flexDirection:'column',alignItems:'center',gap:2 }}>
                  <div style={{fontSize:9,color:'var(--muted)'}}>B{hi+10}<br/>p{par[hi+9]}</div>
                  <input type="number" min="1" max="15"
                    value={editScores[pi]?.[hi+9] ?? ''}
                    onChange={e => updScore(pi, hi+9, e.target.value)}
                    placeholder="–"
                    style={{
                      width:'100%', height:32, textAlign:'center', fontSize:13, fontWeight:700,
                      background: editScores[pi]?.[hi+9] !== null ? 'rgba(201,168,76,0.1)' : 'rgba(0,0,0,0.3)',
                      border: `1px solid ${editScores[pi]?.[hi+9] !== null ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}`,
                      borderRadius:5, color:'var(--cream)', fontFamily:"'DM Sans',sans-serif",
                    }}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <button className="btn-primary" onClick={() => onConfirm(editScores)} style={{ marginBottom: 10 }}>
        ✓ Confirmar scores
      </button>
      <button className="btn-secondary" onClick={onRetry}>
        Tentar nova foto
      </button>
    </>
  )
}

function NassauResults({ pairs, players, indivResults, indivMoney, teamResult, teamMoney, tLA, tLB, betValues }) {
  return (
    <div className="card">
      <h2>Resultados Nassau</h2>
      {indivResults.map((res, mi) => {
        const [a, b] = pairs[mi]
        const m = indivMoney[mi]
        return (
          <div key={mi} style={{ marginBottom: 14, paddingBottom: 14, borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--gold)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '2px', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span>{players[a].name}</span>
              <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 10 }}>vs</span>
              <span>{players[b].name}</span>
            </div>
            <ResultDetailRow label="Front 9" seg={res.front} money={m.front} nA={players[a].name} nB={players[b].name} unit={betValues.frontVal}/>
            <ResultDetailRow label="Back 9"  seg={res.back}  money={m.back}  nA={players[a].name} nB={players[b].name} unit={betValues.backVal}/>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTop: '0.5px solid var(--border)', fontWeight: 700 }}>
              <span style={{ fontSize: 13, color: 'var(--cream)', letterSpacing: '0.3px' }}>Saldo</span>
              <span className={m.grand > 0 ? 'pos' : m.grand < 0 ? 'neg' : 'neu'}
                style={{ fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 700 }}>
                {m.grand === 0 ? 'Empatado' : `${m.grand > 0 ? players[a].name : players[b].name} +R$${Math.abs(m.grand)}`}
              </span>
            </div>
          </div>
        )
      })}

      {teamResult && teamMoney && (
        <div>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--gold)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Dupla: {tLA} vs {tLB}
          </div>
          <ResultDetailRow label="Front 9" seg={teamResult.front} money={teamMoney.front} nA={tLA} nB={tLB} unit={betValues.frontVal}/>
          <ResultDetailRow label="Back 9"  seg={teamResult.back}  money={teamMoney.back}  nA={tLA} nB={tLB} unit={betValues.backVal}/>
          <div className="seg-row" style={{ fontWeight: 700, color: 'var(--cream)' }}>
            <span>Saldo</span>
            <span className={teamMoney.grand > 0 ? 'pos' : teamMoney.grand < 0 ? 'neg' : 'neu'}>
              {teamMoney.grand === 0 ? 'Empatado' : `${teamMoney.grand > 0 ? tLA : tLB} +R$ ${Math.abs(teamMoney.grand)}`}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultDetailRow({ label, seg, money, nA, nB, unit }) {
  const w = seg.mainScore > 0 ? nA : seg.mainScore < 0 ? nB : null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--muted2)', marginBottom: 4, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--cream)', paddingLeft: 8, marginBottom: 2 }}>
        <span>Principal: <strong>{seg.mainScore === 0 ? 'AS' : `${w} ${seg.mainScore > 0 ? '+' : ''}${seg.mainScore}`}</strong></span>
        <span className={money.main > 0 ? 'pos' : money.main < 0 ? 'neg' : 'neu'} style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 700 }}>{money.main > 0 ? '+' : ''}R${Math.abs(money.main)}</span>
      </div>
      {seg.pressScores.map((ps, i) => {
        const pw = ps > 0 ? nA : ps < 0 ? nB : null
        const pMoney = Math.sign(ps) * unit
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted2)', paddingLeft: 8, marginBottom: 2 }}>
            <span>Press {i+1}: <strong style={{ color: ps !== 0 ? 'var(--cream)' : 'var(--muted2)' }}>{ps === 0 ? 'AS' : `${pw} ${ps > 0 ? '+' : ''}${ps}`}</strong></span>
            <span className={pMoney > 0 ? 'pos' : pMoney < 0 ? 'neg' : 'neu'} style={{ fontFamily: 'var(--serif)', fontWeight: 700 }}>{pMoney > 0 ? '+' : ''}R${Math.abs(pMoney)}</span>
          </div>
        )
      })}
    </div>
  )
}

function SkinsResults({ players, result, betUnit }) {
  return (
    <div className="card">
      <h2>Resultado Skins</h2>
      {players.map((p, pi) => (
        <div key={pi} className="seg-row">
          <div>
            <div style={{ fontWeight: 600, color: 'var(--cream)' }}>{p.name}</div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{result.skins[pi]} skin{result.skins[pi] !== 1 ? 's' : ''} × R${betUnit}</div>
          </div>
          <span className={result.money[pi] > 0 ? 'pos' : 'neu'} style={{ fontWeight: 700, fontSize: 16 }}>
            +R$ {result.money[pi]}
          </span>
        </div>
      ))}
      {result.carryover > 0 && (
        <div style={{ marginTop: 8, padding: 8, background: 'rgba(201,168,76,0.1)', borderRadius: 8, fontSize: 12, color: 'var(--gold)' }}>
          ⚡ {result.carryover} skin(s) não distribuídos (último(s) buraco(s) empatado(s))
        </div>
      )}
    </div>
  )
}

function StablefordResults({ players, result, betUnit }) {
  const sorted = [...players.map((p, i) => ({ ...p, pts: result.points[i], i }))]
    .sort((a, b) => b.pts - a.pts)
  return (
    <div className="card">
      <h2>Resultado Stableford</h2>
      {sorted.map((p, rank) => (
        <div key={p.i} className="seg-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{rank === 0 ? '🏆' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank+1}º`}</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--cream)' }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.pts} pontos</div>
            </div>
          </div>
          <span className={result.winners.includes(p.i) ? 'pos' : 'neg'} style={{ fontWeight: 700, fontSize: 14 }}>
            {result.winners.includes(p.i) ? `+R$ ${result.money[p.i]}` : '–'}
          </span>
        </div>
      ))}
    </div>
  )
}
