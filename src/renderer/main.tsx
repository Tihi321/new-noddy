import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/fredoka/latin-500.css'
import '@fontsource/fredoka/latin-600.css'
import '@fontsource/fredoka/latin-700.css'
import '@fontsource/nunito/latin-400.css'
import '@fontsource/nunito/latin-700.css'
import '@fontsource/nunito/latin-800.css'
import { App } from './App'
import { connectEngine } from './api'
import { installFakeEngine } from './demo/fake'
import './styles.css'

/** `?demo` (or no Electron preload) runs against the fake engine. `&speed=8` makes it run faster. */
const params = new URLSearchParams(window.location.search)
const demo = params.has('demo') || !window.toybox
if (demo) installFakeEngine(Number(params.get('speed') ?? '1') || 1)

// make sure the fonts are ready before Phaser draws its text
void Promise.all([document.fonts.load('500 20px Fredoka'), document.fonts.load('700 14px Nunito')]).catch(() => undefined)

connectEngine()
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App demo={demo} />
  </StrictMode>
)
