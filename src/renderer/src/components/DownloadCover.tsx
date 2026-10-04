import { useEffect, useState, type ComponentProps } from 'react'
import type { DownloadTask } from '../../../shared/ipc-types'
import { api } from '../api/client'
import BookCover from './BookCover'

type Props = Omit<ComponentProps<typeof BookCover>, 'src'> & {
  task: DownloadTask
}

export default function DownloadCover({ task, ...props }: Props) {
  const [cover, setCover] = useState<{ key: string; src: string | null } | null>(null)
  const key = `${task.id}:${task.cover ?? ''}`

  useEffect(() => {
    let disposed = false
    if (!task.cover) return
    void api.getDownloadCover(task.id).then(
      src => { if (!disposed) setCover({ key, src }) },
      () => { if (!disposed) setCover({ key, src: null }) },
    )
    return () => { disposed = true }
  }, [key, task.id, task.cover, task.status])

  return <BookCover {...props} src={cover?.key === key ? cover.src : null} />
}
