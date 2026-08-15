const INTEGRATIONS = [
  {
    name: 'Razorpay',
    purpose: 'Recurring billing — auto-charge, webhook sync, invoice generation',
    detail: 'Edge function razorpay-webhook is deployed and ready. Needs a live Razorpay account + API keys before subscriptions can auto-charge.',
  },
  {
    name: 'Meta (Facebook / Instagram)',
    purpose: 'Auto-post campaigns, connect client social accounts',
    detail: 'OAuth edge function meta-oauth is deployed. Needs a Meta Developer App (App ID + Secret) before "Connect Meta" will work.',
  },
  {
    name: 'Google Sign-In',
    purpose: 'One-click login for the team',
    detail: 'Google OAuth button is present on the login screen. Needs the Google provider enabled in Supabase Auth settings.',
  },
  {
    name: 'n8n',
    purpose: 'Dunning reminders (7d/3d/due-date), WhatsApp/email automation',
    detail: 'No workflow configured yet. Needs an n8n workflow watching subscriptions.next_due_date once the VPS/instance is ready.',
  },
  {
    name: 'Website lead form',
    purpose: 'Capture inbound leads from the real INSIGNIA website',
    detail: 'lead-capture edge function is live and accepts flexible field names. Needs the real form URL / field names to lock down the mapping.',
  },
  {
    name: 'Video rendering',
    purpose: 'Turn Video Maker templates into actual rendered video files',
    detail: 'Edge function generate-video is deployed and validates/saves every video request. Needs RENDER_API_KEY + RENDER_API_URL for a rendering provider (e.g. Shotstack, Creatomate) before videos actually render.',
  },
]

export default function Integrations() {
  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto">
      <h2 className="text-lg font-semibold text-slate-900 mb-1">Integrations</h2>
      <p className="text-xs text-slate-400 mb-6">
        The app runs fully on demo data without any of these. Nothing below blocks day-to-day use of the Control Centre.
      </p>

      <div className="space-y-3">
        {INTEGRATIONS.map((i) => (
          <div key={i.name} className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-slate-900">{i.name}</h3>
              <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-700">
                Integration Pending
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">{i.purpose}</p>
            <p className="text-xs text-slate-400 mt-2">{i.detail}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
