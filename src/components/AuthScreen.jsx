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

  const handleGoogle = async () => {
    setLoading(true); setError('')
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin }
    })
    if (e) err(e.message)
  }

  const handleApple = async () => {
    setLoading(true); setError('')
    const { error: e } = await supabase.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo: window.location.origin }
    })
    if (e) err(e.message)
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
      <h1 className="auth-title">Nassau<span>App</span></h1>
      <p className="auth-sub">Golfe com Nassau & Press</p>

      <button className="oauth-btn" onClick={handleGoogle} disabled={loading}>
        <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#4285F4" d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z"/><path fill="#34A853" d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z"/><path fill="#FBBC05" d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z"/><path fill="#EA4335" d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z"/></svg>
        Entrar com Google
      </button>

      <button className="oauth-btn" onClick={handleApple} disabled={loading}>
        <svg width="18" height="18" viewBox="0 0 814 1000"><path fill="var(--cream)" d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-37.3-165.8-127.3C46 482.2 1 351.9 1 226.2c0-200.9 130.4-307.6 258.5-307.6 70.4 0 128.8 45.4 172 45.4 41.3 0 106.1-47.7 186.3-47.7zm-41.3-238c32 0 57.3 25.3 57.3 57.3 0 31.6-21.5 51.3-52.6 51.3C716.6 211.5 693 187 693 156c0-31.4 25.4-53.1 53.8-53.1z"/></svg>
        Entrar com Apple
      </button>

      <div className="auth-divider">ou com email</div>

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
