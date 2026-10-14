import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Layout } from '@/components/layout'
import { AppProvider } from '@/lib/app-context'
import { CampusDetailPage, CampusesPage } from '@/pages/campuses'
import { ChangeDetailPage, ChangesPage } from '@/pages/changes'
import { DepartmentDetailPage, DepartmentsPage } from '@/pages/departments'
import { DesignPage } from '@/pages/design'
import { InstitutionDetailPage, InstitutionsPage } from '@/pages/institutions'
import { PlannedPage } from '@/pages/planned'
import { ServiceUnitsPage } from '@/pages/service-unit-list'
import { ServiceUnitDetailPage } from '@/pages/service-units'

export function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          <Route path="design" element={<DesignPage />} />
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/service-units" replace />} />
            <Route path="campuses" element={<CampusesPage />} />
            <Route path="campuses/:id" element={<CampusDetailPage />} />
            <Route path="institutions" element={<InstitutionsPage />} />
            <Route path="institutions/:id" element={<InstitutionDetailPage />} />
            <Route path="departments" element={<DepartmentsPage />} />
            <Route path="departments/:id" element={<DepartmentDetailPage />} />
            <Route path="service-units" element={<ServiceUnitsPage />} />
            <Route path="service-units/:id" element={<ServiceUnitDetailPage />} />
            <Route path="changes" element={<ChangesPage />} />
            <Route path="changes/:id" element={<ChangeDetailPage />} />
            <Route path="planned/:key" element={<PlannedPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
