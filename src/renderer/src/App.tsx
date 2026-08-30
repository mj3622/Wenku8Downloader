import { HashRouter, Navigate, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import SearchPage from './pages/SearchPage'
import DiscoverPage from './pages/DiscoverPage'
import RankingPage from './pages/RankingPage'
import BookDetailPage from './pages/BookDetailPage'
import DownloadHistoryPage from './pages/DownloadHistoryPage'
import BookshelfPage from './pages/BookshelfPage'
import ConfigPage from './pages/ConfigPage'
import NotFoundPage from './pages/NotFoundPage'
import ToastViewport from './components/ToastViewport'
import GlobalErrorListener from './components/GlobalErrorListener'
import DownloadStateListener from './components/DownloadStateListener'

export default function App() {
  return (
    <>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<Navigate to="/discover" replace />} />
            <Route path="/about" element={<HomePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/discover" element={<DiscoverPage />} />
            <Route path="/discover/ranking/:type" element={<RankingPage />} />
            <Route path="/book/:id" element={<BookDetailPage />} />
            <Route path="/bookshelf" element={<BookshelfPage />} />
            <Route path="/download" element={<DownloadHistoryPage />} />
            <Route path="/config" element={<ConfigPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Routes>
      </HashRouter>
      <ToastViewport />
      <GlobalErrorListener />
      <DownloadStateListener />
    </>
  )
}
