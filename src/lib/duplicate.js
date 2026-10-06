// ── Rodada duplicada ─────────────────────────────────────────────────────────
// Com amigos vinculados, um só lança a rodada e todos recebem. Se dois do
// grupo lançarem o mesmo jogo, ele contaria em dobro no saldo e no ranking.
// Antes de salvar, o app compara com as rodadas que você já enxerga das
// últimas horas: mesmo nº de jogadores, cada jogador casado com um da outra
// rodada (pela conta, pelo nome ou pelos scores) e ≥ 80% dos scores iguais.
const norm = s => (s || '').trim().toLowerCase()

function similarity(a = [], b = []) {
  let both = 0, same = 0
  for (let i = 0; i < 18; i++) {
    const x = a[i], y = b[i]
    if (x === null || x === undefined || y === null || y === undefined) continue
    both++; if (Number(x) === Number(y)) same++
  }
  return { both, same }
}

// candidate: [{ name, userId, scores }] · existing: round com round_players
export function isLikelyDuplicate(candidate, existing) {
  const rps = existing?.round_players || []
  if (!candidate.length || rps.length !== candidate.length) return false
  const used = new Set()
  let both = 0, same = 0
  for (const c of candidate) {
    let best = -1, bestScore = -1
    rps.forEach((rp, k) => {
      if (used.has(k)) return
      const idMatch = c.userId && rp.player_user_id && c.userId === rp.player_user_id
      const nameMatch = norm(c.name) && norm(c.name) === norm(rp.player_name)
      const sim = similarity(c.scores, rp.gross_scores)
      const score = (idMatch ? 2 : 0) + (nameMatch ? 1 : 0) + (sim.both ? sim.same / sim.both : 0)
      if (score > bestScore) { bestScore = score; best = k }
    })
    if (best < 0) return false
    used.add(best)
    const sim = similarity(c.scores, rps[best].gross_scores)
    both += sim.both; same += sim.same
  }
  return both >= 9 && same / both >= 0.8
}
