        import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  HOLES, FRONT, BACK,
  getStrokesGlobal, getStrokesCourse,
  calcIndiv, calcTeam, calcMoney, segMoney,
  calcSkins, calcStableford, calcMedal, calcSindicato, cmp,
} from '../lib/golf'
import { resizeImageToBase64 } from '../lib/image'
import PixSettlement from './PixSettlement'
import { saveDraft, clearDraft } from '../lib/draft'

// ── Photo capture via IA ───────────────────────────────────────────────────────
// A leitura por foto envolve mandar até 2 imagens pra um modelo de visão e
// esperar uma resposta com raciocínio (pode levar 15-30s+ numa foto grande).
// Isso estoura fácil o tempo limite de uma função serverless comum, e quando
// isso acontece a Vercel mata a função ANTES do try/catch do backend rodar -
// ou seja, o front recebe um erro de rede genérico, sem nenhuma pista do que
// houve. Por isso: (1) a imagem é redimensionada antes de enviar (ver
// lib/image.js) pra reduzir muito o tamanho e o tempo de processamento, e
// (2) aqui embaixo a gente dá um tempo limite explícito e guarda o motivo
// real da falha (em vez de só "não deu"), pra conseguir diagnosticar se
// acontecer de novo.
async function readCardWithVision(imageBase64, players, si, par, handwritingBase64) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 55000)
  try {
    // O servidor só faz a leitura pra quem está logado — manda o token da sessão
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sua sessão expirou. Saia e entre de novo para usar a leitura por foto.')
    const response = await fetch('/api/read-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ imageBase64, players, si, par, handwritingBase64 }),
      signal: controller.signal,
    })
    if (!response.ok) {
      const bodyText = await response.text().catch(() => '')
      throw new Error(`Erro na leitura (HTTP ${response.status}): ${bodyText.slice(0, 300)}`)
    }
    return await response.json()
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('A leitura demorou demais e foi cancelada (mais de 55s) - tente uma foto mais simples/bem iluminada, ou tente de novo.')
    }
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}


// ── Main Component ────────────────────────────────────────────────────────────
// readOnly: rodada já salva, aberta pelo Histórico — mostra só o Resumo, sem
// editar nem salvar. storedMoney: o saldo gravado na época (é o que vale).
export default function ScorecardScreen({ config, onFinish, onBack, session, initialDraft, readOnly, storedMoney, viewMeta }) {
  const { format, players, si, par, betValues, betUnit, numPlayers, teamA, teamB, playWithin, course, playsIndividual, teamsEnabled, medalSide } = config
  // Retrocompatível: rodadas antigas (ou config sem o campo) tratam todo mundo como "joga individual"
  const indivEnabled = playsIndividual || players.map(() => true)
  // Retrocompatível: configs antigas não tinham esse campo — nesse caso a
  // dupla sempre valia, então o default é "ligado" pra não mudar o
  // comportamento de rodadas já em andamento.
  const teamsOn = teamsEnabled !== false

  // Retomando uma rodada em andamento: começa dos scores guardados no aparelho
  const [scores, setScores]     = useState(() =>
    initialDraft?.scores?.length === players.length
      ? initialDraft.scores.map(row => Array.from({ length: 18 }, (_, i) => row[i] ?? null))
      : players.map(() => Array(18).fill(null)))
  const [activeHole, setActiveHole] = useState(() => initialDraft?.activeHole ?? 0)
  const [tab, setTab]           = useState(readOnly ? 'results' : 'card') // card | results

  // Salva a rodada em andamento no aparelho a cada score lançado (e ao trocar
  // de buraco), pra não perder nada se o celular fechar o app.
  const savedRef = useRef(!!readOnly) // visualização: nunca grava rascunho
  useEffect(() => {
    if (savedRef.current) return
    saveDraft(session?.user?.id, { config, scores, activeHole, startedAt: initialDraft?.startedAt || config.startedAt })
  }, [scores, activeHole])
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [saveError, setSaveError] = useState('')
  const [quickEntry, setQuickEntry] = useState(false) // grid completo em vez de buraco a buraco

  // Photo states
  const [photoMode, setPhotoMode]   = useState(false)
  const [photoImg, setPhotoImg]     = useState(null)
  const [photoB64, setPhotoB64]     = useState(null)
  const [processing, setProcessing] = useState(false)
  const [photoResult, setPhotoResult] = useState(null)
  const [photoError, setPhotoError] = useState('')
  const fileRef = useRef()
  const [handwritingB64, setHandwritingB64] = useState(null)

  // Carrega a amostra de caligrafia cadastrada no Perfil (se houver), para
  // ajudar a IA a calibrar a leitura dos números deste cartão
  useEffect(() => {
    if (!session?.user?.id) return
    supabase.from('handwriting_samples').select('image_base64').eq('user_id', session.user.id).maybeSingle()
      .then(({ data }) => { if (data?.image_base64) setHandwritingB64(data.image_base64) })
  }, [session?.user?.id])

  const lowestHcp = Math.min(...players.map(p => p.handicap))

  const upd = (pi, i, v) => setScores(prev => {
    const n = prev.map(r => [...r])
    n[pi][i] = v === '' ? null : Number(v)
    return n
  })

  // Match Play e Catraca reaproveitam a mesma engine do Nassau (calcIndiv/
  // calcTeam) — só muda o pressAt: Infinity no Match Play (nenhum press
  // nasce, dando o "Nassau sem press"), 1 no Catraca individual (press a
  // cada buraco de diferença, em vez de 2). Em dupla o Catraca mantém o
  // intervalo normal do Nassau (4) — só o individual fica mais agressivo.
  const isNassauLike = format === 'nassau' || format === 'matchplay' || format === 'catraca'
  const pressAtIndiv = format === 'matchplay' ? Infinity : format === 'catraca' ? 1 : 2
  const pressAtTeam  = format === 'matchplay' ? Infinity : 4
  // Catraca: a primeira aposta (antes de qualquer press) de Front9/Back9 vale
  // o dobro do valor digitado — cada press que nasce depois vale 1x normal.
  const mainMultiplier = format === 'catraca' ? 2 : 1

  // ── Pairs ──
  // Duplas (teamA/teamB) só existem de verdade no Nassau/Match Play com 4
  // jogadores. Com 2 ou 3 jogadores não há dupla — todos jogam individual
  // contra todos — então o filtro de "mesma dupla" não pode ser aplicado,
  // senão o confronto entre os jogadores 0 e 1 (dupla padrão) é descartado
  // por engano.
  const teamsApply = isNassauLike && numPlayers === 4 && teamsOn
  const pairs = useMemo(() => {
    const p = []
    for (let a = 0; a < numPlayers; a++)
      for (let b = a + 1; b < numPlayers; b++) {
        if (indivEnabled[a] === false || indivEnabled[b] === false) continue
        const sameTeam = teamsApply && ((teamA.includes(a) && teamA.includes(b)) || (teamB.includes(a) && teamB.includes(b)))
        if (!playWithin && sameTeam) continue
        p.push([a, b])
      }
    return p
  }, [numPlayers, teamA, teamB, playWithin, teamsApply, indivEnabled])

  // ── Nassau / Match Play calculations ──
  const indivResults = useMemo(() =>
    isNassauLike ? pairs.map(([a, b]) =>
      calcIndiv(scores[a], scores[b], players[a].handicap, players[b].handicap, si, pressAtIndiv)
    ) : []
  , [scores, pairs, players, si, isNassauLike, pressAtIndiv])

  const indivMoney = useMemo(() =>
    indivResults.map(r => calcMoney(r, betValues, mainMultiplier))
  , [indivResults, betValues, mainMultiplier])

  // Dupla só entra na conta quando o toggle "Jogar em duplas" estava ligado
  // no setup. Desligado, os 4 jogadores disputam só os confrontos
  // individuais acima (todos contra todos) — sem aposta de dupla A vs B.
  const teamResult = useMemo(() =>
    isNassauLike && numPlayers === 4 && teamsOn
      ? calcTeam(scores, players, teamA, teamB, si, pressAtTeam)
      : null
  , [scores, players, teamA, teamB, si, numPlayers, isNassauLike, pressAtTeam, teamsOn])

  const teamMoney = useMemo(() =>
    teamResult ? calcMoney(teamResult, betValues, mainMultiplier) : null
  , [teamResult, betValues, mainMultiplier])

  // ── Skins ──
  const skinsResult = useMemo(() =>
    format === 'skins' ? calcSkins(scores, players, si, betUnit) : null
  , [scores, players, si, betUnit, format])

  // ── Stableford ──
  const stableResult = useMemo(() =>
    format === 'stableford' ? calcStableford(scores, players, si, par, betUnit) : null
  , [scores, players, si, par, betUnit, format])

  // ── Medal ──
  const medalResult = useMemo(() =>
    format === 'medal' ? calcMedal(scores, players, si, betValues) : null
  , [scores, players, si, betValues, format])

  // ── Sindicato (Six / Twelves) ──
  const sindResult = useMemo(() =>
    format === 'sindicato' && (players.length === 3 || players.length === 4)
      ? calcSindicato(scores, players, si, betValues?.potValue || 0, betValues?.payoutPct)
      : null
  , [scores, players, si, betValues, format])

  // ── Medal adicional (aposta extra em paralelo ao formato principal) ──
  const medalSideResult = useMemo(() =>
    medalSide && format !== 'medal' ? calcMedal(scores, players, si, medalSide) : null
  , [scores, players, si, medalSide, format])

  // ── Money per player ──
  // mainMoney = só o formato principal; playerMoney = principal + Medal extra.
  const mainMoney = useMemo(() => {
    const m = players.map(() => 0)
    if (isNassauLike) {
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
    } else if (format === 'medal' && medalResult) {
      medalResult.money.forEach((v, i) => { m[i] = v })
    } else if (format === 'sindicato' && sindResult) {
      // Pote ÷ 3 pode dar dízima — arredonda pra centavos.
      sindResult.money.forEach((v, i) => { m[i] = Math.round(v * 100) / 100 })
    }
    return m
  }, [indivMoney, teamMoney, skinsResult, stableResult, medalResult, sindResult, format, isNassauLike, pairs, teamA, teamB, players])

  const playerMoney = useMemo(() =>
    medalSideResult
      ? mainMoney.map((v, i) => Math.round((v + medalSideResult.money[i]) * 100) / 100)
      : mainMoney
  , [mainMoney, medalSideResult])

  // Na visualização de rodada salva, o saldo exibido é o gravado na época
  const shownMoney = readOnly && Array.isArray(storedMoney) ? storedMoney : playerMoney

  const mainFormatLabel = {
    nassau: 'Nassau', matchplay: 'Match Play', catraca: 'Catraca', medal: 'Medal',
    skins: 'Skins', stableford: 'Stableford', sindicato: 'Sindicato',
  }[format] || format

  // ── Photo handling ──
  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPhotoError('')
    try {
      // Redimensiona antes de guardar - fotos de celular vêm enormes (às
      // vezes 8-12MB) e isso sozinho já derruba boa parte das leituras por
      // estourar o tempo/tamanho aceito pela função de leitura.
      const { dataUrl, base64 } = await resizeImageToBase64(file, 1800, 0.85)
      setPhotoImg(dataUrl)
      setPhotoB64(base64)
    } catch (err) {
      console.error('Erro ao processar a foto:', err)
      setPhotoError(`Não foi possível processar essa foto (${err.message || 'erro desconhecido'}). Tente outra.`)
    }
  }

  const processPhoto = async () => {
    if (!photoB64) return
    setProcessing(true); setPhotoError('')
    try {
      const result = await readCardWithVision(photoB64, players, si, par, handwritingB64)
      setPhotoResult(result)
    } catch (e) {
      // Loga o motivo real (visível no F12 > Console) em vez de só engolir o
      // erro - se voltar a falhar, dá pra saber se foi timeout, rede, ou algo
      // do lado do servidor, ao invés de um "não deu" sem pista nenhuma.
      console.error('Erro na leitura do cartão por foto:', e)
      // Mesmo assim mostra a tabela vazia editável pra preencher na mão
      setPhotoResult({
        scores: players.map(() => Array(18).fill(null)),
        confidence: 'low',
        notes: `Leitura automática não foi possível (${e.message || 'erro desconhecido'}). Preencha ou corrija os scores abaixo.`,
      })
    }
    setProcessing(false)
  }

  const applyPhotoScores = (editedScores) => {
    const src = editedScores || photoResult?.scores
    if (!src) return
    setScores(players.map((_, pi) => {
      const row = src[pi] || []
      return Array.from({ length: 18 }, (_, i) => {
        const v = row[i]
        return v === null || v === undefined ? null : Number(v)
      })
    }))
    setPhotoMode(false); setPhotoImg(null); setPhotoB64(null); setPhotoResult(null)
  }

 // ── Save round ──
  const saveRound = async () => {
    setSaving(true); setSaveError('')
    let uid = null
    try {
      // Busca o usuário direto do servidor (em vez de confiar no `session`
      // recebido por prop) para garantir que o user_id gravado é exatamente
      // o mesmo que o Postgres vai enxergar em auth.uid() ao checar a regra
      // de segurança — evita o erro "new row violates row-level security
      // policy" quando o estado local ficou dessincronizado da sessão real
      // (ex.: login feito em outra aba, sessão trocada em segundo plano).
      const { data: userData, error: userErr } = await supabase.auth.getUser()
      if (userErr || !userData?.user) {
        throw new Error('Sua sessão expirou. Saia e entre de novo antes de salvar a rodada.')
      }
      uid = userData.user.id

      // Gera o id da rodada aqui mesmo, em vez de pedir pro Postgres gerar
      // e devolver com `.select().single()`. O Postgres aplica a política
      // de LEITURA também sobre o retorno de um INSERT ... RETURNING — e é
      // exatamente essa checagem (não a de gravação) que estava disparando
      // o erro "new row violates row-level security policy", mesmo com a
      // política de inserção liberada. Gerando o id no cliente, não
      // precisamos mais pedir nada de volta: já sabemos o id de antemão.
      const roundId = crypto.randomUUID()

      const { error: rErr } = await supabase.from('rounds').insert({
        id:          roundId,
        user_id:     uid,
        format,
        course_name: course?.name || 'Campo',
        course_id:   course?.id || 'custom',
        played_at:   new Date().toISOString(),
        // snapshot: tudo o que é preciso pra remontar o Resumo depois, pelo Histórico
        bet_values:  {
          ...betValues,
          ...(medalSideResult ? { medalSide } : {}),
          snapshot: {
            v: 1, format, numPlayers, betUnit, si, par, course,
            players: players.map(p => ({ name: p.name, handicap: p.handicap, userId: p.userId || null })),
            teamA, teamB, playWithin: !!playWithin, teamsEnabled: teamsEnabled !== false,
            playsIndividual: playsIndividual || null,
          },
        },
        num_players: numPlayers,
        // Rodada da versão com amigos: quem vê é decidido pelo vínculo das
        // contas (player_user_id), não mais pelo primeiro nome.
        linked_rules: true,
      })
      if (rErr) throw rErr

      const playerRows = players.map((p, pi) => ({
        round_id:      roundId,
        user_id:       uid,
        player_name:   p.name,
        handicap:      p.handicap,
        gross_scores:  scores[pi],
        money_result:  playerMoney[pi],
        team:          teamA.includes(pi) ? 'A' : 'B',
        player_user_id: p.userId || null, // conta do jogador (você ou amigo ✓)
      }))
      // Sem checar o erro aqui, um insert que falhasse (RLS, coluna faltando,
      // valor inválido, etc.) passava batido: o código seguia como se tivesse
      // dado tudo certo, mostrava "salvo" e ia pra tela de apresentação - mas
      // a rodada ficava sem jogadores/scores no banco (ou nem aparecia no
      // Histórico depois). É exatamente o tipo de falha que parece "não
      // salvou nada" pro usuário sem nenhuma pista do motivo.
      const { error: prErr } = await supabase.from('round_players').insert(playerRows)
      if (prErr) {
        // Desfaz o insert de "rounds" que já tinha entrado, senão sobra uma
        // rodada fantasma (sem jogadores) no Histórico a cada vez que isso falhar.
        await supabase.from('rounds').delete().eq('id', roundId)
        throw prErr
      }

      if (isNassauLike && indivMoney.length > 0) {
        const matchupRows = pairs.map(([a, b], mi) => {
          const m = indivMoney[mi]
          return {
            round_id: roundId,
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
            round_id: roundId,
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
        const { error: mErr } = await supabase.from('round_matchups').insert(matchupRows)
        // Diferente de round_players, aqui NÃO desfazemos a rodada: os
        // scores e o dinheiro por jogador já estão salvos corretamente, só
        // o detalhamento por confronto (usado no H2H) que ficaria faltando.
        // Melhor a rodada ficar salva com um aviso do que sumir inteira.
        if (mErr) console.error('Erro ao salvar confrontos (round_matchups):', mErr.message)
      }

      setSaved(true)
      savedRef.current = true
      clearDraft(session?.user?.id) // rodada salva no banco — o rascunho local não é mais necessário
      // Avança direto para o Modo Apresentação — sem tela intermediária
      window._nassauPresentation = { players, playerMoney, course, tLA, tLB }
      onFinish('presentation')
      return
    } catch (e) {
      console.error('Save error:', e)
      let msg = e?.message || e?.error_description || 'Erro desconhecido ao salvar. Tente novamente.'
      // Diagnóstico temporário: compara o id que o app tentou gravar com o
      // que o servidor realmente enxerga como auth.uid() para esta mesma
      // sessão — se forem diferentes, achamos a causa da violação de RLS.
      // (depende da função public.whoami() existir no banco; se não existir
      // ainda, essa parte simplesmente é ignorada.)
      try {
        const { data: whoamiUid } = await supabase.rpc('whoami')
        msg += ` [debug: app=${uid} servidor=${whoamiUid ?? 'null'}]`
      } catch {}
      console.error('Save error uid check — app uid:', uid)
      setSaveError(msg)
    }
    setSaving(false)
  }
  // ── Team labels (component scope) ──
  // teamA/teamB só representam duplas reais no Nassau com 4 jogadores.
  // Com 2 ou 3 jogadores, teamB pode conter índices fora do array de
  // players (ex.: [2,3] com apenas 2 jogadores) — sem o filtro abaixo,
  // "players[i].name" quebra o app inteiro ao tentar ler um jogador
  // inexistente, e a tela nem chega a abrir.
  const tLA = teamA.filter(i => i < numPlayers).map(i => players[i].name).join('/')
  const tLB = teamB.filter(i => i < numPlayers).map(i => players[i].name).join('/')

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
              <input ref={fileRef} type="file" accept="image/*"
                style={{ display: 'none' }} onChange={handlePhotoSelect}/>
              {photoError && (
                // Esse erro existia no código (setPhotoError) mas nunca tinha um
                // lugar pra aparecer na tela - por isso, quando o processamento da
                // foto falhava (formato de imagem não suportado, foto corrompida,
                // etc.), o usuário só via "nada acontecer" ao selecionar a foto,
                // sem nenhuma pista do motivo.
                <p style={{ fontSize: 12, color: 'var(--red, #e05555)', marginTop: 10, lineHeight: 1.5 }}>
                  ⚠️ {photoError}
                </p>
              )}
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
        <span className="header-title">⛳ Caddie<span>Stakes</span></span>
        {readOnly ? (
          <span style={{ fontSize: 12, color: 'var(--muted2)', minWidth: 60, textAlign: 'right' }}>{viewMeta?.dateLabel || ''}</span>
        ) : (
        <div className="view-toggle">
          <button className={tab === 'card' ? 'active' : ''} onClick={() => setTab('card')}>Cartão</button>
          <button className={tab === 'results' ? 'active' : ''} onClick={() => setTab('results')}>Resumo</button>
        </div>
        )}
      </header>

      {tab === 'card' ? (
        <div className="screen-body">
          {/* Modo de lançamento */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <button className="photo-btn" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}
              onClick={() => setQuickEntry(q => !q)}>
              {quickEntry ? '🎯  Buraco a buraco' : '⌨️  Digitação rápida'}
            </button>
            <button className="photo-btn" style={{ flex: 1, fontSize: 13, fontWeight: 600 }}
              onClick={() => setPhotoMode(true)}>
              📷  Foto do Cartão
            </button>
          </div>

          {quickEntry ? (
            <QuickEntryGrid players={players} scores={scores} par={par} onUpdate={upd}/>
          ) : (
            <>
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
                    const strokes = getStrokesCourse(p.handicap, si, activeHole)
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
                            HCP {p.handicap}{strokes > 0 ? ` · +${strokes}` : strokes < 0 ? ` · −${-strokes}` : ' · scratch'}
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
            </>
          )}

          {/* Live scores */}
          <LiveScores format={format} pairs={pairs} players={players} indivResults={indivResults}
            indivMoney={indivMoney} teamResult={teamResult} teamMoney={teamMoney}
            skinsResult={skinsResult} stableResult={stableResult} medalResult={medalResult}
            sindResult={sindResult}
            tLA={tLA} tLB={tLB} betValues={betValues} betUnit={betUnit} scores={scores}/>
          {medalSideResult && (
            <MedalLive players={players} result={medalSideResult} title="🎖️ Medal (aposta extra)"/>
          )}

          {/* Atalho pra quem termina de lançar os scores e vai direto encerrar
              por aqui, sem pensar em trocar de aba manualmente pra salvar. */}
          <button className="btn-primary" onClick={() => setTab('results')}
            style={{ marginTop: 16 }}>
            📊  Ver Resumo e Salvar
          </button>
        </div>
      ) : (
        <div className="screen-body">
          {/* Full scorecard */}
          <FullScorecard players={players} scores={scores} si={si} par={par}
            lowestHcp={lowestHcp} teamA={teamA}/>

          {/* Format results */}
          {isNassauLike && (
            <>
              <div style={{ height: '0.5px', background: 'var(--border)', margin: '4px 0 12px' }}/>
              <NassauResults pairs={pairs} players={players} indivResults={indivResults}
                indivMoney={indivMoney} teamResult={teamResult} teamMoney={teamMoney}
                tLA={tLA} tLB={tLB} betValues={betValues}
                title={format === 'matchplay' ? 'Resultados Match Play' : format === 'catraca' ? 'Resultados Catraca' : 'Resultados Nassau'}/>
            </>
          )}
          {format === 'skins' && skinsResult && (
            <SkinsResults players={players} result={skinsResult} betUnit={betUnit}/>
          )}
          {format === 'stableford' && stableResult && (
            <StablefordResults players={players} result={stableResult} betUnit={betUnit}/>
          )}
          {format === 'medal' && medalResult && (
            <MedalResults players={players} result={medalResult} betValues={betValues}/>
          )}
          {format === 'sindicato' && sindResult && (
            <SindicatoResults players={players} result={sindResult} betValues={betValues} par={par}/>
          )}
          {medalSideResult && (
            <MedalResults players={players} result={medalSideResult} betValues={medalSide}
              title="Resultado Medal (aposta extra)"/>
          )}

          {/* Final money — números grandes */}
          <div className="card">
            <h2>Saldo Final</h2>
            <div className="saldo-grid">
              {players.map((p, pi) => (
                <div key={pi} className={`saldo-cell ${shownMoney[pi] > 0 ? 'win' : shownMoney[pi] < 0 ? 'lose' : 'tie'}`}>
                  <div className="saldo-name">{p.name}</div>
                  <div className={`saldo-val ${shownMoney[pi] > 0 ? 'pos' : shownMoney[pi] < 0 ? 'neg' : 'neu'}`}>
                    {shownMoney[pi] > 0 ? '+' : ''}R${fmtBRL(shownMoney[pi])}
                  </div>
                  {medalSideResult && (
                    <div style={{ fontSize: 10, color: 'var(--muted2)', marginTop: 4, lineHeight: 1.4 }}>
                      {mainFormatLabel} {mainMoney[pi] > 0 ? '+' : mainMoney[pi] < 0 ? '−' : ''}{fmtBRL(mainMoney[pi])}
                      {' · '}Medal {medalSideResult.money[pi] > 0 ? '+' : medalSideResult.money[pi] < 0 ? '−' : ''}{fmtBRL(Math.round(medalSideResult.money[pi] * 100) / 100)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Acerto via PIX — quem paga quem, com QR / copia e cola */}
          <PixSettlement
            players={players.map((p, pi) => ({ name: p.name, handicap: p.handicap, money: shownMoney[pi] }))}
            meIndex={readOnly ? (viewMeta?.meIndex ?? -1) : 0}
            description={`Golfe ${course?.name || ''} ${new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`}
          />

          {readOnly && viewMeta?.legacy && (
            <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.5, margin: '4px 0 14px' }}>
              Rodada anterior a esta tela: o detalhe acima foi remontado com as opções padrão do formato. O Saldo Final é o que foi salvo na época.
            </p>
          )}
          {/* Save — ao concluir, segue direto para o Modo Apresentação */}
          {!readOnly && <>
          <button className="btn-green" onClick={saveRound} disabled={saving || saved}
            style={{ marginBottom: saveError ? 6 : 10 }}>
            {saving || saved ? 'Salvando...' : '💾  Salvar rodada'}
          </button>
          {saveError && (
            <p style={{ color: 'var(--red, #c0524a)', fontSize: 12.5, textAlign: 'center', marginBottom: 10, lineHeight: 1.5 }}>
              Não foi possível salvar: {saveError}
            </p>
          )}
          </>}
        </div>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LiveScores({ format, pairs, players, indivResults, indivMoney, teamResult, teamMoney,
  skinsResult, stableResult, medalResult, sindResult, tLA, tLB, betValues, betUnit, scores }) {

  if (format === 'sindicato' && sindResult) {
    const holesPlayed = sindResult.holeResults.filter(Boolean).length
    const order = players.map((p, pi) => ({ name: p.name, pts: sindResult.points[pi], pi }))
      .sort((a, b) => b.pts - a.pts)
    return (
      <div className="card">
        <h2>Sindicato · {players.length === 3 ? 'Six' : 'Twelves'}</h2>
        {order.map((o, rank) => (
          <div key={o.pi} className="seg-row">
            <span>{rank + 1}º · {o.name}</span>
            <span style={{ color: 'var(--gold)', fontWeight: 700 }}>{fmtPts(o.pts)} pts</span>
          </div>
        ))}
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
          {holesPlayed}/18 buracos pontuados — o buraco só conta quando todos têm score lançado.
        </div>
      </div>
    )
  }

  if (format === 'medal' && medalResult) return (
    <MedalLive players={players} result={medalResult} title="Medal"/>
  )

  if (format === 'skins' && skinsResult) return (
    <div className="card">
      <h2>Skins</h2>
      {players.map((p, pi) => (
        <div key={pi} className="seg-row">
          <span>{p.name}</span>
          <span style={{ color: 'var(--gold)', fontWeight: 700 }}>
            {skinsResult.skins[pi]} skin{skinsResult.skins[pi] !== 1 ? 's' : ''} · {skinsResult.money[pi] > 0 ? '+' : skinsResult.money[pi] < 0 ? '−' : ''}R$ {Math.abs(skinsResult.money[pi])}
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
      {pairs.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          Nenhum confronto individual configurado nesta rodada.
        </p>
      )}
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
                    {res.total18 === 0 ? 'AS' : `${res.total18 > 0 ? players[a].name : players[b].name} +${Math.abs(res.total18)}`}
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
          {seg.mainScore === 0 ? 'AS' : `${w} +${Math.abs(seg.mainScore)}`}
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

  // "Total Net" = net contra o campo (gross − handicap cheio, pelo SI) — o
  // mesmo net do Medal. Handicap plus devolve tacadas (getStrokesCourse).
  const playerStats = players.map((p, pi) => {
    let f9G=0, b9G=0, f9N=0, b9N=0, f9C=0, b9C=0
    HOLES.forEach((_, i) => {
      const g = scores[pi][i]
      if (g !== null) {
        const st = getStrokesCourse(p.handicap, si, i)
        if (i < 9) { f9G+=g; f9N+=g-st; f9C++ } else { b9G+=g; b9N+=g-st; b9C++ }
      }
    })
    return { f9G, b9G, f9N, b9N, f9C, b9C, totG: f9G+b9G, totN: f9N+b9N }
  })

  const sc = (g, parH) => {
    if (g===null) return 'var(--muted2)'
    const d = g - parH
    return d<=-2?'#ffd700':d===-1?'var(--green)':d===0?'var(--cream)':d===1?'#e8a070':'var(--red)'
  }

  const HalfTable = ({ startH, label, parSum }) => {
    const holes = Array.from({length:9},(_,i)=>startH+i)
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--gold)', letterSpacing:'2px', textTransform:'uppercase', marginBottom:6, fontWeight:600 }}>
          {label} <span style={{ color:'var(--muted2)', fontWeight:400 }}>· Par {parSum}</span>
        </div>
        <div className="sc-wrap">
          <table style={{ width:'100%', borderCollapse:'collapse', fontSize:12 }}>
            <thead>
              <tr style={{ background:'rgba(0,0,0,0.4)' }}>
                <th style={{ textAlign:'left', padding:'5px 8px', color:'var(--muted2)', fontWeight:600, minWidth:64 }}>Jogador</th>
                {holes.map(h=><th key={h} style={{ padding:'5px 4px', textAlign:'center', color:'var(--muted2)', fontWeight:600, minWidth:26 }}>{h}</th>)}
                <th style={{ padding:'5px 6px', textAlign:'center', color:'var(--gold)', fontWeight:700, minWidth:34, background:'rgba(201,168,76,0.1)' }}>Tot</th>
                <th style={{ padding:'5px 6px', textAlign:'center', color:'var(--green)', fontWeight:700, minWidth:34, background:'rgba(93,186,122,0.08)' }}>Net</th>
              </tr>
              <tr style={{ background:'rgba(0,0,0,0.2)' }}>
                <th style={{ textAlign:'left', padding:'3px 8px', color:'var(--gold)', fontSize:10 }}>Par</th>
                {holes.map(h=><th key={h} style={{ textAlign:'center', padding:'3px 2px', color:'var(--gold)', fontSize:11 }}>{par[h-1]}</th>)}
                <th style={{ textAlign:'center', color:'var(--gold)', fontSize:11 }}>{parSum}</th>
                <th style={{ textAlign:'center', color:'var(--muted2)', fontSize:10 }}>–</th>
              </tr>
              <tr style={{ background:'rgba(0,0,0,0.1)' }}>
                <th style={{ textAlign:'left', padding:'3px 8px', color:'var(--muted)', fontSize:9 }}>SI</th>
                {holes.map(h=><th key={h} style={{ textAlign:'center', padding:'3px 2px', color:'var(--muted)', fontSize:9 }}>{si[h-1]}</th>)}
                <th style={{ textAlign:'center', color:'var(--muted)', fontSize:9 }}>–</th>
                <th style={{ textAlign:'center', color:'var(--muted)', fontSize:9 }}>–</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p,pi)=>{
                const st = playerStats[pi]
                const isF9 = startH===1
                const gross = isF9?st.f9G:st.b9G
                const net   = isF9?st.f9N:st.b9N
                const count = isF9?st.f9C:st.b9C
                return (
                  <tr key={pi} style={{ background: pi%2===0?'rgba(0,0,0,0.15)':'rgba(0,0,0,0.05)', borderBottom:'0.5px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding:'6px 8px', fontWeight:700, fontSize:12, color: teamA.includes(pi)?'#6aaaee':'#ee6666' }}>
                      {p.name} <span style={{ color:'var(--muted2)', fontWeight:400, fontSize:10 }}>·{p.handicap}</span>
                    </td>
                    {holes.map(h=>{
                      const i=h-1, g=scores[pi][i]
                      const net2 = g!==null ? g - getStrokesCourse(p.handicap, si, i) : null
                      return (
                        <td key={h} style={{ textAlign:'center', padding:'5px 2px' }}>
                          {g!==null?(
                            <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:1 }}>
                              <span style={{ fontSize:14, fontWeight:700, color:sc(g,par[i]), fontFamily:'var(--serif)' }}>{g}</span>
                              <span style={{ fontSize:8, color:'var(--gold)', opacity:0.7 }}>{net2}</span>
                            </div>
                          ):<span style={{ color:'var(--muted)', fontSize:11 }}>–</span>}
                        </td>
                      )
                    })}
                    <td style={{ textAlign:'center', padding:'5px 4px', background:'rgba(201,168,76,0.05)' }}>
                      <span style={{ fontFamily:'var(--serif)', fontSize:15, fontWeight:700, color:'var(--cream)' }}>{count?gross:'–'}</span>
                    </td>
                    <td style={{ textAlign:'center', padding:'5px 4px', background:'rgba(93,186,122,0.05)' }}>
                      <span style={{ fontFamily:'var(--serif)', fontSize:15, fontWeight:700, color:'var(--green)' }}>{count?net:'–'}</span>
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

  return (
    <div className="card">
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ fontFamily:'var(--serif)', fontSize:18, color:'var(--gold)', fontWeight:600 }}>Scorecard</div>
        <div style={{ fontSize:10, color:'var(--muted2)', display:'flex', gap:6 }}>
          <span><span style={{color:'var(--green)'}}>●</span> birdie</span>
          <span><span style={{color:'#ffd700'}}>●</span> eagle</span>
          <span><span style={{color:'#e8a070'}}>●</span> bogey</span>
          <span><span style={{color:'var(--red)'}}>●</span> double</span>
        </div>
      </div>

      <HalfTable startH={1}  label="Front 9" parSum={parF9}/>
      <HalfTable startH={10} label="Back 9"  parSum={parB9}/>

      {/* Totais — Front 9 / Back 9 / Total 18 juntos, sem precisar rolar a tela */}
      <div style={{ borderTop:'0.5px solid var(--border)', paddingTop:12 }}>
        <div style={{ fontSize:10, color:'var(--gold)', letterSpacing:'2px', textTransform:'uppercase', marginBottom:8, fontWeight:600 }}>Totais</div>
        <div style={{ display:'grid', gridTemplateColumns:`repeat(${players.length},1fr)`, gap:6 }}>
          {players.map((p,pi)=>{
            const st=playerStats[pi], played=st.f9C+st.b9C
            return (
              <div key={pi} style={{ textAlign:'center', padding:'10px 4px', background:'rgba(0,0,0,0.2)', borderRadius:10,
                border:`0.5px solid ${teamA.includes(pi)?'rgba(106,170,238,0.2)':'rgba(238,102,102,0.2)'}` }}>
                <div style={{ fontSize:11, fontWeight:700, color:teamA.includes(pi)?'#6aaaee':'#ee6666', marginBottom:6, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.name}</div>

                {/* Front 9 / Back 9 — lado a lado, discreto */}
                <div style={{ display:'flex', justifyContent:'center', gap:8, marginBottom:8 }}>
                  <div>
                    <div style={{ fontFamily:'var(--serif)', fontSize:16, fontWeight:700, color:'var(--cream)', lineHeight:1 }}>{st.f9C?st.f9G:'–'}</div>
                    <div style={{ fontSize:8, color:'var(--muted2)', letterSpacing:'0.5px', textTransform:'uppercase' }}>F9</div>
                  </div>
                  <div style={{ width:'0.5px', background:'var(--border)' }}/>
                  <div>
                    <div style={{ fontFamily:'var(--serif)', fontSize:16, fontWeight:700, color:'var(--cream)', lineHeight:1 }}>{st.b9C?st.b9G:'–'}</div>
                    <div style={{ fontSize:8, color:'var(--muted2)', letterSpacing:'0.5px', textTransform:'uppercase' }}>B9</div>
                  </div>
                </div>

                {/* Total 18 — número principal */}
                <div style={{ fontFamily:'var(--serif)', fontSize:26, fontWeight:700, color:'var(--gold)', lineHeight:1 }}>{played?st.totG:'–'}</div>
                <div style={{ fontSize:9, color:'var(--muted2)', marginTop:2, letterSpacing:'1px', textTransform:'uppercase' }}>total gross</div>
                {played>0&&<>
                  <div style={{ fontFamily:'var(--serif)', fontSize:18, fontWeight:700, color:'var(--green)', marginTop:6 }}>{st.totN}</div>
                  <div style={{ fontSize:9, color:'var(--muted2)', letterSpacing:'1px', textTransform:'uppercase' }}>total net</div>
                </>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
// ── PhotoConfirm — editable confirmation after card reading ───────────────────
// Digitação rápida: grid completo (18 buracos x jogadores) editável direto,
// sem precisar passar por foto. Usa a mesma UI de grid do PhotoConfirm,
// mas escreve direto no estado `scores` do componente pai via onUpdate (= upd).
function QuickEntryGrid({ players, scores, par, onUpdate }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <h2>Digitação rápida</h2>
      <p style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 12 }}>
        Toque em qualquer número pra editar. Campo em branco = buraco não jogado.
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
                <input type="number" min="1" max="20"
                  value={scores[pi]?.[hi] ?? ''}
                  onChange={e => onUpdate(pi, hi, e.target.value)}
                  placeholder="–"
                  style={{
                    width:'100%', height:32, textAlign:'center', fontSize:13, fontWeight:700,
                    background: scores[pi]?.[hi] !== null ? 'rgba(201,168,76,0.1)' : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${scores[pi]?.[hi] !== null ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}`,
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
                <input type="number" min="1" max="20"
                  value={scores[pi]?.[hi+9] ?? ''}
                  onChange={e => onUpdate(pi, hi+9, e.target.value)}
                  placeholder="–"
                  style={{
                    width:'100%', height:32, textAlign:'center', fontSize:13, fontWeight:700,
                    background: scores[pi]?.[hi+9] !== null ? 'rgba(201,168,76,0.1)' : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${scores[pi]?.[hi+9] !== null ? 'var(--gold)' : 'rgba(255,255,255,0.1)'}`,
                    borderRadius:5, color:'var(--cream)', fontFamily:"'DM Sans',sans-serif",
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function PhotoConfirm({ players, photoResult, par, onConfirm, onRetry }) {
  const [editScores, setEditScores] = useState(
    () => players.map((_, pi) => {
      const row = (photoResult.scores || [])[pi] || []
      return Array.from({ length: 18 }, (_, i) => row[i] ?? null)
    })
  )

  const updScore = (pi, hi, val) => {
    setEditScores(prev => {
      const next = prev.map(r => r ? [...r] : Array(18).fill(null))
      if (!next[pi]) next[pi] = Array(18).fill(null)
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
        <p style={{ fontSize: 12, color: 'var(--gold)', marginBottom: 4 }}>
          Toque em qualquer número para corrigir. Campos em branco = buraco não jogado.
        </p>
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          💡 Pra conferir mais rápido: some as tacadas de cada jogador no cartão de papel e compare com o <strong style={{color:'var(--gold)'}}>Total</strong> que aparece embaixo do nome dele — bate mais rápido que checar buraco a buraco.
        </p>

        {players.map((p, pi) => {
          const row = editScores[pi] || []
          const sumOf = (vals) => vals.reduce((s, v) => s + (v ?? 0), 0)
          const frontVals = row.slice(0, 9)
          const backVals  = row.slice(9, 18)
          const frontFilled = frontVals.filter(v => v !== null && v !== undefined).length
          const backFilled  = backVals.filter(v => v !== null && v !== undefined).length
          const frontSum = sumOf(frontVals)
          const backSum  = sumOf(backVals)
          return (
          <div key={pi} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: pi % 2 === 0 ? '#7ab5f0' : '#f07a7a' }}>
                {p.name} — HCP {p.handicap}
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Ida{frontFilled < 9 ? ` ${frontFilled}/9` : ''}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cream)', fontFamily: 'var(--serif)' }}>{frontSum}</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 8, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Volta{backFilled < 9 ? ` ${backFilled}/9` : ''}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--cream)', fontFamily: 'var(--serif)' }}>{backSum}</div>
                </div>
                <div style={{ textAlign: 'center', paddingLeft: 8, borderLeft: '1px solid rgba(255,255,255,0.12)' }}>
                  <div style={{ fontSize: 8, color: 'var(--gold)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total</div>
                  <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--gold)', fontFamily: 'var(--serif)' }}>{frontSum + backSum}</div>
                </div>
              </div>
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
          )
        })}
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

function NassauResults({ pairs, players, indivResults, indivMoney, teamResult, teamMoney, tLA, tLB, betValues, title = 'Resultados Nassau' }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {pairs.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>
          Nenhum confronto individual configurado nesta rodada.
        </p>
      )}
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
            <Total18Row score={res.total18} money={m.total18} nA={players[a].name} nB={players[b].name}/>
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
          <Total18Row score={teamResult.total18} money={teamMoney.total18} nA={tLA} nB={tLB}/>
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

// Total 18 no resumo — sem press, vale o placar somado dos 18 buracos.
function Total18Row({ score, money, nA, nB }) {
  const w = score > 0 ? nA : score < 0 ? nB : null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--muted2)', marginBottom: 4, letterSpacing: '0.5px', textTransform: 'uppercase' }}>Total 18</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted2)', paddingLeft: 8, marginBottom: 2 }}>
        <span>Placar: <strong style={{ color: score > 0 ? '#7ab5f0' : score < 0 ? '#f07a7a' : 'var(--muted)' }}>{score === 0 ? 'AS' : `${w} +${Math.abs(score)}`}</strong></span>
        <span className={money > 0 ? 'pos' : money < 0 ? 'neg' : 'neu'} style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 700 }}>{money > 0 ? '+' : ''}R${Math.abs(money)}</span>
      </div>
    </div>
  )
}

function ResultDetailRow({ label, seg, money, nA, nB, unit }) {
  const w = seg.mainScore > 0 ? nA : seg.mainScore < 0 ? nB : null
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 10, color: 'var(--muted2)', marginBottom: 4, letterSpacing: '0.5px', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--muted2)', paddingLeft: 8, marginBottom: 2 }}>
        <span>Principal: <strong style={{ color: seg.mainScore > 0 ? '#7ab5f0' : seg.mainScore < 0 ? '#f07a7a' : 'var(--muted)' }}>{seg.mainScore === 0 ? 'AS' : `${w} +${Math.abs(seg.mainScore)}`}</strong></span>
        <span className={money.main > 0 ? 'pos' : money.main < 0 ? 'neg' : 'neu'} style={{ fontFamily: 'var(--serif)', fontSize: 14, fontWeight: 700 }}>{money.main > 0 ? '+' : ''}R${Math.abs(money.main)}</span>
      </div>
      {seg.pressScores.map((ps, i) => {
        const pw = ps > 0 ? nA : ps < 0 ? nB : null
        const pMoney = Math.sign(ps) * unit
        return (
          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted2)', paddingLeft: 8, marginBottom: 2 }}>
            <span>Press {i+1}: <strong style={{ color: ps > 0 ? '#7ab5f0' : ps < 0 ? '#f07a7a' : 'var(--muted)' }}>{ps === 0 ? 'AS' : `${pw} +${Math.abs(ps)}`}</strong></span>
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
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{result.skins[pi]} skin{result.skins[pi] !== 1 ? 's' : ''} · R${betUnit} de cada adversário</div>
          </div>
          <span className={result.money[pi] > 0 ? 'pos' : result.money[pi] < 0 ? 'neg' : 'neu'} style={{ fontWeight: 700, fontSize: 16 }}>
            {result.money[pi] > 0 ? '+' : result.money[pi] < 0 ? '−' : ''}R$ {Math.abs(result.money[pi])}
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

// Placar corrido do Medal — usado tanto no formato Medal quanto no Medal
// adicional (aposta extra somada a outro formato).
function MedalLive({ players, result, title }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {players.map((p, pi) => (
        <div key={pi} className="seg-row">
          <span>{p.name}</span>
          <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 13 }}>
            F {result.front[pi]} · B {result.back[pi]} · T {result.total[pi]}
          </span>
        </div>
      ))}
      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
        Totais líquidos (tacadas) até agora — menor número lidera cada segmento.
      </div>
    </div>
  )
}

function MedalResults({ players, result, betValues, title = 'Resultado Medal' }) {
  const segs = [
    { key: 'front', label: 'Front 9',  totals: result.front, money: result.frontMoney, val: betValues.frontVal },
    { key: 'back',  label: 'Back 9',   totals: result.back,  money: result.backMoney,  val: betValues.backVal },
    { key: 'total', label: 'Total 18', totals: result.total, money: result.totalMoney, val: betValues.totalVal },
  ]
  return (
    <div className="card">
      <h2>{title}</h2>
      {segs.map(seg => {
        const min = Math.min(...seg.totals)
        const winners = seg.totals.map((t, pi) => t === min ? pi : -1).filter(pi => pi >= 0)
        return (
          <div key={seg.key} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 1, color: 'var(--muted)', marginBottom: 6 }}>
              {seg.label} · R$ {seg.val} por jogador · pote R$ {seg.val * players.length}
            </div>
            {players.map((p, pi) => (
              <div key={pi} className="seg-row">
                <div>
                  <span style={{ fontWeight: winners.includes(pi) ? 700 : 400, color: winners.includes(pi) ? 'var(--gold)' : 'var(--cream)' }}>
                    {winners.includes(pi) ? '🏆 ' : ''}{p.name}
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{seg.totals[pi]} tacadas líq.</div>
                </div>
                <span className={seg.money[pi] > 0 ? 'pos' : seg.money[pi] < 0 ? 'neg' : 'neu'} style={{ fontWeight: 700, fontSize: 14 }}>
                  {seg.money[pi] > 0 ? `+R$ ${fmtBRL(seg.money[pi])}` : seg.money[pi] < 0 ? `−R$ ${fmtBRL(seg.money[pi])}` : '–'}
                </span>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// Pontos do Sindicato podem ser fracionados quando há empate (ex.: 3 jogadores
// empatados em 1º num Six dividem 6 → 2 cada; 2 empatados em 2º num Twelves
// dividem 4+2 → 3 cada) — mostra até 1 casa decimal, sem ",0" à toa.
function fmtPts(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ',')
}

function fmtBRL(v) {
  const abs = Math.abs(v)
  return Number.isInteger(abs) ? String(abs) : abs.toFixed(2).replace('.', ',')
}

function SindicatoResults({ players, result, betValues, par }) {
  const pot = betValues?.potValue || 0
  const order = players.map((p, pi) => ({ name: p.name, pi, pts: result.points[pi] }))
    .sort((a, b) => b.pts - a.pts)
  const medal = r => r === 0 ? '🏆' : r === 1 ? '🥈' : r === 2 ? '🥉' : `${r + 1}º`
  return (
    <div className="card">
      <h2>Resultado Sindicato · {players.length === 3 ? 'Six' : 'Twelves'}</h2>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>
        Pote R$ {fmtBRL(pot)} · cada um entrou com R$ {fmtBRL(result.ante)}
      </div>
      {order.map((o, rank) => {
        const share = result.pctShare[o.pi]
        const net = Math.round(result.money[o.pi] * 100) / 100
        return (
          <div key={o.pi} className="seg-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>{medal(rank)}</span>
              <div>
                <div style={{ fontWeight: 600, color: 'var(--cream)' }}>{o.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {fmtPts(o.pts)} pts · leva {fmtPts(share)}% = R$ {fmtBRL(pot * share / 100)} − entrou R$ {fmtBRL(result.ante)}
                </div>
              </div>
            </div>
            <span className={net > 0 ? 'pos' : net < 0 ? 'neg' : 'neu'} style={{ fontWeight: 700, fontSize: 15 }}>
              {net > 0 ? '+' : net < 0 ? '−' : ''}R$ {fmtBRL(net)}
            </span>
          </div>
        )
      })}

      {/* Pontos buraco a buraco */}
      <div style={{ fontSize: 10, color: 'var(--muted2)', textTransform: 'uppercase', letterSpacing: '1px', margin: '14px 0 6px' }}>
        Pontos por buraco
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', fontSize: 11, width: '100%', minWidth: 520 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', color: 'var(--muted2)', fontWeight: 600, padding: '3px 4px' }}></th>
              {result.holeResults.map((_, i) => (
                <th key={i} style={{ color: 'var(--muted2)', fontWeight: 600, padding: '3px 2px' }}>{i + 1}</th>
              ))}
              <th style={{ color: 'var(--gold)', fontWeight: 700, padding: '3px 4px' }}>Tot</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p, pi) => (
              <tr key={pi} style={{ borderTop: '0.5px solid rgba(255,255,255,0.08)' }}>
                <td style={{ color: 'var(--cream)', padding: '4px 4px', whiteSpace: 'nowrap' }}>{p.name}</td>
                {result.holeResults.map((h, i) => {
                  const v = h ? h[pi] : null
                  const top = h && v === Math.max(...h)
                  return (
                    <td key={i} style={{ textAlign: 'center', padding: '4px 2px', color: v === null ? 'var(--muted)' : top ? 'var(--gold)' : 'var(--cream)', fontWeight: top ? 700 : 400 }}>
                      {v === null ? '·' : fmtPts(v)}
                    </td>
                  )
                })}
                <td style={{ textAlign: 'center', color: 'var(--gold)', fontWeight: 700, padding: '4px 4px' }}>{fmtPts(result.points[pi])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function StablefordResults({ players, result, betUnit }) {
  const sorted = [...players.map((p, i) => ({ ...p, pts: result.points[i], i }))]
    .sort((a, b) => b.pts - a.pts)
  return (
    <div className="card">
      <h2>Resultado Stableford</h2>
      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
        Cada dupla acerta a diferença de pontos × R${betUnit}.
      </div>
      {sorted.map((p, rank) => (
        <div key={p.i} className="seg-row">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 16 }}>{rank === 0 ? '🏆' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank+1}º`}</span>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--cream)' }}>{p.name}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p.pts} pontos</div>
            </div>
          </div>
          <span className={result.money[p.i] > 0 ? 'pos' : result.money[p.i] < 0 ? 'neg' : 'neu'} style={{ fontWeight: 700, fontSize: 14 }}>
            {result.money[p.i] > 0 ? '+' : result.money[p.i] < 0 ? '−' : ''}R$ {Math.abs(result.money[p.i])}
          </span>
        </div>
      ))}
    </div>
  )
}
     
