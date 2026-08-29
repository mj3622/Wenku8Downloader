import { useEffect } from 'react'
import { toast } from '../stores/toastStore'
import { getUserFeedback } from '../utils/userFeedback'

export default function GlobalErrorListener() {
  useEffect(() => {
    const showFallback = (): void => {
      toast.error(getUserFeedback(undefined, 'unexpected'))
    }

    window.addEventListener('error', showFallback)
    window.addEventListener('unhandledrejection', showFallback)
    return () => {
      window.removeEventListener('error', showFallback)
      window.removeEventListener('unhandledrejection', showFallback)
    }
  }, [])

  return null
}
