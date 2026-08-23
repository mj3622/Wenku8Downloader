import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { installRendererErrorReporter } from './logging/error-reporter'

installRendererErrorReporter(window, window.electronAPI.reportRendererError)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
