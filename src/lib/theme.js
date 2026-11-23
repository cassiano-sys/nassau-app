// Tema claro/escuro. Claro é o padrão — o app é usado ao ar livre, quase
// sempre sob sol forte, e fundo claro com texto escuro reflete menos luz e
// fica mais legível nessas condições do que fundo escuro. O escuro vira
// uma escolha manual, lembrada por aparelho (não sincroniza entre
// dispositivos — é só uma preferência de exibição, não precisa).
const KEY = 'cs_theme'

export function getTheme() {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'dark' || saved === 'light') return saved
  } catch {
    // localStorage indisponível (modo privado etc.) — segue com o padrão
  }
  return 'light'
}

export function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // ignora — pior caso, a escolha não persiste entre sessões
  }
}

export function toggleTheme() {
  const next = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

// Aplica o tema salvo assim que este módulo é importado. Importar isto
// como o PRIMEIRO import em main.jsx evita o "flash" do tema errado antes
// do React montar a árvore.
setTheme(getTheme())
