import { useEffect, useRef, useState } from 'react'

type Props = {
  src?: string | null
  title: string
  className?: string
  decorative?: boolean
  showFailureText?: boolean
  loading?: 'eager' | 'lazy'
}

export default function BookCover({
  src,
  title,
  className = 'w-full aspect-[2/3]',
  decorative = false,
  showFailureText = true,
  loading = 'eager',
}: Props) {
  const retries = useRef(0)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    retries.current = 0
    setFailed(false)
  }, [src])

  const handleError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    if (retries.current < 2 && src) {
      retries.current += 1
      const separator = src.includes('?') ? '&' : '?'
      event.currentTarget.src = `${src}${separator}retry=${retries.current}`
      return
    }
    setFailed(true)
  }

  const wrapperClass = `${className} overflow-hidden bg-apple-accent-light flex-shrink-0`
  if (!src || failed) {
    const label = failed ? `${title}的封面暂不可用` : `${title}暂无封面`
    return (
      <div
        className={`${wrapperClass} flex flex-col items-center justify-center gap-2 px-2 text-center`}
        aria-label={decorative ? undefined : label}
        aria-hidden={decorative || undefined}
      >
        <span className="text-apple-accent text-[28px] font-bold opacity-30" aria-hidden="true">
          {title.charAt(0)}
        </span>
        {failed && showFailureText && (
          <span className="text-[11px] text-apple-secondary">封面暂不可用</span>
        )}
      </div>
    )
  }

  return (
    <div className={wrapperClass}>
      <img
        src={src}
        alt={decorative ? '' : title}
        loading={loading}
        decoding="async"
        className="w-full h-full object-cover bg-apple-bg"
        onError={handleError}
      />
    </div>
  )
}
