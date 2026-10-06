import { useState, useEffect } from 'react'
import { pendingInvite, inviteInfo } from '../lib/friends'
import { supabase } from '../lib/supabase'

// Versão dos Termos de Uso / Política de Privacidade vigente no momento do
// cadastro (mesma data mostrada em "Última atualização" nas duas páginas).
// Atualize este valor sempre que o conteúdo de termos.html ou privacidade.html
// mudar de forma relevante, para manter um registro de qual versão cada
// usuário aceitou.
const TERMS_VERSION = '2026-09'

// O Supabase devolve as mensagens de erro em inglês — traduz as mais comuns
// pra quem está criando conta ou entrando não ficar sem entender o problema.
function traduzErro(msg = '') {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Email ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'Seu email ainda não foi confirmado. Abra o link que enviamos (veja também a caixa de spam).'
  if (m.includes('already registered') || m.includes('already been registered')) return 'Este email já tem conta. Use "Entrar" ou "Esqueci minha senha".'
  if (m.includes('password should be at least') || m.includes('password is too short')) return 'A senha precisa ter pelo menos 6 caracteres.'
  if (m.includes('unable to validate email') || m.includes('invalid email') || m.includes('email address') && m.includes('invalid')) return 'Email inválido. Confira se digitou certo.'
  if (m.includes('rate limit') || m.includes('too many') || m.includes('security purposes')) return 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.'
  if (m.includes('error sending') || m.includes('sending confirmation') || m.includes('sending recovery')) return 'Não conseguimos enviar o email agora. Tente de novo em alguns minutos ou fale com o suporte.'
  if (m.includes('failed to fetch') || m.includes('network')) return 'Sem conexão com o servidor. Confira sua internet e tente de novo.'
  return msg
}

export default function AuthScreen({ onAuth }) {
  // Chegou por link de convite → abre direto em "Criar conta"
  const [invitedBy, setInvitedBy] = useState(null)
  const [mode, setMode]       = useState(() => pendingInvite() ? 'signup' : 'login') // login | signup | forgot
  const [nickname, setNickname] = useState('')
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [name, setName]       = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [sent, setSent]       = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const err = (msg) => { setError(traduzErro(msg)); setLoading(false) }

  useEffect(() => {
    const code = pendingInvite()
    if (code) inviteInfo(code).then(n => setInvitedBy(n || 'um amigo')).catch(() => {})
  }, [])

  const handleEmail = async () => {
    setLoading(true); setError('')
    if (mode === 'signup') {
      const { data, error: e } = await supabase.auth.signUp({
        email, password,
        options: { data: {
          full_name: name,
          nickname: (nickname.trim() || name.trim().split(' ')[0] || ''),
          terms_version: TERMS_VERSION,
          terms_accepted_at: new Date().toISOString(),
        } }
      })
      if (e) return err(e.message)
      // Com a confirmação de email DESLIGADA no Supabase, o cadastro já volta
      // com a sessão aberta — entra direto, sem mandar a pessoa esperar um
      // email que nunca vai chegar. Ligada, aí sim mostra "verifique seu email".
      if (data?.session) { setLoading(false); return onAuth(data.session) }
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

      {invitedBy && (
        <div style={{ width: '100%', background: 'rgba(201,168,76,0.1)', border: '0.5px solid var(--gold)', borderRadius: 10, padding: '10px 12px', marginBottom: 14, fontSize: 13, color: 'var(--cream)', lineHeight: 1.5, textAlign: 'center' }}>
          🤝 <strong>{invitedBy}</strong> te convidou. {mode === 'signup' ? 'Crie sua conta' : 'Entre na sua conta'} e vocês ficam conectados.
        </div>
      )}

      {mode === 'signup' && (
        <div style={{ marginBottom: 10 }}>
          <div className="field-label">Nome completo</div>
          <input className="text-input" placeholder="Seu nome" value={name} onChange={e => setName(e.target.value)} style={{ marginBottom: 0 }}/>
        </div>
      )}
      {mode === 'signup' && (
        <div style={{ marginBottom: 10 }}>
          <div className="field-label">Como você aparece no cartão</div>
          <input className="text-input" placeholder="Apelido ou nome + sobrenome (ex.: Paulo S.)" value={nickname} onChange={e => setNickname(e.target.value)} style={{ marginBottom: 0 }}/>
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

      {mode === 'signup' && (
        <p style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', lineHeight: 1.6, margin: '0 0 14px' }}>
          Ao criar sua conta, você concorda com os{' '}
          <a href="https://caddiestakesgolf.com/termos.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            Termos de Uso
          </a>{' '}
          e a{' '}
          <a href="https://caddiestakesgolf.com/privacidade.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--gold)' }}>
            Política de Privacidade
          </a>.
        </p>
      )}

      <button className="btn-primary" onClick={handleEmail} disabled={loading || !email || !password}>
        {loading ? '...' : mode === 'login' ? (invitedBy ? 'Entrar e aceitar convite' : 'Entrar') : (invitedBy ? 'Criar conta e aceitar' : 'Criar conta')}
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

