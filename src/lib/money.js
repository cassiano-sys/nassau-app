// Formatação de dinheiro padrão brasileiro: "+R$ 1.234,50", "−R$ 12", "R$ 0".
// Centavos só aparecem quando existem (R$ 20 em vez de R$ 20,00).
export function fmtAbs(v) {
  const a = Math.round(Math.abs(Number(v) || 0) * 100) / 100
  const opts = Number.isInteger(a) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }
  return a.toLocaleString('pt-BR', opts)
}
export function fmtSigned(v, sep = ' ') {
  const n = Math.round((Number(v) || 0) * 100) / 100
  if (n === 0) return `R$${sep}0`
  return `${n > 0 ? '+' : '−'}R$${sep}${fmtAbs(n)}`
}
