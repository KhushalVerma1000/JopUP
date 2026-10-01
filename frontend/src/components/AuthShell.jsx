import { Link } from 'react-router-dom';

/** Shared frame for login / signup / register: brand on top, card centred, safe-area aware. */
export function AuthShell({ children, wide = false }) {
  return (
    <div className="pt-safe pb-safe flex min-h-svh flex-col items-center bg-gradient-to-b from-accent/60 to-muted px-4 py-8">
      <Link to="/" className="mb-6 text-2xl font-bold tracking-tight text-primary">JopUP</Link>
      <div className={wide ? 'w-full max-w-3xl' : 'w-full max-w-md'}>{children}</div>
    </div>
  );
}
