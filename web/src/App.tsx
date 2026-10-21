import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import { Layout } from '@/components/layout'
import { AppProvider } from '@/lib/app-context'
import { CampusDetailPage, CampusesPage } from '@/pages/campuses'
import { ChangeDetailPage, ChangesPage } from '@/pages/changes'
import { DepartmentDetailPage, DepartmentsPage } from '@/pages/departments'
import { DesignPage } from '@/pages/design'
import { DictionaryPage } from '@/pages/dictionary'
import { CodeLedgerPage } from '@/pages/code-ledger'
import { InstitutionDetailPage, InstitutionsPage } from '@/pages/institutions'
import { PlannedPage } from '@/pages/planned'

// 组织总览带桑基图库，按路由单独加载，不进首屏
const OrganizationOverviewPage = lazy(() =>
  import('@/pages/organization-overview').then((m) => ({ default: m.OrganizationOverviewPage })),
)
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
            <Route
              path="organization-overview"
              element={
                <Suspense fallback={null}>
                  <OrganizationOverviewPage />
                </Suspense>
              }
            />
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
            <Route path="dictionary/classification" element={<DictionaryPage />} />
            <Route path="standards/code-mapping" element={<CodeLedgerPage />} />
            <Route path="planned/:key" element={<PlannedPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
