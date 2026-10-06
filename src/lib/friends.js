import { supabase } from './supabase'

// ── Amigos e vínculo de jogadores às contas ──────────────────────────────────
// Depende de supabase_migration_amigos.sql (tabelas profiles / friendships /
// friend_invites e as funções create_invite, accept_invite, claim_rounds…).

const INVITE_KEY = 'csg_pending_invite'

// Apelido = "como você aparece no cartão". Sem apelido, cai no primeiro nome.
export function myNickname(user) {
  const m = user?.user_metadata || {}
  return (m.nickname || (m.full_name || '').split(' ')[0] || '').trim()
}

// Garante que a conta tem um perfil (apelido visível para os amigos)
export async function syncProfile(user) {
  if (!user?.id) return
  const m = user.user_metadata || {}
  const { error } = await supabase.from('profiles').upsert({
    id: user.id, nickname: myNickname(user) || null, full_name: m.full_name || null,
    updated_at: new Date().toISOString(),
  })
  if (error) console.error('Perfil não sincronizado:', error.message)
}

export async function listFriends(uid) {
  const { data: fr, error } = await supabase.from('friendships').select('friend_id').eq('user_id', uid)
  if (error || !fr?.length) return []
  const ids = fr.map(f => f.friend_id)
  const { data: profs } = await supabase.from('profiles').select('id,nickname,full_name').in('id', ids)
  return ids.map(id => {
    const p = (profs || []).find(x => x.id === id) || {}
    return { id, nickname: p.nickname || (p.full_name || '').split(' ')[0] || 'Amigo', fullName: p.full_name || '' }
  }).sort((a, b) => a.nickname.localeCompare(b.nickname))
}

export async function createInviteLink() {
  const { data, error } = await supabase.rpc('create_invite')
  if (error) throw error
  return `${window.location.origin}/?convite=${data}`
}

export async function inviteInfo(code) {
  const { data } = await supabase.rpc('invite_info', { p_code: code })
  return data || null
}

export async function acceptInvite(code) {
  const { data, error } = await supabase.rpc('accept_invite', { p_code: code })
  if (error) throw error
  return data
}

export async function claimRounds(friendId, name) {
  const { data, error } = await supabase.rpc('claim_rounds', { p_friend: friendId, p_name: name })
  if (error) throw error
  return data || 0
}

export async function removeFriend(friendId) {
  const { error } = await supabase.rpc('remove_friend', { p_friend: friendId })
  if (error) throw error
}

// Convite pendente: o link ?convite=CODE é guardado no aparelho até a pessoa
// entrar ou criar a conta (pode levar alguns minutos) e então é aceito.
export function captureInviteFromUrl() {
  try {
    const url = new URL(window.location.href)
    const code = url.searchParams.get('convite')
    if (code) {
      localStorage.setItem(INVITE_KEY, code)
      url.searchParams.delete('convite')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  } catch {}
}
export function pendingInvite() { try { return localStorage.getItem(INVITE_KEY) } catch { return null } }
export function clearPendingInvite() { try { localStorage.removeItem(INVITE_KEY) } catch {} }
