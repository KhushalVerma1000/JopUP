import * as React from 'react';
import { cn } from '@/lib/utils';

// Deliberately NOT Radix's Select primitive — that's a bigger, more
// stateful component (portal, positioning, keyboard nav) that's harder to
// get right without a real browser to test in. A native <select> styled to
// match Input covers every use in this app (team filters, role pickers)
// with far less surface area for something to be subtly wrong.
const NativeSelect = React.forwardRef(({ className, children, ...props }, ref) => (
  <select
    ref={ref}
    className={cn(
      'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
  </select>
));
NativeSelect.displayName = 'NativeSelect';

export { NativeSelect };
