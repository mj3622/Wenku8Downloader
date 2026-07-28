import { useEffect, useState, type ReactNode } from 'react'
import { Route, Router, Switch } from 'wouter'
import { useHashLocation } from 'wouter/use-hash-location'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import BookDetailPage from './pages/BookDetailPage'
import DownloadHistoryPage from './pages/DownloadHistoryPage'
import ConfigPage from './pages/ConfigPage'
import AdminLoginPage from './pages/AdminLoginPage'
import { api } from './api/client'

export default function App() {
  return (
    <AuthGate>
      <AppRoutes />
    </AuthGate>
  )
}

function AppRoutes() {
  return (
    <Router hook={useHashLocation}>
      <Layout>
        <Switch>
          <Route path="/" component={HomePage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/book/:id" component={BookDetailPage} />
          <Route path="/download" component={DownloadHistoryPage} />
          <Route path="/config" component={ConfigPage} />
          <Route component={HomePage} />
        </Switch>
      </Layout>
    </Router>
  )
}

function AuthGate({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState<boolean | null>(
    api.target === 'electron' ? true : null,
  )

  useEffect(() => {
    if (api.target === 'electron') return
    api.getAuthSession()
      .then((session) => setAuthenticated(session.authenticated))
      .catch(() => setAuthenticated(false))
    const handleExpired = () => setAuthenticated(false)
    window.addEventListener('wenku8-session-expired', handleExpired)
    return () => window.removeEventListener('wenku8-session-expired', handleExpired)
  }, [])

  useEffect(() => {
    if (authenticated) api.connectEvents()
  }, [authenticated])

  if (authenticated === null) {
    return <div className="min-h-screen bg-apple-bg" />
  }
  if (!authenticated) {
    return <AdminLoginPage onLogin={() => setAuthenticated(true)} />
  }
  return children
}
