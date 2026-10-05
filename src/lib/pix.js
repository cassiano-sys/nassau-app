// ── PIX: chaves, QR code "copia e cola" e acerto de contas ───────────────────
//
// Gera o BR Code estático do PIX (padrão EMV do Banco Central) com o valor já
// preenchido — o mesmo texto serve pra montar o QR code e pro "Pix Copia e
// Cola". Não passa por banco nem por API nenhuma: é só um texto que o app do
// banco de quem paga sabe ler. O app NÃO processa pagamento, só monta o código.

export const PIX_TYPES = [
  { id: 'cpf',   label: 'CPF/CNPJ',  placeholder: '000.000.000-00' },
  { id: 'phone', label: 'Celular',   placeholder: '(41) 99999-9999' },
  { id: 'email', label: 'Email',     placeholder: 'nome@email.com' },
  { id: 'evp',   label: 'Aleatória', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
]

// Normaliza a chave no formato que o PIX espera e diz se é válida.
// Retorna { key, error } — key null quando inválida.
export function normalizePixKey(type, raw) {
  const v = (raw || '').trim()
  if (!v) return { key: null, error: 'Digite a chave PIX.' }
  if (type === 'cpf') {
    const d = v.replace(/\D/g, '')
    if (d.length !== 11 && d.length !== 14) return { key: null, error: 'CPF precisa ter 11 dígitos (CNPJ, 14).' }
    return { key: d, error: null }
  }
  if (type === 'phone') {
    let d = v.replace(/\D/g, '')
    if (d.length === 10 || d.length === 11) d = '55' + d
    if (!(d.startsWith('55') && (d.length === 12 || d.length === 13))) {
      return { key: null, error: 'Celular com DDD, ex.: (41) 99999-9999.' }
    }
    return { key: '+' + d, error: null }
  }
  if (type === 'email') {
    const e = v.toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 77) return { key: null, error: 'Email inválido.' }
    return { key: e, error: null }
  }
  if (type === 'evp') {
    const k = v.toLowerCase()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(k)) {
      return { key: null, error: 'Chave aleatória tem 36 caracteres (com hífens).' }
    }
    return { key: k, error: null }
  }
  return { key: null, error: 'Escolha o tipo da chave.' }
}

// Mostra a chave de um jeito legível (CPF parcialmente escondido).
export function displayPixKey(type, key) {
  if (!key) return ''
  if (type === 'cpf' && key.length === 11) return `***.${key.slice(3, 6)}.${key.slice(6, 9)}-**`
  if (type === 'phone') {
    const d = key.replace(/\D/g, '').slice(2)
    return d.length === 11 ? `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}` : key
  }
  return key
}

// Campos do BR Code usam só ASCII simples, maiúsculo, sem acento.
function ascii(s, max) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .trim().toUpperCase().slice(0, max)
}

const field = (id, value) => id + String(value.length).padStart(2, '0') + value

// CRC16-CCITT (polinômio 0x1021, valor inicial 0xFFFF) exigido pelo BR Code.
function crc16(str) {
  let crc = 0xFFFF
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1)
      crc &= 0xFFFF
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0')
}

// key: chave já normalizada · name: recebedor · amount: em reais
// description: texto curto opcional (aparece no app de alguns bancos)
export function buildPixPayload({ key, name, city = 'BRASIL', amount, description }) {
  const gui = field('00', 'br.gov.bcb.pix') + field('01', key)
  const desc = ascii(description, 40)
  const account = desc && (gui + field('02', desc)).length <= 99 ? gui + field('02', desc) : gui

  let payload =
    field('00', '01') +
    field('26', account) +
    field('52', '0000') +
    field('53', '986') +
    (amount > 0 ? field('54', amount.toFixed(2)) : '') +
    field('58', 'BR') +
    field('59', ascii(name, 25) || 'RECEBEDOR') +
    field('60', ascii(city, 15) || 'BRASIL') +
    field('62', field('05', '***')) +
    '6304'
  return payload + crc16(payload)
}

// Acerto de contas: a partir do saldo de cada jogador (soma zero), monta a
// menor lista prática de transferências — o maior devedor paga o maior
// credor, e assim por diante. players: [{ name, money }]
// Retorna [{ from, to, amount }] com índices dos jogadores.
export function settleUp(money) {
  const cents = money.map(v => Math.round((v || 0) * 100))
  const creditors = cents.map((c, i) => ({ i, c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c)
  const debtors   = cents.map((c, i) => ({ i, c: -c })).filter(x => x.c > 0).sort((a, b) => b.c - a.c)

  const transfers = []
  let ci = 0, di = 0
  while (ci < creditors.length && di < debtors.length) {
    const amt = Math.min(creditors[ci].c, debtors[di].c)
    // Sobra de 1-2 centavos vem só de arredondamento (ex.: pote ÷ 3) — ignora.
    if (amt > 2) transfers.push({ from: debtors[di].i, to: creditors[ci].i, amount: amt / 100 })
    creditors[ci].c -= amt
    debtors[di].c   -= amt
    if (creditors[ci].c <= 0) ci++
    if (debtors[di].c <= 0) di++
  }
  return transfers
}

export function fmtReais(v) {
  return 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}
