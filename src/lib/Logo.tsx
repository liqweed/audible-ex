import logoUrl from '@/assets/brand/logo-small.svg'

/** The extension's logo, for the headers of the popup and the options page. */
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      alt=''
      width={size}
      height={size}
      className='shrink-0 select-none'
      draggable={false}
    />
  )
}
