// 下载只读导出的 CSV。按二进制保存，保留服务端写入的 BOM（按文本读取会丢失，Excel 打开会乱码）。
import { getExportCsvUrl } from '@/api/generated/export/export'
import type { ExportCsvParams } from '@/api/generated/model'
import { getCurrentUsername } from '@/lib/session'

type Dataset = Parameters<typeof getExportCsvUrl>[0]

/** filters：人员数据集带上页面当前的筛选，导出的行与页面一致（docs/人员共享数据契约.md） */
export async function downloadCsv(dataset: Dataset, asOf: string, filters?: Omit<ExportCsvParams, 'as_of'>): Promise<void> {
  const res = await fetch(getExportCsvUrl(dataset, { ...filters, as_of: asOf }), {
    headers: { 'X-HDIP-User': getCurrentUsername() },
  })
  if (!res.ok) throw new Error(`导出失败（${res.status}）`)
  const url = URL.createObjectURL(await res.blob())
  const a = document.createElement('a')
  a.href = url
  a.download = `hdip-${dataset}-${asOf}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
