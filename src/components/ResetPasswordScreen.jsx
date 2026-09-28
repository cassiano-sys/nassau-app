import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Tela mostrada quando o usuário chega pelo link de "recuperar senha" do
// email. O Supabase já autentica com uma sessão temporária de recuperação
// (evento PASSWORD_RECOVERY em onAuthStateChange, tratado no App.jsx) - aqui
// só falta deixar a pessoa escolher a senha nova antes de seguir pro app.
export default function ResetPasswordScreen({ onDone }) {
  const [password, setPassword]   = useState('')
  const [confirm, setConfirm]     = useState('')
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [done, setDone]           = useState(false)

  const handleSubmit = async () => {
    setError('')
    if (password.length < 6) return setError('A senha precisa ter pelo menos 6 caracteres.')
    if (password !== confirm) return setError('As senhas digitadas não são iguais.')
    setLoading(true)
    const { error: e } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (e) return setError(e.message)
    setDone(true)
  }

  if (done) return (
    <div className="auth-screen">
      <div className="auth-logo">✅</div>
      <h1 className="auth-title">Senha <span>atualizada</span></h1>
      <p style={{ color:'var(--muted)', textAlign:'center', lineHeight:1.8, marginBottom: 20 }}>
        Sua senha foi alterada com sucesso.
      </p>
      <button className="btn-primary" onClick={onDone}>Continuar</button>
    </div>
  )

  return (
    <div className="auth-screen">
      <div className="auth-logo">🔑</div>
      <h1 className="auth-title">Escolha uma <span>senha nova</span></h1>

      <div style={{ marginBottom: 10 }}>
        <div className="field-label">Nova senha</div>
        <input className="text-input" type="password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)}/>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="field-label">Confirme a nova senha</div>
        <input className="text-input" type="password" placeholder="Repita a senha" value={confirm} onChange={e => setConfirm(e.target.value)}/>
      </div>

      <button className="btn-primary" onClick={handleSubmit} disabled={loading || !password || !confirm}>
        {loading ? '...' : 'Salvar nova senha'}
      </button>

      {error && <p className="auth-error">{error}</p>}
    </div>
  )
}
