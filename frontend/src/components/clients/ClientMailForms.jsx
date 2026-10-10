import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { Sheet, ErrorNote, Field, Chips } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { apiFetch } from '../../lib/api';
import { errorMessage } from '../../hooks/useFetch';

/** Add or edit a client location: its name, the spellings that map to it, and its tracker template. */
export function LocationSheet({ open, onClose, clientId, location, templates, onSaved }) {
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState([]);
  const [draft, setDraft] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setName(location?.name || ''); setAliases(location?.aliases || []); setDraft('');
    setTemplateId(location?.trackerTemplateId || ''); setError(null);
  }, [open, location]);

  function addAlias() {
    const parts = draft.split(',').map((x) => x.trim()).filter(Boolean);
    if (!parts.length) return;
    setAliases((a) => [...new Map([...a, ...parts].map((x) => [x.toLowerCase(), x])).values()]);
    setDraft('');
  }

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      // A typed-but-not-added alias still counts.
      const extra = draft.split(',').map((x) => x.trim()).filter(Boolean);
      const all = [...new Map([...aliases, ...extra].map((x) => [x.toLowerCase(), x])).values()];
      const body = { name, aliases: all, trackerTemplateId: templateId || null };
      if (location) await apiFetch(`/api/v1/clients/${clientId}/locations/${location.id}`, { method: 'PATCH', body });
      else await apiFetch(`/api/v1/clients/${clientId}/locations`, { method: 'POST', body });
      onSaved(); onClose();
    } catch (err) { setError(errorMessage(err, 'Could not save the location.')); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title={location ? 'Edit location' : 'Add location'}
      description="Candidates whose location matches the name or any spelling below are mailed to this location's contacts.">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Location name" htmlFor="loc-name"><Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Aligarh store" autoFocus required /></Field>
        <Field label="Matches candidate locations" htmlFor="loc-alias" hint="Other ways candidates' locations are written, e.g. Aligarh, ALG, Aligarh UP. Separate with commas.">
          <div className="flex gap-2">
            <Input id="loc-alias" value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addAlias(); } }} placeholder="Type a spelling and press Enter" />
            <Button type="button" variant="outline" onClick={addAlias}>Add</Button>
          </div>
          {aliases.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {aliases.map((a) => (
                <span key={a} className="inline-flex h-7 items-center gap-1 rounded-md bg-muted px-2 text-xs">
                  {a}
                  <button type="button" aria-label={`Remove ${a}`} className="rounded p-0.5 hover:bg-accent" onClick={() => setAliases((x) => x.filter((y) => y !== a))}><X className="size-3" /></button>
                </span>
              ))}
            </div>
          )}
        </Field>
        <Field label="Tracker template" htmlFor="loc-tpl" hint="The columns this location's tracker mail uses.">
          <NativeSelect id="loc-tpl" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            <option value="">Standard (default template)</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" size="lg" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save location'}</Button>
      </form>
    </Sheet>
  );
}

/** Add or edit a contact at a location (or client-wide), addressed To or CC. */
export function ContactSheet({ open, onClose, clientId, contact, locations, presetLocationId, onSaved }) {
  const [f, setF] = useState({ name: '', email: '', designation: '', phone: '', locationId: '', mailRole: 'to' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setF({
      name: contact?.name || '', email: contact?.email || '', designation: contact?.designation || '', phone: contact?.phone || '',
      locationId: contact ? contact.locationId || '' : presetLocationId || '', mailRole: contact?.mailRole || 'to',
    });
    setError(null);
  }, [open, contact, presetLocationId]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const body = { name: f.name, email: f.email, designation: f.designation || null, phone: f.phone || null, locationId: f.locationId || null, mailRole: f.mailRole };
      if (contact) await apiFetch(`/api/v1/clients/${clientId}/contacts/${contact.id}`, { method: 'PATCH', body });
      else await apiFetch(`/api/v1/clients/${clientId}/contacts`, { method: 'POST', body });
      onSaved(); onClose();
    } catch (err) { setError(errorMessage(err, 'Could not save the contact.')); } finally { setBusy(false); }
  }

  return (
    <Sheet open={open} onClose={onClose} title={contact ? 'Edit contact' : 'Add contact'}
      description="Contacts are filled into To and CC when you mail this location's tracker.">
      <form onSubmit={save} className="flex flex-col gap-4">
        <Field label="Name" htmlFor="ct-name"><Input id="ct-name" value={f.name} onChange={set('name')} autoFocus required /></Field>
        <Field label="Email" htmlFor="ct-email"><Input id="ct-email" type="email" value={f.email} onChange={set('email')} required /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Role at the client" htmlFor="ct-role"><Input id="ct-role" value={f.designation} onChange={set('designation')} placeholder="Store HR" /></Field>
          <Field label="Phone" htmlFor="ct-phone"><Input id="ct-phone" value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <Field label="Location" htmlFor="ct-loc" hint="Client-wide contacts are used when a candidate's location matches no store.">
          <NativeSelect id="ct-loc" value={f.locationId} onChange={set('locationId')}>
            <option value="">All locations (client-wide)</option>
            {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Address them as">
          <Chips items={[{ key: 'to', label: 'To' }, { key: 'cc', label: 'CC' }]} value={f.mailRole} onChange={(k) => setF((x) => ({ ...x, mailRole: k }))} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" size="lg" disabled={busy || !f.name.trim() || !f.email.trim()}>{busy ? 'Saving…' : 'Save contact'}</Button>
      </form>
    </Sheet>
  );
}
