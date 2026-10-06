import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import AuthScreen          from './components/AuthScreen'
import ResetPasswordScreen from './components/ResetPasswordScreen'
import HomeScreen          from './components/HomeScreen'
import SetupScreen         from './components/SetupScreen'
import ScorecardScreen     from './components/ScorecardScreen'
import PresentationScreen  from './components/PresentationScreen'
import { HistoryScreen, RankingScreen, ProfileScreen } from './components/HistoryScreen'
import BugReportButton     from './components/BugReportButton'
import { loadDraft }       from './lib/draft'

export default function App() {
  const [session,    setSession]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [screen,     setScreen]     = useState('home')
  const [gameConfig, setGameConfig] = useState(null)
  const [resumeDraft, setResumeDraft] = useState(null) // rodada em andamento sendo retomada
  // Quando o usuário clica no link de "recuperar senha" do email, o Supabase
  // abre uma sessão temporária e dispara o evento PASSWORD_RECOVERY (em vez
  // de um login normal). Sem tratar isso à parte, a pessoa cairia direto na
  // Home como se tivesse logado normalmente, sem nunca chegar a trocar a
  // senha de fato.
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <Splash />
  if (passwordRecovery) return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)}/>
  if (!session) return <AuthScreen onAuth={setSession} />

  const nav = (s) => setScreen(s)

  let content
  const resume = () => {
    const d = loadDraft(session.user.id)
    if (!d) return
    setGameConfig(d.config); setResumeDraft(d); nav('scorecard')
  }

  if (screen === 'setup')        content = <SetupScreen        onStart={cfg => { setResumeDraft(null); setGameConfig({ ...cfg, startedAt: new Date().toISOString() }); nav('scorecard') }} onBack={() => nav('home')} session={session}/>
  else if (screen === 'scorecard')    content = <ScorecardScreen    key={resumeDraft?.savedAt || gameConfig?.startedAt} config={gameConfig} initialDraft={resumeDraft} onFinish={s => { setResumeDraft(null); nav(s || 'home') }} onBack={() => { setResumeDraft(null); nav('home') }} session={session}/>
  else if (screen === 'presentation') content = <PresentationScreen onBack={() => nav('home')}/>
  else if (screen === 'history')      content = <HistoryScreen      onBack={() => nav('home')} session={session}/>
  else if (screen === 'ranking')      content = <RankingScreen      onBack={() => nav('home')} session={session}/>
  else if (screen === 'profile')      content = <ProfileScreen      onBack={() => nav('home')} session={session} onSignOut={() => { setSession(null); nav('home') }}/>
  else                                 content = <HomeScreen nav={nav} session={session} onResume={resume}/>

  // Botão flutuante de "relatar problema" — aparece em toda tela logada,
  // menos na Apresentação (tela em tela cheia, sem distrações, no fim da
  // rodada de premiação).
  const showBugButton = screen !== 'presentation'

  return (
    <>
      {content}
      {showBugButton && <BugReportButton session={session} screen={screen}/>}
    </>
  )
}

function Splash() {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      minHeight:'100vh', background:'#0d1a0f', color:'#c9a84c',
      fontFamily:"'Cormorant Garamond', Georgia, serif" }}>
      <img src="/mascot/retrato.jpg" alt="" style={{
        width: 96, height: 96, borderRadius: '50%', objectFit: 'cover',
        border: '2px solid #c9a84c', marginBottom: 18,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      }}/>
      <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 4 }}>Caddie<span style={{ color: '#c9a84c' }}>Stakes</span></div>
    </div>
  )
}
