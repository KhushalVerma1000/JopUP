import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ChevronRight, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import { AppLayout } from '../components/AppLayout';
import { PageHeader, Section, Chips, Loading, ErrorNote, Notice, EmptyState, Avatar } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LocationSheet, ContactSheet } from '../components/clients/ClientMailForms';
import { useFetch, errorMessage } from '../hooks/useFetch';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'locations', label: 'Locations & Contacts' },
  { key: 'mail', label: 'Mail settings' },
  { key: 'history', label: 'Sent history' },
];

const fmt = (d) => new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function RolePill({ role }) {
  return <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-xs font-medium ${role === 'to' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>{role === 'to' ? 'To' : 'CC'}</span>;
}

function ContactRow({ c, canWrite, onEdit, onRemove }) {
  return (
    <div className="flex min-h-11 items-center gap-3 border-t py-2">
      <Avatar name={c.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{c.name}{c.designation && <span className="font-normal text-muted-foreground"> · {c.designation}</span>}</div>
        <div className="truncate text-xs text-muted-foreground">{c.email}</div>
      </div>
      <RolePill role={c.mailRole} />
      {canWrite && (
        <>
          <Button type="button" variant="ghost" size="icon" aria-label={`Edit ${c.name}`} onClick={() => onEdit(c)}><Pencil /></Button>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${c.name}`} onClick={() => onRemove(c)}><Trash2 /></Button>
        </>
      )}
    </div>
  );
}

/** Client profile: where its candidates are mailed (locations → contacts and template) and what was sent. */
export function ClientProfilePage() {
  const { id } = useParams();
  const { isOrgAdmin, isManager } = useAuth();
  const canWrite = isOrgAdmin || isManager;
  const client = useFetch(`/api/v1/clients/${id}`);
  const profile = useFetch(`/api/v1/clients/${id}/mail-profile`);
  const history = useFetch(`/api/v1/clients/${id}/mail-log`);
  const templates = useFetch(canWrite ? '/api/v1/mail/templates' : null);
  const [tab, setTab] = useState('locations');
  const [locSheet, setLocSheet] = useState({ open: false, location: null });
  const [contactSheet, setContactSheet] = useState({ open: false, contact: null, locationId: '' });
  const [actionError, setActionError] = useState(null);

  const c = client.data?.client;
  const p = profile.data;
  const locations = p?.locations || [];
  const tpls = templates.data || [];

  async function remove(path, what) {
    if (!window.confirm(`Remove ${what}?`)) return;
    setActionError(null);
    try { await apiFetch(path, { method: 'DELETE' }); profile.reload(); } catch (err) { setActionError(errorMessage(err, 'Could not remove it.')); }
  }
  async function setTemplate(l, templateId) {
    setActionError(null);
    try { await apiFetch(`/api/v1/clients/${id}/locations/${l.id}`, { method: 'PATCH', body: { trackerTemplateId: templateId || null } }); profile.reload(); }
    catch (err) { setActionError(errorMessage(err, 'Could not change the template.')); }
  }

  const unmatched = p?.unmatched;

  return (
    <AppLayout>
      <nav className="mb-2 flex items-center gap-1 text-sm text-muted-foreground" aria-label="Breadcrumb">
        <Link to="/clients" className="hover:underline">Clients</Link><ChevronRight className="size-3.5" />
        <span className="text-foreground">{c?.companyName || '…'}</span>
      </nav>
      <PageHeader title={c?.companyName || 'Client'} subtitle={c?.industry || undefined}
        action={canWrite && tab === 'locations' ? <Button onClick={() => setLocSheet({ open: true, location: null })}><Plus /> Add location</Button> : null} />
      <Chips items={TABS} value={tab} onChange={setTab} className="mb-5" />

      {(client.loading || profile.loading) && <Loading />}
      <ErrorNote>{client.error || profile.error || actionError}</ErrorNote>

      {p && tab === 'overview' && c && (
        <Card className="grid gap-3 p-4 text-sm sm:grid-cols-2">
          <div><div className="text-xs text-muted-foreground">Primary contact</div><div>{c.contactName || '—'}{c.contactRole && ` · ${c.contactRole}`}</div><div className="text-muted-foreground">{c.contactEmail}</div></div>
          <div><div className="text-xs text-muted-foreground">Website</div><div>{c.website || '—'}</div></div>
          <div><div className="text-xs text-muted-foreground">Locations</div><div>{locations.length}</div></div>
          <div><div className="text-xs text-muted-foreground">Status</div><div className="capitalize">{c.status.replace('_', ' ')}</div></div>
          {c.notes && <div className="sm:col-span-2"><div className="text-xs text-muted-foreground">Notes</div><div>{c.notes}</div></div>}
        </Card>
      )}

      {p && tab === 'locations' && (
        <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-4">
            {locations.length === 0 && (
              <EmptyState title="No locations yet" body="Add the client's stores or branches so each tracker mail goes to the right people with the right columns."
                action={canWrite ? <Button onClick={() => setLocSheet({ open: true, location: null })}><Plus /> Add location</Button> : null} />
            )}
            {locations.map((l) => (
              <Card key={l.id} className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="flex items-center gap-1.5 text-base font-semibold"><MapPin className="size-4 text-muted-foreground" />{l.name}</h3>
                  {l.aliases.length > 0 && <span className="text-xs text-muted-foreground">Matches candidate locations:</span>}
                  {l.aliases.map((a) => <span key={a} className="inline-flex h-6 items-center rounded-md bg-muted px-2 text-xs">{a}</span>)}
                  {canWrite && (
                    <span className="ml-auto flex gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => setLocSheet({ open: true, location: l })}>Edit</Button>
                      <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${l.name}`} onClick={() => remove(`/api/v1/clients/${id}/locations/${l.id}`, `the ${l.name} location (its contacts stay, as client-wide)`)}><Trash2 /></Button>
                    </span>
                  )}
                </div>
                <div className="mt-3 grid gap-4 md:grid-cols-[1fr_220px]">
                  <div>
                    {l.contacts.length === 0 && <p className="border-t py-3 text-sm text-muted-foreground">No contacts here yet. Mails for this location use the client-wide contacts.</p>}
                    {l.contacts.map((ct) => (
                      <ContactRow key={ct.id} c={ct} canWrite={canWrite} onEdit={(x) => setContactSheet({ open: true, contact: x, locationId: '' })}
                        onRemove={(x) => remove(`/api/v1/clients/${id}/contacts/${x.id}`, x.name)} />
                    ))}
                    {canWrite && <Button type="button" variant="ghost" size="sm" className="mt-1" onClick={() => setContactSheet({ open: true, contact: null, locationId: l.id })}><Plus /> Add contact</Button>}
                  </div>
                  <div className="md:border-l md:pl-4">
                    <div className="text-xs text-muted-foreground">Tracker template</div>
                    <div className="mt-0.5 text-sm font-medium">{l.trackerTemplateName || 'Standard'}</div>
                  </div>
                </div>
              </Card>
            ))}
            <div className="rounded-xl border border-dashed p-4">
              <div className="flex items-center justify-between gap-2">
                <div><div className="text-sm font-medium">Client-wide contacts</div><div className="text-xs text-muted-foreground">Used when a location has no contacts of its own, or a candidate fits no store.</div></div>
                {canWrite && <Button type="button" variant="outline" size="sm" onClick={() => setContactSheet({ open: true, contact: null, locationId: '' })}><Plus /> Add</Button>}
              </div>
              {(p.clientContacts || []).map((ct) => (
                <ContactRow key={ct.id} c={ct} canWrite={canWrite} onEdit={(x) => setContactSheet({ open: true, contact: x, locationId: '' })}
                  onRemove={(x) => remove(`/api/v1/clients/${id}/contacts/${x.id}`, x.name)} />
              ))}
            </div>
          </div>

          <Card className="p-4">
            <h3 className="text-sm font-semibold">How a mail finds its contact</h3>
            <p className="mt-1 text-sm text-muted-foreground">The app reads each candidate's location and fills in To, CC and the template for you.</p>
            <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-sm leading-relaxed">
              Candidate location: <b className="font-medium">{locations[0]?.aliases[0] || 'Aligarh UP'}</b><br />
              → matches <b className="font-medium">{locations[0]?.name || 'a store'}</b><br />
              → To / CC: that store's contacts<br />
              → Template: that store's template
            </div>
            {unmatched?.count > 0 && (
              <Notice tone="warn" className="mt-3">
                {unmatched.count} {unmatched.count === 1 ? 'candidate has a location' : 'candidates have locations'} that match no store ({unmatched.locations.join(', ')}). Add each spelling to the right location{canWrite ? '' : ' (ask your manager)'}.
              </Notice>
            )}
          </Card>
        </div>
      )}

      {p && tab === 'mail' && (
        <Section title="Template per location" hint="Which columns each location's tracker mail shows. HR can still adjust columns for a single send.">
          {locations.length === 0 ? <EmptyState title="Add a location first" body="Mail settings are set per location." /> : (
            <Card className="divide-y">
              {locations.map((l) => (
                <div key={l.id} className="flex flex-wrap items-center gap-3 p-3">
                  <div className="min-w-0 flex-1"><div className="text-sm font-medium">{l.name}</div><div className="text-xs text-muted-foreground">{l.contacts.filter((x) => x.mailRole === 'to').length} To · {l.contacts.filter((x) => x.mailRole === 'cc').length} CC</div></div>
                  {canWrite ? (
                    <select aria-label={`Template for ${l.name}`} className="h-10 rounded-md border bg-transparent px-3 text-sm" value={l.trackerTemplateId || ''} onChange={(e) => setTemplate(l, e.target.value)}>
                      <option value="">Standard</option>
                      {tpls.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  ) : <span className="text-sm">{l.trackerTemplateName || 'Standard'}</span>}
                </div>
              ))}
            </Card>
          )}
        </Section>
      )}

      {tab === 'history' && (
        <Section title="Sent history" hint="Recorded when HR taps Mark as sent.">
          {history.loading && <Loading />}
          <ErrorNote>{history.error}</ErrorNote>
          {history.data?.length === 0 && <EmptyState title="Nothing sent yet" body="Tracker mails you mark as sent will show up here." />}
          {history.data?.length > 0 && (
            <Card className="divide-y">
              {history.data.map((m) => (
                <div key={m.id} className="p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{m.subject}</span><span className="text-xs text-muted-foreground">{fmt(m.sentAt)}</span></div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{m.candidateCount} {m.candidateCount === 1 ? 'candidate' : 'candidates'} · by {m.sentByName || 'someone'} · To {(m.toEmails || []).map((x) => x.email).join(', ') || '—'}{(m.ccEmails || []).length ? ` · CC ${m.ccEmails.map((x) => x.email).join(', ')}` : ''}</div>
                </div>
              ))}
            </Card>
          )}
        </Section>
      )}

      <LocationSheet open={locSheet.open} location={locSheet.location} clientId={id} templates={tpls}
        onClose={() => setLocSheet({ open: false, location: null })} onSaved={profile.reload} />
      <ContactSheet open={contactSheet.open} contact={contactSheet.contact} presetLocationId={contactSheet.locationId} clientId={id} locations={locations}
        onClose={() => setContactSheet({ open: false, contact: null, locationId: '' })} onSaved={profile.reload} />
    </AppLayout>
  );
}
