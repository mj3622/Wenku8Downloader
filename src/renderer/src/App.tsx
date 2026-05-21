import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import BookDetailPage from './pages/BookDetailPage'
import DownloadHistoryPage from './pages/DownloadHistoryPage'
import ConfigPage from './pages/ConfigPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/book/:id" element={<BookDetailPage />} />
          <Route path="/download" element={<DownloadHistoryPage />} />
          <Route path="/config" element={<ConfigPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
