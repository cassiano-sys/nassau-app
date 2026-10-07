// ── Aviso "instale o app na tela do celular" ────────────────────────────────
// Só aparece no celular, aberto pelo navegador (não instalado), e some pra
// sempre depois de instalado ou dispensado. No Android/Chrome o navegador
// oferece o botão de instalar direto; no iPhone mostra o caminho no Safari.

const KEY = 'csg_install_dismissed'
export const INSTALL_GUIDE_URL = 'https://caddiestakesgolf.com/manual.html#passo1'

let deferred = null
const subs = new Set()
const notify = () => subs.forEach(f => f())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; notify() })
  window.addEventListener('appinstalled', () => { deferred = null; dismissInstall(); notify() })
}

export function subscribeInstall(fn) { subs.add(fn); return () => subs.delete(fn) }
export const canPromptInstall = () => !!deferred

export function isStandalone() {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
  } catch { return false }
}
export function platform() {
  const ua = navigator.userAgent || ''
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Android/i.test(ua)) return 'android'
  return 'desktop'
}
export function shouldShowInstall() {
  if (isStandalone() || platform() === 'desktop') return false
  try { return !localStorage.getItem(KEY) } catch { return false }
}
export function dismissInstall() { try { localStorage.setItem(KEY, '1') } catch {} }

// Abre o prompt nativo do Android. Retorna true se a pessoa instalou.
export async function promptInstall() {
  if (!deferred) return false
  const ev = deferred; deferred = null
  ev.prompt()
  const { outcome } = await ev.userChoice
  if (outcome === 'accepted') dismissInstall()
  notify()
  return outcome === 'accepted'
}
