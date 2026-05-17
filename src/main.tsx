import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { getPreset } from './config/presets'

function PresetView() {
  const { presetName } = useParams<{ presetName: string }>();
  const preset = getPreset(presetName);
  return <App preset={preset} />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route path="/view/:presetName" element={<PresetView />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
