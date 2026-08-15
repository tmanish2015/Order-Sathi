import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import * as fabric from 'fabric'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/AuthContext'
import { useToast } from '../lib/Toast'
import { reportError } from '../lib/errors'

const CANVAS_W = 1080
const CANVAS_H = 1080
const COLORS = ['#1e1b4b', '#dc2626', '#16a34a', '#2563eb', '#eab308', '#ffffff', '#000000']

export default function CreativeStudio() {
  const { id } = useParams<{ id: string }>()
  const isNew = !id || id === 'new'
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { showError, showSuccess } = useToast()

  const canvasElRef = useRef<HTMLCanvasElement>(null)
  const fabricRef = useRef<fabric.Canvas | null>(null)
  const [name, setName] = useState('Untitled creative')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(isNew)

  const orgId = profile?.organization_id

  // Init fabric canvas once.
  useEffect(() => {
    if (!canvasElRef.current) return
    const canvas = new fabric.Canvas(canvasElRef.current, {
      width: CANVAS_W,
      height: CANVAS_H,
      backgroundColor: '#ffffff',
    })
    fabricRef.current = canvas
    return () => {
      canvas.dispose()
      fabricRef.current = null
    }
  }, [])

  // Load existing creative once canvas exists.
  useEffect(() => {
    if (isNew || !id) return
    const canvas = fabricRef.current
    if (!canvas) return
    supabase
      .from('creatives')
      .select('*')
      .eq('id', id)
      .single()
      .then(({ data, error }) => {
        if (error || !data) {
          reportError(showError, 'Load creative', error ?? { message: 'not found' }, orgId, profile?.id)
          navigate('/studio')
          return
        }
        setName(data.name)
        canvas.loadFromJSON(data.canvas_data as object).then(() => {
          canvas.renderAll()
          setLoaded(true)
        })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isNew])

  function addText() {
    const canvas = fabricRef.current
    if (!canvas) return
    const text = new fabric.Textbox('Your text here', {
      left: 100,
      top: 100,
      fontSize: 48,
      fill: '#1e1b4b',
      fontFamily: 'Arial',
      width: 400,
    })
    canvas.add(text)
    canvas.setActiveObject(text)
    canvas.renderAll()
  }

  function addRect() {
    const canvas = fabricRef.current
    if (!canvas) return
    const rect = new fabric.Rect({ left: 150, top: 150, width: 200, height: 140, fill: '#2563eb' })
    canvas.add(rect)
    canvas.setActiveObject(rect)
    canvas.renderAll()
  }

  function addCircle() {
    const canvas = fabricRef.current
    if (!canvas) return
    const circle = new fabric.Circle({ left: 150, top: 150, radius: 90, fill: '#16a34a' })
    canvas.add(circle)
    canvas.setActiveObject(circle)
    canvas.renderAll()
  }

  function setColor(color: string) {
    const canvas = fabricRef.current
    const obj = canvas?.getActiveObject()
    if (!obj) return
    obj.set('fill', color)
    canvas?.renderAll()
  }

  function deleteSelected() {
    const canvas = fabricRef.current
    const obj = canvas?.getActiveObject()
    if (!canvas || !obj) return
    canvas.remove(obj)
    canvas.renderAll()
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    const canvas = fabricRef.current
    if (!file || !canvas) return
    const url = URL.createObjectURL(file)
    fabric.FabricImage.fromURL(url).then((img) => {
      img.scaleToWidth(300)
      img.set({ left: 100, top: 100 })
      canvas.add(img)
      canvas.setActiveObject(img)
      canvas.renderAll()
    })
    e.target.value = ''
  }

  async function save() {
    const canvas = fabricRef.current
    if (!canvas || !orgId) return
    setSaving(true)

    const thumbDataUrl = canvas.toDataURL({ format: 'png', multiplier: 0.25 })
    const thumbBlob = await (await fetch(thumbDataUrl)).blob()
    const thumbPath = `${orgId}/${crypto.randomUUID()}.png`
    const { error: uploadError } = await supabase.storage.from('creative-assets').upload(thumbPath, thumbBlob, {
      contentType: 'image/png',
    })
    if (uploadError) {
      reportError(showError, 'Save creative (thumbnail upload)', uploadError, orgId, profile?.id)
      setSaving(false)
      return
    }
    const { data: pub } = supabase.storage.from('creative-assets').getPublicUrl(thumbPath)

    const canvasData = canvas.toJSON()

    if (isNew) {
      const { data, error } = await supabase
        .from('creatives')
        .insert({
          organization_id: orgId,
          name,
          canvas_data: canvasData,
          width: CANVAS_W,
          height: CANVAS_H,
          thumbnail_url: pub.publicUrl,
          created_by: profile?.id,
        })
        .select()
        .single()
      setSaving(false)
      if (error || !data) {
        reportError(showError, 'Save creative', error ?? { message: 'insert returned no row' }, orgId, profile?.id)
        return
      }
      showSuccess('Creative saved.')
      navigate(`/studio/${data.id}`, { replace: true })
    } else {
      const { error } = await supabase
        .from('creatives')
        .update({ name, canvas_data: canvasData, thumbnail_url: pub.publicUrl, updated_at: new Date().toISOString() })
        .eq('id', id)
      setSaving(false)
      if (error) {
        reportError(showError, 'Save creative', error, orgId, profile?.id)
        return
      }
      showSuccess('Creative saved.')
    }
  }

  function exportPng() {
    const canvas = fabricRef.current
    if (!canvas) return
    const dataUrl = canvas.toDataURL({ format: 'png', multiplier: 1 })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${name.replace(/\s+/g, '_')}.png`
    a.click()
  }

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto">
      <Link to="/studio" className="text-xs text-indigo-600 hover:underline">
        ← All creatives
      </Link>

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2 mb-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="text-lg font-semibold text-slate-900 bg-transparent border-b border-transparent hover:border-slate-300 focus:border-indigo-500 outline-none"
        />
        <div className="flex gap-2">
          <button onClick={exportPng} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
            Export PNG
          </button>
          <button
            onClick={save}
            disabled={saving || !loaded}
            className="text-sm rounded-lg bg-indigo-600 text-white px-3 py-1.5 hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex lg:flex-col gap-2 bg-white rounded-xl border border-slate-200 p-3 lg:w-44 shrink-0">
          <button onClick={addText} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 text-left">
            + Text
          </button>
          <button onClick={addRect} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 text-left">
            + Rectangle
          </button>
          <button onClick={addCircle} className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 text-left">
            + Circle
          </button>
          <label className="text-sm rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-50 text-left cursor-pointer">
            + Image
            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
          </label>
          <div className="border-t border-slate-100 my-1" />
          <div className="text-xs text-slate-400 px-1">Fill color</div>
          <div className="flex lg:flex-wrap gap-1.5 px-1">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="w-6 h-6 rounded-full border border-slate-300"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
          <div className="border-t border-slate-100 my-1" />
          <button onClick={deleteSelected} className="text-sm rounded-lg border border-red-200 text-red-600 px-3 py-1.5 hover:bg-red-50 text-left">
            Delete selected
          </button>
        </div>

        <div className="flex-1 bg-slate-100 rounded-xl p-4 overflow-auto flex items-center justify-center">
          <div className="shadow-lg" style={{ width: CANVAS_W / 2, height: CANVAS_H / 2 }}>
            <canvas ref={canvasElRef} style={{ width: CANVAS_W / 2, height: CANVAS_H / 2 }} />
          </div>
        </div>
      </div>
    </div>
  )
}
