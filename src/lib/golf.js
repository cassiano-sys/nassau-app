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

export function segMoney(seg, unit) {
  const main  = Math.sign(seg.mainScore) * unit
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

export function calcMoney(result, betValues) {
  const { frontVal: fv, backVal: bv, totalVal: tv } = betValues
  const mF = segMoney(result.front, fv)
  const mB = segMoney(result.back,  bv)
  const mT = Math.sign(result.total18) * tv
  return { front: mF, back: mB, total18: mT, grand: mF.total + mB.total + mT }
}

// ── Skins ─────────────────────────────────────────────────────────────────────
// Each hole is worth 1 skin. Ties carry over to next hole.
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
    money: skins.map(s => s * betPerSkin),
    totalSkins,
    carryover,
  }
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

  return {
    points,
    winners,
    money: players.map((_, pi) => {
      if (winners.includes(pi)) return betPerPoint * (maxPoints - (points.find((p, i) => !winners.includes(i)) ?? 0))
      return 0
    }),
  }
}
