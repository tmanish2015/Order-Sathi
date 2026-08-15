import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import { ToastProvider } from './lib/Toast'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Attention from './pages/Attention'
import Customers from './pages/Customers'
import CustomerDetail from './pages/CustomerDetail'
import Renewals from './pages/Renewals'
import Billing from './pages/Billing'
import Opportunities from './pages/Opportunities'
import Tasks from './pages/Tasks'
import Leads from './pages/Leads'
import Campaigns from './pages/Campaigns'
import Integrations from './pages/Integrations'
import Team from './pages/Team'
import Creatives from './pages/Creatives'
import CreativeStudio from './pages/CreativeStudio'
import VideoMaker from './pages/VideoMaker'

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Layout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/attention" element={<Attention />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/customers/:id" element={<CustomerDetail />} />
            <Route path="/renewals" element={<Renewals />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/opportunities" element={<Opportunities />} />
            <Route path="/tasks" element={<Tasks />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/team" element={<Team />} />
            <Route path="/studio" element={<Creatives />} />
            <Route path="/studio/:id" element={<CreativeStudio />} />
            <Route path="/video-maker" element={<VideoMaker />} />
          </Route>
        </Routes>
      </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
