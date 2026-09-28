import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function AuthScreen({ onAuth }) {
  const [mode, setMode]       = useState('login') // login | signup | forgot
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)
  const [resetSent, setResetSent] = useState(false)

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

  // Envia o link de redefinição de senha por email. Antes disso não existia
  // NENHUM caminho para quem esquecesse a senha - ficava sem acesso à conta
  // sem depender de alguém mexer direto no banco por ele.
  const handleForgotPassword = async () => {
    if (!email) return err('Digite seu email acima primeiro.')
    setLoading(true); setError('')
    const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (e) return err(e.message)
    setResetSent(true)
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

  if (resetSent) return (
    <div className="auth-screen">
      <div className="auth-logo">📧</div>
      <h1 className="auth-title">Verifique seu <span>email</span></h1>
      <p style={{ color:'var(--muted)', textAlign:'center', lineHeight:1.8 }}>
        Enviamos um link para redefinir sua senha para<br/>
        <strong style={{ color:'var(--cream)' }}>{email}</strong><br/>
        Clique no link para escolher uma nova senha.
      </p>
      <button className="auth-link" style={{ marginTop: 16 }} onClick={() => { setResetSent(false); setMode('login') }}>
        ← Voltar para o login
      </button>
    </div>
  )

  if (mode === 'forgot') return (
    <div className="auth-screen">
      <div className="auth-logo">🔑</div>
      <h1 className="auth-title">Recuperar <span>senha</span></h1>
      <p style={{ color:'var(--muted)', textAlign:'center', lineHeight:1.6, marginBottom: 16, fontSize: 13 }}>
        Digite o email da sua conta. Vamos te mandar um link para escolher uma senha nova.
      </p>

      <div style={{ marginBottom: 16 }}>
        <div className="field-label">Email</div>
        <input className="text-input" type="email" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)}/>
      </div>

      <button className="btn-primary" onClick={handleForgotPassword} disabled={loading || !email}>
        {loading ? '...' : 'Enviar link de recuperação'}
      </button>

      {error && <p className="auth-error">{error}</p>}

      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>
        <button className="auth-link" onClick={() => { setMode('login'); setError('') }}>
          ← Voltar para o login
        </button>
      </div>
    </div>
  )

  return (
    <div className="auth-screen">
      {/* Antes era o emoji ⛳ aqui - a primeira tela que qualquer pessoa nova
          vê no app. Só que o mascote (flamingo) é o elemento de marca usado
          no splash, na tela de resultado e no site - deixando a bandeirinha
          só na entrada quebrava a identidade logo no primeiro contato. */}
      <img className="auth-logo-img" src="/mascot/retrato.jpg" alt=""/>
      <h1 className="auth-title">Caddie<span>Stakes</span></h1>
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

      {mode === 'login' && (
        <div style={{ textAlign: 'center', marginTop: 10 }}>
          <button className="auth-link" style={{ fontSize: 12 }} onClick={() => { setMode('forgot'); setError('') }}>
            Esqueci minha senha
          </button>
        </div>
      )}

      <div style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: 'var(--muted)' }}>
        {mode === 'login' ? 'Não tem conta? ' : 'Já tem conta? '}
        <button className="auth-link" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}>
          {mode === 'login' ? 'Criar conta' : 'Entrar'}
        </button>
      </div>
    </div>
  )
}
