import { useState } from 'react'

const WHATSAPP_NUMBER = '5541998631211'

const SCREEN_LABELS = {
  home: 'Início', setup: 'Configurar rodada', scorecard: 'Cartão de score',
  history: 'Histórico', ranking: 'Ranking', profile: 'Perfil',
}

export default function BugReportButton({ session, screen }) {
  const [open, setOpen] = useState(false)
  const [msg, setMsg]   = useState('')

  const send = () => {
    const who = session?.user?.user_metadata?.full_name || session?.user?.email || 'jogador não identificado'
    const where = SCREEN_LABELS[screen] || screen
    const text = [
      '🐞 Problema no Caddie Stakes Golf',
      '',
      `De: ${who}`,
      `Tela: ${where}`,
      `Aparelho: ${navigator.userAgent}`,
      '',
      msg.trim() || '(sem descrição — favor perguntar o que aconteceu)',
    ].join('\n')
    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(text)}`
    window.open(url, '_blank', 'noopener')
    setOpen(false)
    setMsg('')
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-label="Relatar um problema"
        style={{
          position: 'fixed', right: 14, bottom: 92, zIndex: 500,
          width: 46, height: 46, borderRadius: '50%',
          background: 'rgba(16,16,15,0.88)', border: '1px solid rgba(255,255,255,0.15)',
          color: '#e08a7d', fontSize: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
        }}
      >🐞</button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 600,
            display: 'flex', alignItems: 'flex-end',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#132116', width: '100%', borderRadius: '18px 18px 0 0',
              padding: '22px 20px calc(22px + env(safe-area-inset-bottom, 0px))',
              border: '1px solid rgba(255,255,255,0.08)', borderBottom: 'none',
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700, color: '#f0ead9', marginBottom: 6, fontFamily: "'Cormorant Garamond', Georgia, serif" }}>
              🐞 Relatar um problema
            </div>
            <p style={{ fontSize: 12, color: '#9a9186', marginBottom: 12, lineHeight: 1.5 }}>
              Conta rapidinho o que aconteceu — ao enviar, isso abre o WhatsApp com a mensagem pronta direto pro Cassiano.
            </p>
            <textarea
              autoFocus
              value={msg}
              onChange={e => setMsg(e.target.value)}
              placeholder="Ex.: a leitura por foto errou o score do buraco 5..."
              rows={4}
              style={{
                width: '100%', background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 10, color: '#f0ead9', padding: 10, fontSize: 14, marginBottom: 14,
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setOpen(false)}
                style={{ flex: 1, padding: '12px', borderRadius: 10, background: 'rgba(255,255,255,0.07)', color: '#e8e3d8', border: 'none', fontSize: 14, fontWeight: 600 }}
              >
                Cancelar
              </button>
              <button
                onClick={send}
                style={{ flex: 2, padding: '12px', borderRadius: 10, background: '#25D366', color: '#08321a', border: 'none', fontSize: 14, fontWeight: 700 }}
              >
                Enviar no WhatsApp
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
