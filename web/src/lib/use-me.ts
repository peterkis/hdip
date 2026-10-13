import { useGetMe } from '@/api/generated/meta/meta'
import { useCurrentUsername } from '@/lib/session'

/** 当前用户与角色。查询键带上用户名，切换身份后自动重取。 */
export function useMe() {
  const username = useCurrentUsername()
  const { data } = useGetMe({ query: { queryKey: ['me', username] } })
  const roles = data?.roles ?? []
  return {
    me: data,
    isMaintainer: roles.includes('maintainer'),
    isConfirmer: roles.includes('confirmer'),
  }
}
