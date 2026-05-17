import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import { getPreset } from './config/presets'
import { fetchCategoryTree, validateLayerCategories } from './services/categoryTree'
import { layerConfigs } from './config/layers'
import { AuthGate } from './components/Admin/AuthGate'
import { AdminShell, AdminHome } from './components/Admin/AdminShell'
import { CategoryTreeEditor } from './components/Admin/CategoryTreeEditor'

// Kick off the category tree fetch at app start so it's likely cached
// by the time the user opens the sidebar. Components reading the tree
// (via useCategoryTree) get the fallback synchronously, then upgrade
// to the live tree once this resolves.
fetchCategoryTree().then((tree) => {
  if (import.meta.env.DEV) {
    validateLayerCategories(tree.tree, layerConfigs)
  }
})

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
        <Route
          path="/admin"
          element={
            <AuthGate>
              <AdminShell />
            </AuthGate>
          }
        >
          <Route index element={<AdminHome />} />
          <Route path="categories" element={<CategoryTreeEditor />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
