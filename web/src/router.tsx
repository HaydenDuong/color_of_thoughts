import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { App } from './App'
import { WallPage } from './pages/WallPage'
import { QrPage } from './pages/QrPage'

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/wall" element={<WallPage />} />
        <Route path="/qr" element={<QrPage />} />
      </Routes>
    </BrowserRouter>
  )
}
