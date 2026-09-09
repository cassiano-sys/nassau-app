import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthScreen({ onAuth }) {
  const [mode, setMode]       = useState('login') // login | signup
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)

  const err = (msg) => { setError(msg); setLoading(false) }

  const handleEmail = async () => {
    setLoading(true); setError('')
    if (mode === 'signup') {
      const { error: e } = await supabase.auth.signUp({
        email, password,
        options: { data: { full_name: name } }
      })
      if (e) return err(e.message)
      setSent(true)
    } else {
      const { data, error: e } = await supabase.auth.signInWithPassword({ email, password })
      if (e) return err(e.message)
      onAuth(data.session)
    }
    setLoading(false)
  }

  if (sent) return (
    <div className="auth-screen">
      <div className="auth-logo">📧</div>
      <h1 className="auth-title">Verifique seu <span>email</span></h1>
      <p style={{ color:'var(--muted)', textAlign:'center', lineHeight:1.8 }}>
        Enviamos um link de confirmação para<br/>
        <strong style={{ color:'var(--cream)' }}>{email}</strong><br/>
        Clique no link para ativar sua conta.
      </p>
    </div>
  )

  return (
    <div className="auth-screen">
      <div className="auth-logo">⛳</div>
      <h1 className="auth-title">Golf<span>Hustle</span></h1>
      <p className="auth-sub">Golfe com Nassau & Press</p>

      {mode === 'signup' && (
        <div style={{ marginBottom: 10 }}>
          <div className="field-label">Nome completo</div>
          <input className="text-input" placeholder="Seu nome" value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 0 }}/>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        <div className="field-label">Email</div>
        <input className="text-input" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)}/>
      </div>

      <div style={{ marginBottom: 16 }}>
        <div className="field-label">Senha</div>
        <input className="text-input" type="password" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)}/>
      </div>

      <button className="btn-primary" onClick={handleEmail} disabled={loading || !email || !password}>
        {loading ? '...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
      </button>

      {error && <p className="auth-error">{error}</p>}

      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>
        {mode === 'login' ? 'Não tem conta? ' : 'Já tem conta? '}
        <button className="auth-link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}>
          {mode === 'login' ? 'Criar conta' : 'Entrar'}
        </button>
      </div>
    </div>
  )
}
