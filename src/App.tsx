import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ToastProvider } from './lib/Toast'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'

const Orders = lazy(() => import('./pages/Orders'))
const Inventory = lazy(() => import('./pages/Inventory'))
const SkuMapping = lazy(() => import('./pages/SkuMapping'))
const Warehouses = lazy(() => import('./pages/Warehouses'))
const Grn = lazy(() => import('./pages/Grn'))
const Picklist = lazy(() => import('./pages/Picklist'))
const Packing = lazy(() => import('./pages/Packing'))
const Shipping = lazy(() => import('./pages/Shipping'))
const Ndr = lazy(() => import('./pages/Ndr'))
const Putaway = lazy(() => import('./pages/Putaway'))
const StockTransfer = lazy(() => import('./pages/StockTransfer'))
const CycleCount = lazy(() => import('./pages/CycleCount'))
const Customers = lazy(() => import('./pages/Customers'))
const Forecast = lazy(() => import('./pages/Forecast'))
const BatchSerial = lazy(() => import('./pages/BatchSerial'))
const Invoices = lazy(() => import('./pages/Invoices'))
const Reconciliation = lazy(() => import('./pages/Reconciliation'))
const Returns = lazy(() => import('./pages/Returns'))
const Profit = lazy(() => import('./pages/Profit'))
const Reports = lazy(() => import('./pages/Reports'))
const SyncLogs = lazy(() => import('./pages/SyncLogs'))
const Integrations = lazy(() => import('./pages/Integrations'))
const Team = lazy(() => import('./pages/Team'))

function PageFallback() {
  return <div className="p-6 text-sm text-slate-400">Loading…</div>
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <AuthProvider>
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route element={<Layout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/orders" element={<Orders />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/sku-mapping" element={<SkuMapping />} />
              <Route path="/warehouses" element={<Warehouses />} />
              <Route path="/grn" element={<Grn />} />
              <Route path="/picklist" element={<Picklist />} />
              <Route path="/packing" element={<Packing />} />
              <Route path="/shipping" element={<Shipping />} />
              <Route path="/ndr" element={<Ndr />} />
              <Route path="/putaway" element={<Putaway />} />
              <Route path="/stock-transfer" element={<StockTransfer />} />
              <Route path="/cycle-count" element={<CycleCount />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/forecast" element={<Forecast />} />
              <Route path="/batch-serial" element={<BatchSerial />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/reconciliation" element={<Reconciliation />} />
              <Route path="/returns" element={<Returns />} />
              <Route path="/profit" element={<Profit />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/sync-logs" element={<SyncLogs />} />
              <Route path="/integrations" element={<Integrations />} />
              <Route path="/team" element={<Team />} />
            </Route>
          </Routes>
        </Suspense>
      </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
