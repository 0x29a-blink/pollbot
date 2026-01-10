import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Note: StrictMode removed to prevent double OAuth callbacks
createRoot(document.getElementById('root')!).render(<App />)
