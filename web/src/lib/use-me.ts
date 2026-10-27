import { useGetMe } from '@/api/generated/meta/meta'
import { useCurrentUsername } from '@/lib/session'

/** 当前用户与角色。查询键带上用户名，切换身份后自动重取。 */
export function useMe() {
  const username = useCurrentUsername()
  const query = useGetMe({ query: { queryKey: ['me', username] } })
  const { data } = query
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
