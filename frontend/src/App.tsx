import { Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { AuthPage } from '@/pages/AuthPage'
import { Home } from '@/pages/Home'
import { NotFound } from '@/pages/NotFound'
import { ToolRoute } from '@/pages/ToolRoute'
import { TOOLS, toolById } from '@/lib/tools'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* the home page IS the Edit PDF page (also reachable at /edit); the full directory of tools lives at /tools */}
        <Route index element={<ToolRoute tool={toolById('edit-pdf')!} />} />
        <Route path="/tools" element={<Home />} />
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="register" />} />
        {TOOLS.map((t) => (
          <Route key={t.id} path={t.route} element={<ToolRoute tool={t} />} />
        ))}
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  )
}
