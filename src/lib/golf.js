// ── Courses ──────────────────────────────────────────────────────────────────
export const COURSES = [
  {
    id: 'graciosa',
    name: 'Graciosa Country Club',
    city: 'Curitiba, PR',
    si:  [9,3,13,15,11,1,5,17,7, 8,4,14,16,10,2,6,18,12],
    par: [5,5,3,4,3,4,4,3,4,    5,5,3,3,4,4,4,3,5],
  },
  {
    id: 'custom',
    name: 'Outro campo',
    city: '',
    si:  [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18],
    par: [4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4,4],
  },
]
 
export const HOLES = Array.from({ length: 18 }, (_, i) => i + 1)
export const FRONT = [0,1,2,3,4,5,6,7,8]
export const BACK  = [9,10,11,12,13,14,15,16,17]
 
// ── Handicap ─────────────────────────────────────────────────────────────────
export function getStrokesPair(hcpLow, hcpHigh, si, holeIdx) {
  const diff = hcpHigh - hcpLow
  if (diff <= 0) return 0
  return Math.floor(diff / 18) + (si[holeIdx] <= (diff % 18) ? 1 : 0)
}
 
export function getStrokesGlobal(playerHcp, lowestHcp, si, holeIdx) {
  return getStrokesPair(lowestHcp, playerHcp, si, holeIdx)
}
 
// ── Match comparison ──────────────────────────────────────────────────────────
export function cmp(a, b) { return a < b ? 1 : a > b ? -1 : 0 }
 
// ── Nassau Press ──────────────────────────────────────────────────────────────
// Each bet spawns ONE child press when it hits ±pressAt (cascading allowed)
export function calcSegment(pts, pressAt) {
  const bets = [{ running: 0, pressSpawned: false, activeFrom: 0 }]
  for (let i = 0; i < pts.length; i++) {
    const holesLeft = pts.length - 1 - i
    const snap = bets.length
    for (let b = 0; b < snap; b++) {
      if (i >= bets[b].activeFrom) bets[b].running += pts[i]
    }
    if (holesLeft > 0) {
      for (let b = 0; b < snap; b++) {
        if (bets[b].pressSpawned || i < bets[b].activeFrom) continue
        if (Math.abs(bets[b].running) >= pressAt) {
          bets[b].pressSpawned = true
          bets.push({ running: 0, pressSpawned: false, activeFrom: i + 1 })
        }
      }
    }
  }
  return {
    mainScore:    bets[0].running,
    pressScores:  bets.slice(1).map(b => b.running),
    totalBets:    bets.length,
  }
}
 
// mainMultiplier: normally 1 (the opening bet is worth the same as each
// press). Catraca uses 2 — the opening Front9/Back9 bet counts double the
// per-press unit, while every press that fires afterward is still worth
// exactly one unit.
export function segMoney(seg, unit, mainMultiplier = 1) {
  const main  = Math.sign(seg.mainScore) * unit * mainMultiplier
  const press = seg.pressScores.reduce((s, r) => s + Math.sign(r) * unit, 0)
  return { main, press, total: main + press }
}
 
// ── Individual matchup (pairwise HCP) ────────────────────────────────────────
export function calcIndiv(grossA, grossB, hcpA, hcpB, si, pressAt = 2) {
  const hcpLow  = Math.min(hcpA, hcpB)
  const hcpHigh = Math.max(hcpA, hcpB)
  const aIsLow  = hcpA <= hcpB
 
  const pts18 = Array.from({ length: 18 }, (_, i) => {
    const gA = grossA[i], gB = grossB[i]
    if (gA === null || gB === null) return null
    const s  = getStrokesPair(hcpLow, hcpHigh, si, i)
    return cmp(gA - (aIsLow ? 0 : s), gB - (aIsLow ? s : 0))
  })
 
  const validF = FRONT.map(i => pts18[i]).filter(p => p !== null)
  const validB = BACK.map(i => pts18[i]).filter(p => p !== null)
  const front  = calcSegment(validF, pressAt)
  const back   = calcSegment(validB, pressAt)
  const total18 = pts18.filter(p => p !== null).reduce((s, p) => s + p, 0)
 
  return {
    front,
    back,
    total18,
    frontPlayed: validF.length,
    backPlayed:  validB.length,
  }
}
 
// ── Team matchup (bestball + sum, global HCP) ─────────────────────────────────
export function calcTeam(grossAll, players, teamA, teamB, si, pressAt = 4) {
  const lowestHcp = Math.min(...players.map(p => p.handicap))
  const getNet = (pi, i) => {
    const g = grossAll[pi][i]
    if (g === null) return null
    return g - getStrokesGlobal(players[pi].handicap, lowestHcp, si, i)
  }
 
  const teamPts18 = Array.from({ length: 18 }, (_, i) => {
    const nA = teamA.map(pi => getNet(pi, i)).filter(v => v !== null)
    const nB = teamB.map(pi => getNet(pi, i)).filter(v => v !== null)
    if (!nA.length || !nB.length) return null
    return cmp(Math.min(...nA), Math.min(...nB)) +
           cmp(nA.reduce((a, b) => a + b, 0), nB.reduce((a, b) => a + b, 0))
  })
 
  const validF = FRONT.map(i => teamPts18[i]).filter(p => p !== null)
  const validB = BACK.map(i => teamPts18[i]).filter(p => p !== null)
  const front  = calcSegment(validF, pressAt)
  const back   = calcSegment(validB, pressAt)
  const total18 = teamPts18.filter(p => p !== null).reduce((s, p) => s + p, 0)
 
  return {
    front,
    back,
    total18,
    frontPlayed: validF.length,
    backPlayed:  validB.length,
  }
}
 
export function calcMoney(result, betValues, mainMultiplier = 1) {
  const { frontVal: fv, backVal: bv, totalVal: tv } = betValues
  const mF = segMoney(result.front, fv, mainMultiplier)
  const mB = segMoney(result.back,  bv, mainMultiplier)
  const mT = Math.sign(result.total18) * tv
  return { front: mF, back: mB, total18: mT, grand: mF.total + mB.total + mT }
}
 
// ── Zero-sum payout ──────────────────────────────────────────────────────────
// Pool formats (Skins/Stableford/Medal) compute a "gross winnings" array —
// positive for whoever won something, 0 for everyone else. On its own that
// isn't zero-sum: with only 2 players it looks like money appears from
// nowhere instead of coming out of the other player's pocket. This turns it
// into a real settlement: winners keep what they won, and whoever won
// nothing (gross === 0) splits paying for it evenly. If nobody won anything
// (gross is all zero) or literally everyone "won" (a full tie), there's no
// one to fund from, so nothing changes.
export function zeroSum(gross) {
  const totalToFund = gross.reduce((a, b) => a + b, 0)
  const losers = gross.map((g, i) => g === 0 ? i : -1).filter(i => i >= 0)
  if (losers.length === 0 || totalToFund === 0) return gross.slice()
  const share = totalToFund / losers.length
  return gross.map((g, i) => losers.includes(i) ? g - share : g)
}
 
// ── Skins ─────────────────────────────────────────────────────────────────────
// Each hole is worth 1 skin. Ties carry over to next hole.
// Money: each skin is paid by EVERY other player — "skins a R$20" means the
// winner of a skin collects R$20 from each opponent. So a player's balance
// is betPerSkin × (n × theirSkins − totalSkins): zero-sum by construction,
// and correct even when every player won at least one skin (the old
// zeroSum() model only charged players with zero skins, so a round where
// everyone won something showed everyone positive).
export function calcSkins(grossAll, players, si, betPerSkin) {
  const lowestHcp = Math.min(...players.map(p => p.handicap))
  const skins = players.map(() => 0)
  let carryover = 0
 
  HOLES.forEach((_, i) => {
    const nets = players.map((p, pi) => {
      const g = grossAll[pi][i]
      if (g === null) return null
      return g - getStrokesGlobal(p.handicap, lowestHcp, si, i)
    })
    const validNets = nets.filter(n => n !== null)
    if (!validNets.length) return
 
    const best = Math.min(...validNets)
    const winners = nets.map((n, pi) => n === best ? pi : -1).filter(pi => pi >= 0)
 
    if (winners.length === 1) {
      skins[winners[0]] += 1 + carryover
      carryover = 0
    } else {
      carryover++
    }
  })
 
  const totalSkins = skins.reduce((a, b) => a + b, 0)
  return {
    skins,
    money: skins.map(s => betPerSkin * (players.length * s - totalSkins)),
    totalSkins,
    carryover,
  }
}
 
// ── Medal (stroke play) ──────────────────────────────────────────────────────
// Each segment (Front 9 / Back 9 / Total 18) is its own winner-take-all game:
// every player stakes the segment's value, and whoever has the LOWEST
// net-stroke total takes the whole pot (split evenly if tied). No press, no pairwise H2H — everyone in the round
// competes against everyone else at once, like Skins/Stableford.
export function calcMedal(grossAll, players, si, betValues) {
  const lowestHcp = Math.min(...players.map(p => p.handicap))
  const netAll = players.map((p, pi) =>
    HOLES.map((_, i) => {
      const g = grossAll[pi][i]
      if (g === null) return null
      return g - getStrokesGlobal(p.handicap, lowestHcp, si, i)
    })
  )
 
  const segmentTotals = (holeIdxs) => netAll.map(net =>
    holeIdxs.reduce((sum, i) => sum + (net[i] !== null ? net[i] : 0), 0)
  )
 
  // `value` is what EACH player stakes on that segment — the segment's pot is
  // value × number of players (e.g. 4 players at R$20 → R$80 pot). Whoever
  // has the lowest net total takes the whole pot: every loser pays exactly
  // `value`, and the winner nets value × (n − 1). Tied winners split the pot
  // evenly (each still having put in their own `value`).
  const payout = (totals, value) => {
    const min = Math.min(...totals)
    const winners = totals.map((t, pi) => t === min ? pi : -1).filter(pi => pi >= 0)
    // Everyone tied (including a fully-unplayed segment, where every total
    // is still 0) — no one actually won, so it's a push: everyone keeps their stake.
    if (winners.length === totals.length) return totals.map(() => 0)
    const pot = value * totals.length
    return totals.map((_, pi) => winners.includes(pi) ? pot / winners.length - value : -value)
  }
 
  const front = segmentTotals(FRONT)
  const back  = segmentTotals(BACK)
  const total = front.map((f, pi) => f + back[pi])
 
  const frontMoney = payout(front, betValues.frontVal)
  const backMoney  = payout(back,  betValues.backVal)
  const totalMoney = payout(total, betValues.totalVal)
 
  const money = players.map((_, pi) => frontMoney[pi] + backMoney[pi] + totalMoney[pi])
 
  return { front, back, total, frontMoney, backMoney, totalMoney, money }
}
 
// ── Stableford ────────────────────────────────────────────────────────────────
// Points: eagle=4, birdie=3, par=2, bogey=1, double bogey+=0
export function stablefordPoints(net, par) {
  const diff = par - net
  if (diff >= 2)  return 4  // eagle or better
  if (diff === 1) return 3  // birdie
  if (diff === 0) return 2  // par
  if (diff === -1) return 1 // bogey
  return 0                  // double bogey or worse
}
 
export function calcStableford(grossAll, players, si, par, betPerPoint) {
  const lowestHcp = Math.min(...players.map(p => p.handicap))
 
  const points = players.map((p, pi) =>
    HOLES.reduce((total, _, i) => {
      const g = grossAll[pi][i]
      if (g === null) return total
      const net = g - getStrokesGlobal(p.handicap, lowestHcp, si, i)
      return total + stablefordPoints(net, par[i])
    }, 0)
  )
 
  const maxPoints = Math.max(...points)
  const winners   = points.map((pts, pi) => pts === maxPoints ? pi : -1).filter(pi => pi >= 0)
 
  // Money: "per point, against each opponent" — every pair of players
  // settles the difference in their points × betPerPoint. Summed over all
  // opponents, a player's balance is betPerPoint × (n × theirPoints −
  // totalPoints). Zero-sum by construction; a bigger margin pays more, and
  // 3rd place pays more than 2nd (unlike the old leader-vs-runner-up model).
  const totalPoints = points.reduce((a, b) => a + b, 0)
  const money = points.map(pts => betPerPoint * (players.length * pts - totalPoints))
 
  return { points, winners, money }
}
 
// ── Sindicato (Six / Twelves) ─────────────────────────────────────────────────
// Individual, no-team, points-per-hole format for rounds of exactly 3 or 4
// players. Each hole pays out a fixed pool of points split by net-score
// rank: 3 players share 6 points (4-2-0) — "Six" — and 4 players share 12
// points (6-4-2-0) — "Twelves". A hole is only scored once every player in
// the round has a recorded gross score for it (comparative ranking needs
// everyone's net). Ties — both on a single hole and in the final overall
// standings — sum the value of the tied positions and split it evenly
// among the tied players, never invent or drop points.
//
// Money is a pot, not a per-point bet: every player antes an equal share
// of a pot value the group sets, and the pot is paid back out by finishing
// position using a user-editable percentage split (defaults below). This
// is zero-sum by construction — the percentages sum to 100, so total
// payout always equals the total pot, no zeroSum() helper needed.
export const SIX_HOLE_POINTS     = [4, 2, 0]      // 3 players
export const TWELVES_HOLE_POINTS = [6, 4, 2, 0]   // 4 players
 
export const SINDICATO_DEFAULT_PCT = {
  3: [70, 30, 0],
  4: [60, 30, 10, 0],
}
 
// Ranks players by `scores` ascending (lowest = best) and hands out
// `values` in that order. Tied scores share the summed value of the
// positions they occupy, split evenly — used for both per-hole points
// (scores = net strokes) and final payout (scores = -totalPoints).
export function rankSplit(scores, values) {
  const order = scores
    .map((score, pi) => ({ pi, score }))
    .sort((a, b) => a.score - b.score)
 
  const result = new Array(scores.length).fill(0)
  let i = 0
  while (i < order.length) {
    let j = i
    while (j + 1 < order.length && order[j + 1].score === order[i].score) j++
    const share = values.slice(i, j + 1).reduce((a, b) => a + b, 0) / (j - i + 1)
    for (let k = i; k <= j; k++) result[order[k].pi] = share
    i = j + 1
  }
  return result
}
 
export function calcSindicato(grossAll, players, si, potValue, payoutPct) {
  const n = players.length
  if (n !== 3 && n !== 4) {
    throw new Error('Sindicato requires a round of exactly 3 or 4 players')
  }
  const holePoints = n === 3 ? SIX_HOLE_POINTS : TWELVES_HOLE_POINTS
  const pct = payoutPct || SINDICATO_DEFAULT_PCT[n]
  const lowestHcp = Math.min(...players.map(p => p.handicap))
 
  const netAll = players.map((p, pi) =>
    HOLES.map((_, i) => {
      const g = grossAll[pi][i]
      if (g === null) return null
      return g - getStrokesGlobal(p.handicap, lowestHcp, si, i)
    })
  )
 
  const points = players.map(() => 0)
  const holeResults = HOLES.map((_, i) => {
    const nets = netAll.map(net => net[i])
    if (nets.some(net => net === null)) return null
    const split = rankSplit(nets, holePoints)
    split.forEach((pts, pi) => { points[pi] += pts })
    return split
  })
 
  // Final standings rank by total points descending (most points = best),
  // so negate for rankSplit, which ranks ascending.
  const pctShare = rankSplit(points.map(p => -p), pct)
 
  const ante = potValue / n
  const money = pctShare.map(share => (potValue * share) / 100 - ante)
 
  return { points, holeResults, pctShare, ante, money }
}
 
