import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ToastProvider } from './lib/Toast'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Inventory from './pages/Inventory'
import Invoices from './pages/Invoices'
import Reconciliation from './pages/Reconciliation'
import SyncLogs from './pages/SyncLogs'
import Integrations from './pages/Integrations'
import Team from './pages/Team'

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/inventory" element={<Inventory />} />
            <Route path="/invoices" element={<Invoices />} />
            <Route path="/reconciliation" element={<Reconciliation />} />
            <Route path="/sync-logs" element={<SyncLogs />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/team" element={<Team />} />
          </Route>
        </Routes>
      </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
