// ── Rodada em andamento (rascunho local) ─────────────────────────────────────
// Os scores ficavam só na memória do app até "Salvar rodada". Se o celular
// fechasse o app em segundo plano (comum em 4h de jogo), a rodada sumia.
// Agora cada mudança é guardada no próprio aparelho (localStorage), por
// usuário, e a tela inicial oferece "Continuar rodada". Funciona sem
// internet. Tudo em try/catch: em aba anônima ou com armazenamento
// bloqueado, o app simplesmente segue sem rascunho.
const key = (uid) => `csg_draft_${uid || 'anon'}`

export function saveDraft(uid, draft) {
  try { localStorage.setItem(key(uid), JSON.stringify({ ...draft, savedAt: new Date().toISOString() })) } catch {}
}

export function loadDraft(uid) {
  try {
    const raw = localStorage.getItem(key(uid))
    if (!raw) return null
    const d = JSON.parse(raw)
    if (!d?.config?.players || !Array.isArray(d.scores)) return null
    return d
  } catch { return null }
}

export function clearDraft(uid) {
  try { localStorage.removeItem(key(uid)) } catch {}
}

// Resumo para a tela inicial: buracos lançados e próximo buraco
export function draftSummary(d) {
  const filled = d.scores.map(row => row.filter(v => v !== null && v !== undefined).length)
  const holesDone = Math.max(0, ...d.scores[0].map((_, i) => d.scores.some(r => r[i] !== null && r[i] !== undefined) ? i + 1 : 0))
  return { holesDone, anyScore: filled.some(n => n > 0) }
}
