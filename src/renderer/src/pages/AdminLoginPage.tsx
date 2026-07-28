import { useState } from 'react'
import { api } from '../api/client'
import logoUrl from '../../../../resources/icon.png'

export default function AdminLoginPage({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!password || loading) return
    setLoading(true)
    setError(null)
    try {
      await api.login(password)
      onLogin()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-apple-bg flex items-center justify-center p-6">
      <div className="w-full max-w-sm rounded-2xl border border-apple-border-subtle bg-white p-7 shadow-card">
        <div className="flex items-center gap-3 mb-7">
          <img src={logoUrl} alt="" className="w-12 h-12" />
          <div>
            <h1 className="text-lg font-bold text-apple-heading">文库下载器</h1>
            <p className="text-xs text-apple-tertiary">私有服务器管理入口</p>
          </div>
        </div>

        <label className="block text-xs font-medium text-apple-secondary mb-1.5">
          管理员密码
        </label>
        <input
          autoFocus
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && void submit()}
          className="w-full px-4 py-2.5 bg-white border border-apple-border-input rounded-xl text-sm
                     focus:outline-none focus:border-apple-accent/30 focus:ring-2 focus:ring-apple-accent/10"
        />
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
        <button
          disabled={!password || loading}
          onClick={() => void submit()}
          className="mt-5 w-full px-5 py-2.5 rounded-[24px] bg-apple-accent text-white text-sm font-medium
                     hover:opacity-90 disabled:opacity-40 transition-opacity"
        >
          {loading ? '登录中...' : '登录'}
        </button>
      </div>
    </main>
  )
}
