import Link from 'next/link'
import { ThemeToggle } from '@/components/theme-toggle'

const links = [
  { href: '/elections', label: 'Elections' },
  { href: '/polls', label: 'Polls' },
  { href: '/pollsters', label: 'Pollsters' },
  { href: '/accuracy', label: 'Accuracy' },
  { href: '/about', label: 'About' },
]

export function SiteNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/60 bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="font-semibold tracking-tight">
          mayor-polls
        </Link>
        <nav className="flex flex-1 items-center gap-5 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              {l.label}
            </Link>
          ))}
        </nav>
        <ThemeToggle />
      </div>
    </header>
  )
}
