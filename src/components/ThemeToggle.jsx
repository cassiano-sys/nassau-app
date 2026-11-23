import { useState } from 'react'
import { getTheme, toggleTheme } from '../lib/theme'

// Botão flutuante de alternância claro/escuro. Fica disponível em qualquer
// tela onde for montado (ver instruções de integração no App.jsx).
export default function ThemeToggle() {
  const [theme, setThemeState] = useState(getTheme())

  function handleClick() {
    setThemeState(toggleTheme())
  }

  return (
    <button
      className="theme-toggle-btn"
      onClick={handleClick}
      aria-label={theme === 'dark' ? 'Mudar para modo claro' : 'Mudar para modo escuro'}
      title={theme === 'dark' ? 'Modo claro' : 'Modo escuro'}
    >
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  )
}
