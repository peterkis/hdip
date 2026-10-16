// 详情页找不到对象时的提示（地址不对、对象不存在）。不留空白页。
import { Link } from 'react-router'
import { DbEmpty } from '@/components/kit/database'
import { Button } from '@/components/ui/button'

export function Missing({ what, back }: { what: string; back: { to: string; label: string } }) {
  return (
    <DbEmpty
      title={`找不到这个${what}`}
      hint="地址可能不完整或对象不存在，请从列表重新进入。"
      action={<Button variant="outline" size="sm" render={<Link to={back.to} />}>{back.label}</Button>}
    />
  )
}
