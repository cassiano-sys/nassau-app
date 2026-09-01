import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import AuthScreen          from './components/AuthScreen'
import HomeScreen          from './components/HomeScreen'
import SetupScreen         from './components/SetupScreen'
import ScorecardScreen     from './components/ScorecardScreen'
import PresentationScreen  from './components/PresentationScreen'
import { HistoryScreen, RankingScreen, ProfileScreen } from './components/HistoryScreen'

export default function App() {
  const [session,    setSession]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [screen,     setScreen]     = useState('home')
  const [gameConfig, setGameConfig] = useState(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <Splash />
  if (!session) return <AuthScreen onAuth={setSession} />

  const nav = (s) => setScreen(s)

  if (screen === 'setup')        return <SetupScreen        onStart={cfg => { setGameConfig(cfg); nav('scorecard') }} onBack={() => nav('home')} session={session}/>
  if (screen === 'scorecard')    return <ScorecardScreen    config={gameConfig} onFinish={s => nav(s || 'home')} onBack={() => nav('home')} session={session}/>
  if (screen === 'presentation') return <PresentationScreen onBack={() => nav('home')}/>
  if (screen === 'history')      return <HistoryScreen      onBack={() => nav('home')} session={session}/>
  if (screen === 'ranking')      return <RankingScreen      onBack={() => nav('home')} session={session}/>
  if (screen === 'profile')      return <ProfileScreen      onBack={() => nav('home')} session={session} onSignOut={() => { setSession(null); nav('home') }}/>

  return <HomeScreen nav={nav} session={session}/>
}

function Splash() {
  return (
    <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
      minHeight:'100vh', background:'#0d1a0f', color:'#c9a84c',
      fontFamily:"'Cormorant Garamond', Georgia, serif" }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>⛳</div>
      <div style={{ fontSize: 32, fontWeight: 700, letterSpacing: 4 }}>Nassau</div>
    </div>
  )
}
