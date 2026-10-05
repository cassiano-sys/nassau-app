import { useState, useEffect, useMemo } from 'react'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase'
import {
  PIX_TYPES, normalizePixKey, displayPixKey, buildPixPayload, settleUp, fmtReais,
} from '../lib/pix'

// ── Acerto via PIX ────────────────────────────────────────────────────────────
// Mostra "quem paga quem" no fim da rodada (menor número de transferências) e,
// pra cada uma, o QR code / Pix Copia e Cola já com o valor, pronto pra
// mandar no WhatsApp. As chaves vêm de dois lugares:
//   • a sua: cadastrada no Perfil (fica no user_metadata da conta)
//   • a dos parceiros: guardada por você na tabela saved_players (mesmo
//     cadastro que já sugere nome e handicap na hora de montar a rodada)
//
// players: [{ name, money, handicap }] · meIndex: índice do usuário logado
// (ou -1 se ele não estiver na rodada) · description: texto curto que vai
// junto no PIX (ex.: "Golfe Graciosa 05/10").
export default function PixSettlement({ players, meIndex, description }) {
  const [myPix,     setMyPix]     = useState(null)     // { key, type, uid }
  const [partners,  setPartners]  = useState({})       // nome minúsculo -> { name, key, type }
  const [loadError, setLoadError] = useState('')
  const [qrIdx,     setQrIdx]     = useState(null)     // índice da transferência aberta no QR
  const [editing,   setEditing]   = useState(null)     // índice do jogador cadastrando chave
  const [copied,    setCopied]    = useState('')
  // Valor ajustado à mão por transferência: número = valor novo, null = QR
  // sem valor (quem paga digita no banco). Sem entrada = valor calculado.
  const [overrides, setOverrides] = useState({})
  const [editAmt,   setEditAmt]   = useState(null)     // índice da transferência em edição

  const calculated = useMemo(() => settleUp(players.map(p => p.money)), [players])
  // Se os saldos mudarem (ex.: correção de score), os ajustes manuais perdem o sentido
  // (compara pelo conteúdo, não pela referência — o pai recria o array a cada render)
  const calcSig = calculated.map(t => `${t.from}>${t.to}:${t.amount}`).join('|')
  useEffect(() => { setOverrides({}); setEditAmt(null) }, [calcSig])
  const transfers = useMemo(() => calculated.map((t, ti) => ({
    ...t,
    original: t.amount,
    amount: ti in overrides ? overrides[ti] : t.amount,
    edited: ti in overrides,
  })), [calculated, overrides])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: u } = await supabase.auth.getUser()
      const user = u?.user
      if (!user || !alive) return
      const meta = user.user_metadata || {}
      setMyPix({ key: meta.pix_key || null, type: meta.pix_type || null, uid: user.id })

      const { data, error } = await supabase.from('saved_players')
        .select('name,pix_key,pix_type').eq('user_id', user.id)
      if (!alive) return
      if (error) {
        // Coluna pix_key ainda não criada no banco (migração não rodada)
        console.error('Erro ao carregar chaves PIX dos parceiros:', error.message)
        setLoadError('Para guardar a chave PIX dos parceiros, falta rodar a atualização do banco (pix_key em saved_players).')
        return
      }
      const map = {}
      ;(data || []).forEach(r => {
        map[r.name.trim().toLowerCase()] = { name: r.name, key: r.pix_key, type: r.pix_type }
      })
      setPartners(map)
    })()
    return () => { alive = false }
  }, [])

  const pixOf = (pi) => {
    if (pi === meIndex) return myPix?.key ? { key: myPix.key, type: myPix.type } : null
    const p = partners[players[pi].name.trim().toLowerCase()]
    return p?.key ? { key: p.key, type: p.type } : null
  }

  const payloadFor = (t) => {
    const pix = pixOf(t.to)
    if (!pix) return null
    return buildPixPayload({ key: pix.key, name: players[t.to].name, amount: t.amount, description })
  }

  const saveKey = async (pi, type, key) => {
    if (pi === meIndex) {
      const { error } = await supabase.auth.updateUser({ data: { pix_key: key, pix_type: type } })
      if (error) return error.message
      setMyPix(prev => ({ ...prev, key, type }))
      return null
    }
    if (!myPix?.uid) return 'Sessão expirada — entre de novo.'
    const lower = players[pi].name.trim().toLowerCase()
    // Reaproveita a grafia já salva do nome, pra não criar um parceiro duplicado
    const name = partners[lower]?.name || players[pi].name.trim()
    const row = { user_id: myPix.uid, name, pix_key: key, pix_type: type }
    if (!partners[lower]) {
      row.handicap = players[pi].handicap ?? 0
      row.last_used_at = new Date().toISOString()
    }
    const { error } = await supabase.from('saved_players').upsert(row, { onConflict: 'user_id,name' })
    if (error) return error.message
    setPartners(prev => ({ ...prev, [lower]: { name, key, type } }))
    return null
  }

  const copy = async (text, tag) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = text; document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') } catch {}
      document.body.removeChild(ta)
    }
    setCopied(tag); setTimeout(() => setCopied(''), 2000)
  }

  const shareAll = () => {
    const lines = ['⛳ *Caddie Stakes — acerto da rodada*']
    if (description) lines.push(`_${description}_`)
    lines.push('')
    transfers.forEach(t => {
      lines.push(`• *${players[t.from].name}* paga *${amountLabel(t)}* a *${players[t.to].name}*`)
      const code = payloadFor(t)
      if (code) lines.push(`  Pix Copia e Cola:\n${code}`)
      lines.push('')
    })
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join('\n').trim())}`, '_blank')
  }

  const shareOne = (t) => {
    const code = payloadFor(t)
    const text = `⛳ *Caddie Stakes*\n${players[t.from].name}, seu acerto da rodada: *${amountLabel(t)}* para *${players[t.to].name}*.` +
      (code ? `\n\nPix Copia e Cola:\n${code}` : '')
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  // Sem valor no código: mostra o valor de referência pra quem vai digitar no banco
  const amountLabel = (t) => t.amount == null ? `${fmtReais(t.original)} (digite o valor no banco)` : fmtReais(t.amount)

  if (transfers.length === 0) return null
  const qrFor = qrIdx !== null ? transfers[qrIdx] : null

  return (
    <div className="card">
      <h2>💸 Acerto via PIX</h2>
      <p style={{ fontSize: 11, color: 'var(--muted2)', lineHeight: 1.5, marginBottom: 12 }}>
        O menor número de transferências pra zerar a rodada. Toque em <strong>QR</strong> pra mostrar o código no seu celular, ou mande pelo WhatsApp.
      </p>

      {transfers.map((t, ti) => {
        const pix = pixOf(t.to)
        return (
          <div key={ti} style={{ padding: '10px 0', borderTop: ti ? '0.5px solid rgba(255,255,255,0.08)' : 'none' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--cream)', lineHeight: 1.4 }}>
                <strong style={{ color: '#f07a7a' }}>{players[t.from].name}</strong>
                <span style={{ color: 'var(--muted2)' }}> paga a </span>
                <strong style={{ color: 'var(--green2, #5dba7a)' }}>{players[t.to].name}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--serif)', fontSize: t.amount == null ? 14 : 18, fontWeight: 700, color: 'var(--gold)', whiteSpace: 'nowrap' }}>
                    {t.amount == null ? 'Sem valor no QR' : fmtReais(t.amount)}
                  </div>
                  {t.edited && (
                    <div style={{ fontSize: 10, color: 'var(--muted2)' }}>calculado: {fmtReais(t.original)}</div>
                  )}
                </div>
                <button type="button" aria-label="Editar valor" onClick={() => setEditAmt(editAmt === ti ? null : ti)}
                  style={{ width: 30, height: 30, borderRadius: 8, cursor: 'pointer', flexShrink: 0,
                    background: editAmt === ti ? 'rgba(201,168,76,0.18)' : 'rgba(255,255,255,0.06)',
                    border: '0.5px solid rgba(255,255,255,0.14)', color: 'var(--gold)', fontSize: 14 }}>
                  ✎
                </button>
              </div>
            </div>
            {editAmt === ti && (
              <AmountEditor
                current={t.amount}
                original={t.original}
                onApply={v => { setOverrides(prev => ({ ...prev, [ti]: v })); setEditAmt(null) }}
                onReset={() => { setOverrides(prev => { const n = { ...prev }; delete n[ti]; return n }); setEditAmt(null) }}
                onCancel={() => setEditAmt(null)}
              />
            )}
            {pix ? (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button type="button" style={smallBtn(true)} onClick={() => setQrIdx(ti)}>▦ QR</button>
                <button type="button" style={smallBtn()} onClick={() => copy(payloadFor(t), `c${ti}`)}>
                  {copied === `c${ti}` ? '✓ Copiado' : '📋 Copia e Cola'}
                </button>
                <button type="button" style={smallBtn()} onClick={() => shareOne(t)}>WhatsApp</button>
              </div>
            ) : editing === t.to ? (
              <PixKeyForm
                title={t.to === meIndex ? 'Sua chave PIX' : `Chave PIX de ${players[t.to].name}`}
                onCancel={() => setEditing(null)}
                onSave={async (type, key) => {
                  const err = await saveKey(t.to, type, key)
                  if (!err) setEditing(null)
                  return err
                }}
              />
            ) : (
              <button type="button" onClick={() => setEditing(t.to)}
                style={{ ...smallBtn(), marginTop: 8, width: '100%' }}
                disabled={t.to !== meIndex && !!loadError}>
                ＋ Cadastrar chave PIX de {t.to === meIndex ? 'você' : players[t.to].name}
              </button>
            )}
          </div>
        )
      })}

      {loadError && (
        <p style={{ fontSize: 11, color: 'var(--red, #e05555)', marginTop: 8 }}>⚠️ {loadError}</p>
      )}

      <button type="button" className="btn-secondary" onClick={shareAll} style={{ marginTop: 12, marginBottom: 0 }}>
        📲 Mandar o acerto completo no WhatsApp
      </button>
      <p style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8, lineHeight: 1.5 }}>
        O app só monta o código PIX — o pagamento acontece no app do banco de quem paga. Confira o nome do recebedor antes de confirmar.
      </p>

      {qrFor && (
        <PixQrModal
          payer={players[qrFor.from].name}
          receiver={players[qrFor.to].name}
          pix={pixOf(qrFor.to)}
          amount={qrFor.amount}
          original={qrFor.original}
          payload={payloadFor(qrFor)}
          onCopy={() => copy(payloadFor(qrFor), 'modal')}
          copied={copied === 'modal'}
          onShare={() => shareOne(qrFor)}
          onClose={() => setQrIdx(null)}
        />
      )}
    </div>
  )
}

function smallBtn(primary) {
  return {
    flex: 1, padding: '8px 6px', borderRadius: 8, cursor: 'pointer',
    fontFamily: 'var(--sans)', fontSize: 12, fontWeight: 700,
    background: primary ? 'var(--gold)' : 'rgba(255,255,255,0.06)',
    color: primary ? '#0a140c' : 'var(--cream)',
    border: `0.5px solid ${primary ? 'var(--gold)' : 'rgba(255,255,255,0.14)'}`,
  }
}

function PixQrModal({ payer, receiver, pix, amount, original, payload, onCopy, copied, onShare, onClose }) {
  const [img, setImg] = useState(null)
  useEffect(() => {
    if (!payload) return
    QRCode.toDataURL(payload, { margin: 1, width: 280, errorCorrectionLevel: 'M' })
      .then(setImg).catch(err => console.error('Erro ao gerar QR:', err))
  }, [payload])

  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 100, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#101a30', border: '1px solid rgba(201,168,76,0.35)', borderRadius: 16,
        padding: 20, width: '100%', maxWidth: 340, textAlign: 'center',
      }}>
        <div style={{ fontSize: 12, color: 'var(--muted2)' }}>{payer} paga a</div>
        <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--cream)', marginTop: 2 }}>{receiver}</div>
        <div style={{ fontFamily: 'var(--serif)', fontSize: 30, fontWeight: 700, color: 'var(--gold)', margin: '6px 0 12px' }}>
          {amount == null ? 'Valor livre' : fmtReais(amount)}
        </div>
        {amount == null && (
          <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: -8, marginBottom: 12 }}>
            Quem paga digita o valor no banco (acerto calculado: {fmtReais(original)})
          </div>
        )}
        <div style={{ background: '#fff', borderRadius: 12, padding: 10, display: 'inline-block' }}>
          {img ? <img src={img} alt="QR code PIX" style={{ width: 240, height: 240, display: 'block' }}/>
               : <div style={{ width: 240, height: 240 }}/>}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted2)', marginTop: 10 }}>
          Chave: {displayPixKey(pix?.type, pix?.key)}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 14 }}>
          <button type="button" style={smallBtn(true)} onClick={onCopy}>{copied ? '✓ Copiado' : '📋 Copia e Cola'}</button>
          <button type="button" style={smallBtn()} onClick={onShare}>WhatsApp</button>
        </div>
        <button type="button" onClick={onClose}
          style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--muted2)', fontSize: 13, cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--sans)' }}>
          Fechar
        </button>
      </div>
    </div>
  )
}

// Ajuste manual do valor de uma transferência: valor novo, QR sem valor
// (quem paga digita no banco) ou voltar ao valor calculado.
function AmountEditor({ current, original, onApply, onReset, onCancel }) {
  const [raw, setRaw] = useState(current == null ? '' : current.toFixed(2).replace('.', ','))
  const [error, setError] = useState('')

  const apply = () => {
    // Aceita "130", "130,5", "1.234,56" ou "130.50"
    let t = raw.trim().replace(/\s|R\$/g, '')
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
    const v = Math.round(Number(t) * 100) / 100
    if (!t || !isFinite(v) || v <= 0) { setError('Digite um valor maior que zero.'); return }
    if (v > 999999) { setError('Valor alto demais.'); return }
    onApply(v)
  }

  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, marginBottom: 8 }}>
        Ajustar valor <span style={{ color: 'var(--muted2)', fontWeight: 400 }}>· calculado: {fmtReais(original)}</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ color: 'var(--muted2)', fontSize: 14 }}>R$</span>
        <input value={raw} inputMode="decimal" autoFocus
          onChange={e => { setRaw(e.target.value); setError('') }}
          onKeyDown={e => { if (e.key === 'Enter') apply() }}
          placeholder="0,00"
          style={{ flex: 1, minWidth: 0, background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.12)',
            borderRadius: 8, color: 'var(--gold)', fontFamily: 'var(--serif)', fontSize: 18, fontWeight: 700, padding: '7px 10px' }}/>
        <button type="button" style={{ ...smallBtn(true), flex: '0 0 auto', padding: '9px 14px' }} onClick={apply}>OK</button>
      </div>
      {error && <div style={{ fontSize: 11, color: 'var(--red, #e05555)', marginTop: 6 }}>⚠️ {error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button type="button" style={smallBtn()} onClick={() => onApply(null)}>QR sem valor</button>
        <button type="button" style={smallBtn()} onClick={onReset}>Voltar ao calculado</button>
        <button type="button" style={smallBtn()} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  )
}

// Formulário de chave PIX (tipo + chave) — usado aqui e no Perfil.
export function PixKeyForm({ title, initialType = 'phone', initialKey = '', onSave, onCancel, saveLabel = 'Salvar chave' }) {
  const [type,   setType]   = useState(initialType || 'phone')
  const [raw,    setRaw]    = useState(initialKey || '')
  const [error,  setError]  = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    const { key, error: e } = normalizePixKey(type, raw)
    if (!key) { setError(e); return }
    setSaving(true); setError('')
    const err = await onSave(type, key)
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '0.5px solid rgba(255,255,255,0.1)' }}>
      {title && <div style={{ fontSize: 11, color: 'var(--gold)', fontWeight: 700, marginBottom: 8 }}>{title}</div>}
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
        {PIX_TYPES.map(t => (
          <button key={t.id} type="button" onClick={() => { setType(t.id); setError('') }}
            className={`toggle-btn${type === t.id ? ' active' : ''}`}
            style={{ flex: 1, padding: '6px 4px', fontSize: 11, minWidth: 64 }}>
            {t.label}
          </button>
        ))}
      </div>
      <input
        value={raw}
        onChange={e => { setRaw(e.target.value); setError('') }}
        placeholder={PIX_TYPES.find(t => t.id === type)?.placeholder}
        inputMode={type === 'cpf' || type === 'phone' ? 'numeric' : type === 'email' ? 'email' : 'text'}
        autoCapitalize="none" autoCorrect="off"
        style={{
          width: '100%', background: 'rgba(0,0,0,0.3)', border: '0.5px solid rgba(255,255,255,0.12)',
          borderRadius: 8, color: 'var(--cream)', fontFamily: 'var(--sans)', fontSize: 14, padding: '9px 10px',
        }}
      />
      {error && <div style={{ fontSize: 11, color: 'var(--red, #e05555)', marginTop: 6 }}>⚠️ {error}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button type="button" style={smallBtn(true)} onClick={submit} disabled={saving}>
          {saving ? 'Salvando...' : saveLabel}
        </button>
        {onCancel && <button type="button" style={smallBtn()} onClick={onCancel}>Cancelar</button>}
      </div>
    </div>
  )
}
