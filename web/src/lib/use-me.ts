import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useGetMe } from '@/api/generated/meta/meta'
import { isDenial } from '@/components/kit/read-state'
import { useCurrentUsername } from '@/lib/session'

/** 当前用户与角色。查询键带上用户名，切换身份后自动重取。 */
export function useMe() {
  const username = useCurrentUsername()
  const query = useGetMe({ query: { queryKey: ['me', username] } })
  // 同一身份之前读到过、刷新时被拒绝（401 / 403）：不再沿用旧角色与权限（PR #2 复审 7.1）。
  // 拒绝的时刻记在共享的查询缓存里（按用户名，各处 useMe 结论一致）：之后即使改成 500 / 网络失败，
  // 也要等这个身份再成功读取一次才恢复（P2-D）；从没被拒绝过的“成功 → 500”照常沿用并由外壳标出
  const qc = useQueryClient()
  const deniedKey = ['me-denied', username]
  const { data: deniedAt = 0 } = useQuery({ queryKey: deniedKey, queryFn: () => 0, enabled: false, staleTime: Infinity })
  const deniedNow = query.isError && isDenial(query.error)
  useEffect(() => {
    if (deniedNow && query.errorUpdatedAt > deniedAt) qc.setQueryData(deniedKey, query.errorUpdatedAt)
  })
  const data = deniedNow || query.dataUpdatedAt <= deniedAt ? undefined : query.data
  const roles = data?.roles ?? []
  const permissions = new Set(data?.permissions ?? [])
  return {
    me: data,
    /** 当前身份与权限已读到；未读到时 can() 一律为 false，不能据此说“无权”（U3R-03） */
    permsKnown: data !== undefined,
    /** 权限读取失败且没有结果：外壳统一说明并给重试，各处不再一直写“正在确认权限”而不解释（审查 §7.1） */
    meQuery: query,
    isMaintainer: roles.includes('maintainer'),
    isConfirmer: roles.includes('confirmer'),
    /** 按权限键判断（core/permissions.py），如 can('person.view') */
    can: (key: string) => permissions.has(key),
  }
}
