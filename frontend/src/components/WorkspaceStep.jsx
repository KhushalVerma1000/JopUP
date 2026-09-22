import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';

/**
 * The "which workspace" step, shown when someone lands on /login or
 * /register with no slug in the URL at all (e.g. typed the bare address
 * rather than following a link their org gave them). Once submitted, the
 * caller navigates to /login/:slug or /register/:slug — from then on the
 * slug lives in a bookmarkable/shareable URL, not something re-typed into
 * a form field each time.
 */
export function WorkspaceStep({ title, onSubmit }) {
  const [slug, setSlug] = useState('');

  function handleSubmit(e) {
    e.preventDefault();
    if (slug.trim()) onSubmit(slug.trim());
  }

  return (
    <Card className="w-full max-w-sm">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="text-xl">{title}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="workspace-slug">Workspace ID</Label>
            <Input
              id="workspace-slug"
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="acme-recruiting"
              autoFocus
              required
            />
          </div>
          <p className="text-sm text-muted-foreground">
            This is the ID your organisation was set up with — ask your admin
            if you don't have it, or use the link they sent you instead.
          </p>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full">
            Continue
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
