import { HashRouter, Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import HomePage from './pages/HomePage'
import ConfigPage from './pages/ConfigPage'
import SearchByIdPage from './pages/SearchByIdPage'
import SearchByAuthorPage from './pages/SearchByAuthorPage'
import SearchByTitlePage from './pages/SearchByTitlePage'
import FullDownloadPage from './pages/FullDownloadPage'
import DividedDownloadPage from './pages/DividedDownloadPage'
import PictureDownloadPage from './pages/PictureDownloadPage'

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/config" element={<ConfigPage />} />
          <Route path="/search/id" element={<SearchByIdPage />} />
          <Route path="/search/author" element={<SearchByAuthorPage />} />
          <Route path="/search/title" element={<SearchByTitlePage />} />
          <Route path="/download/full" element={<FullDownloadPage />} />
          <Route path="/download/divided" element={<DividedDownloadPage />} />
          <Route path="/download/pictures" element={<PictureDownloadPage />} />
        </Route>
      </Routes>
    </HashRouter>
  )
}
