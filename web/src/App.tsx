import { useGetHealth } from '@/api/generated/system/system'

export function App() {
  const { data, isPending, isError } = useGetHealth()
  const health = data?.data

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">HDIP 主数据维护</h1>
      <p className="mt-2 text-sm text-gray-500">主体 · 院区 · 服务单元</p>
      <section className="mt-6 rounded-lg border p-4 text-sm">
        {isPending && '正在连接后端…'}
        {isError && <span className="text-red-600">后端或数据库不可用</span>}
        {health && (
          <span>
            后端正常 · 数据库时区 {health.db_timezone} · 当前 {health.db_time}
          </span>
        )}
      </section>
    </main>
  )
}
