import { Link } from 'react-router-dom';

/** Shared frame for login / signup / register: brand on top, card centred, safe-area aware. */
export function AuthShell({ children, wide = false }) {
  return (
    <div className="pt-safe pb-safe flex min-h-svh flex-col items-center bg-gradient-to-b from-accent/60 to-muted px-4 py-8">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-[3px] focus:ring-ring/50">Skip to content</a>
      <Link to="/" translate="no" className="mb-6 inline-flex items-center gap-3 text-2xl font-bold tracking-tight text-primary"><img src="/logo-mark.svg" alt="" className="size-9 rounded-md" aria-hidden />HireTracker</Link>
      <main id="main" tabIndex={-1} className={wide ? 'w-full max-w-4xl' : 'w-full max-w-md'}>{children}</main>
    </div>
  );
}
