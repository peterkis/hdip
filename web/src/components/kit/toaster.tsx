// 轻提示（react-hot-toast），外观全部取自设计令牌：浮起表面、细边框、弹层阴影、控件圆角、界面字号。
// 深色主题与强调色随令牌自动切换。调用方用 lib/notify.ts，不直接调用 react-hot-toast。
import { Toaster } from 'react-hot-toast'

export function AppToaster() {
  return (
    <Toaster
      position="bottom-center"
      gutter={8}
      containerStyle={{ bottom: 'var(--hd-space-24)' }}
      toastOptions={{
        duration: 3000,
        style: {
          background: 'var(--hd-surface-raised)',
          color: 'var(--hd-text-primary)',
          border: '1px solid var(--hd-border-default)',
          boxShadow: 'var(--hd-elevation-popover)',
          borderRadius: 'var(--hd-radius-control)',
          fontSize: 'var(--hd-type-ui-size)',
          lineHeight: 'var(--hd-type-ui-leading)',
          padding: 'var(--hd-space-8) var(--hd-space-12)',
          maxWidth: '32rem',
        },
        success: {
          iconTheme: { primary: 'var(--hd-success-text)', secondary: 'var(--hd-surface-raised)' },
        },
        error: {
          duration: 5000,
          iconTheme: { primary: 'var(--hd-danger)', secondary: 'var(--hd-surface-raised)' },
        },
        loading: {
          iconTheme: { primary: 'var(--hd-accent)', secondary: 'var(--hd-border-default)' },
        },
      }}
    />
  )
}
