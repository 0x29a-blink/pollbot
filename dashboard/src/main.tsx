// Copyright (c) 2026 Simple Solutions.
// Licensed under the PolyForm Shield License 1.0.0. See dashboard/LICENSE and dashboard/NOTICE for details.

import '@fontsource-variable/inter/index.css'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

async function boot() {
  // Dev-only API mock for previews and screenshots: `VITE_MOCK_API=1 npm run dev`.
  // `import.meta.env.DEV` is statically false in production builds, so this
  // branch and the mock module are dropped from the bundle.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === '1') {
    const { installMockApi } = await import('./dev/mockApi')
    installMockApi()
  }

  // Note: StrictMode removed to prevent double OAuth callbacks
  createRoot(document.getElementById('root')!).render(<App />)
}

void boot()
