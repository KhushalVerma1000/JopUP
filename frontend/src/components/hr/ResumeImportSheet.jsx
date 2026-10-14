import { useMemo, useRef, useState } from 'react';
import { FileText, Upload, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Sheet, Field, Notice, ErrorNote } from '@/components/common';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { Card } from '@/components/ui/card';
import { apiFetch } from '../../lib/api';
import { errorMessage } from '../../hooks/useFetch';

const COUNTRIES = [['IN', 'India +91'], ['US', 'United States +1'], ['GB', 'United Kingdom +44'], ['AE', 'UAE +971'], ['SG', 'Singapore +65'], ['CA', 'Canada +1'], ['AU', 'Australia +61']];
const ACCEPT = '.pdf,.docx,.doc,.png,.jpg,.jpeg,.bmp,.tif,.tiff';
const ACCEPT_EXT = ACCEPT.split(',');
const CHUNK = 10; // files per request: keeps each call short and gives real progress
const MAX_FILES = 100;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const WARNING_LABELS = {
  missing_email: 'No email found',
  missing_phone: 'No phone found',
  missing_name: 'Name not found',
  missing_last_name: 'No last name',
  phone_country_unknown: 'Pick phone country',
  name_guessed_from_email: 'Name guessed from email',
  no_skills_found: 'No skills found',
  duplicate_in_batch: 'Same person appears twice in this upload',
  already_in_database: 'Already in your database',
  ocr_verify_contact: 'Read from an image — check phone & email',
};
// Warnings that make a row start unticked, so nothing risky is created by accident.
const BLOCKING = new Set(['duplicate_in_batch', 'already_in_database', 'missing_name']);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
let uid = 0;
const nextId = () => `d${++uid}`;

function extOf(name) { const i = name.lastIndexOf('.'); return i < 0 ? '' : name.slice(i).toLowerCase(); }
function fmtSize(b) { return b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`; }

function draftError(d) {
  if (!d.firstName.trim()) return 'First name is required';
  if (d.email.trim() && !EMAIL_RE.test(d.email.trim())) return 'Email looks invalid';
  if (d.phone.trim() && !d.phoneCountry) return 'Pick the phone country';
  return null;
}

/** Turn an editable draft back into the API shape (empty strings dropped). */
function toPayload(d) {
  const out = { firstName: d.firstName.trim(), skills: d.skills, parsedResume: d.parsedResume };
  if (d.lastName.trim()) out.lastName = d.lastName.trim();
  if (d.email.trim()) out.email = d.email.trim();
  if (d.phone.trim()) { out.phone = d.phone.trim(); out.phoneCountry = d.phoneCountry; }
  if (d.location.trim()) out.location = d.location.trim();
  if (d.linkedinUrl.trim()) out.linkedinUrl = d.linkedinUrl.trim();
  if (d.confirmDuplicate) out.confirmDuplicate = true;
  return out;
}

/**
 * Bulk resume import, in three steps:
 *   1. Pick a team + files  -> parsed in batches of 10 (nothing is saved yet)
 *   2. Review the drafts    -> fix anything, untick people you don't want
 *   3. Create               -> per-person result; duplicates can be force-created
 * `teams` are the teams this user may add candidates to.
 */
export function ResumeImportSheet({ open, teams, onClose, onDone }) {
  // Mount this only while open (see HrPage) so every import starts from clean state.
  const [step, setStep] = useState('pick');
  const [teamId, setTeamId] = useState(teams[0]?.id || '');
  const [country, setCountry] = useState('IN');
  const [files, setFiles] = useState([]);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(null);
  const [drafts, setDrafts] = useState([]);
  const [failed, setFailed] = useState([]);
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // ── step 1: files ──────────────────────────────────────────────────────
  function addFiles(list) {
    const incoming = [...list];
    const rejected = [];
    const keep = [];
    for (const f of incoming) {
      if (!ACCEPT_EXT.includes(extOf(f.name))) rejected.push(`${f.name}: unsupported type`);
      else if (f.size > MAX_FILE_BYTES) rejected.push(`${f.name}: over 10 MB`);
      else keep.push(f);
    }
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of keep) if (!seen.has(`${f.name}:${f.size}`)) merged.push(f);
      if (merged.length > MAX_FILES) rejected.push(`Only the first ${MAX_FILES} files were kept`);
      return merged.slice(0, MAX_FILES);
    });
    setError(rejected.length ? `Skipped — ${rejected.join('; ')}` : null);
  }

  async function parse() {
    setBusy(true); setError(null);
    const all = [];
    try {
      for (let i = 0; i < files.length; i += CHUNK) {
        setProgress({ done: i, total: files.length });
        const form = new FormData();
        files.slice(i, i + CHUNK).forEach((f) => form.append('files', f));
        const res = await apiFetch(`/api/v1/resume-parser/parse?defaultCountry=${country}`, { method: 'POST', body: form });
        all.push(...res.data.results);
      }
    } catch (err) {
      setError(errorMessage(err, 'Could not read the resumes. Please try again.'));
      setBusy(false); setProgress(null);
      return;
    }
    const ok = all.filter((r) => r.status !== 'failed');
    setFailed(all.filter((r) => r.status === 'failed'));
    setDrafts(ok.map((r) => {
      const c = r.candidate;
      const warnings = r.warnings || [];
      return {
        id: nextId(),
        fileName: r.fileName,
        warnings,
        confidence: r.confidence || {},
        existing: r.existingCandidate || null,
        firstName: c.firstName || '', lastName: c.lastName || '', email: c.email || '',
        phone: c.phone || '', phoneCountry: c.phoneCountry || '',
        location: c.location || '', linkedinUrl: c.linkedinUrl || '',
        skills: c.skills || [], parsedResume: r.parsedResume,
        selected: !warnings.some((w) => BLOCKING.has(w)),
        confirmDuplicate: false,
      };
    }));
    setBusy(false); setProgress(null);
    setStep('review');
  }

  // ── step 2: review ─────────────────────────────────────────────────────
  const patch = (id, changes) => setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, ...changes } : d)));
  const selected = useMemo(() => drafts.filter((d) => d.selected), [drafts]);
  const problems = useMemo(() => selected.map((d) => [d, draftError(d)]).filter(([, e]) => e), [selected]);

  async function create(items) {
    setBusy(true); setError(null);
    try {
      const res = await apiFetch('/api/v1/resume-parser/bulk-create', {
        method: 'POST',
        body: { ownerTeamId: teamId, items: items.map(toPayload) },
      });
      const byDraft = new Map();
      res.data.results.forEach((r) => byDraft.set(items[r.index].id, r));
      setResults((prev) => ({ ...(prev || {}), ...Object.fromEntries(byDraft) }));
      setStep('done');
    } catch (err) {
      setError(errorMessage(err, 'Could not create the candidates.'));
    }
    setBusy(false);
  }

  // ── step 3: result ─────────────────────────────────────────────────────
  const attempted = drafts.filter((d) => results?.[d.id]);
  const created = attempted.filter((d) => results[d.id].status === 'created');
  const needsAttention = attempted.filter((d) => results[d.id].status !== 'created');

  function forceCreate(d) {
    const next = { ...d, confirmDuplicate: true };
    patch(d.id, { confirmDuplicate: true });
    create([next]);
  }

  function close() { if (created.length) onDone?.(created.length); onClose(); }

  const title = step === 'pick' ? 'Import resumes' : step === 'review' ? `Review ${drafts.length} resume${drafts.length === 1 ? '' : 's'}` : 'Import result';

  return (
    <Sheet open={open} onClose={busy ? () => {} : close} title={title} size="xl"
      description={step === 'pick' ? 'Upload PDF, Word or image resumes. You review everything before any candidate is created.' : undefined}>
      <div className="flex flex-col gap-4">
        <ErrorNote>{error}</ErrorNote>

        {step === 'pick' && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Add candidates to team" htmlFor="ri-team">
                <NativeSelect id="ri-team" value={teamId} onChange={(e) => setTeamId(e.target.value)}>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Phone numbers without a +code are in" htmlFor="ri-country" hint="Only used when a resume has no country code.">
                <NativeSelect id="ri-country" value={country} onChange={(e) => setCountry(e.target.value)}>
                  {COUNTRIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}
                </NativeSelect>
              </Field>
            </div>

            <div
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
              className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center ${drag ? 'border-primary bg-primary/5' : 'border-border'}`}
            >
              <Upload className="size-8 text-muted-foreground" aria-hidden />
              <div>
                <p className="font-medium">Drop resumes here</p>
                <p className="text-sm text-muted-foreground">PDF, DOCX, DOC, PNG, JPG · up to {MAX_FILES} files, 10 MB each</p>
              </div>
              <Button type="button" variant="outline" onClick={() => inputRef.current?.click()}>Choose files</Button>
              <input ref={inputRef} type="file" multiple accept={ACCEPT} className="hidden" aria-label="Choose resume files"
                onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            </div>

            {files.length > 0 && (
              <ul className="max-h-56 divide-y overflow-auto rounded-md border text-sm">
                {files.map((f) => (
                  <li key={`${f.name}:${f.size}`} className="flex items-center gap-3 px-3 py-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fmtSize(f.size)}</span>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${f.name}`} disabled={busy}
                      onClick={() => setFiles((fs) => fs.filter((x) => x !== f))}><X /></Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex items-center justify-end gap-3">
              {progress && <span className="text-sm text-muted-foreground" aria-live="polite">Reading {Math.min(progress.done + CHUNK, progress.total)} of {progress.total}…</span>}
              <Button onClick={parse} disabled={busy || !files.length || !teamId}>
                {busy ? 'Reading resumes…' : `Read ${files.length || ''} resume${files.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          </>
        )}

        {step === 'review' && (
          <>
            {failed.length > 0 && (
              <Notice tone="warn" title={`${failed.length} file${failed.length === 1 ? '' : 's'} could not be read`}>
                <ul className="mt-1 list-disc pl-4">{failed.map((f) => <li key={f.fileName}><strong>{f.fileName}</strong>: {f.error}</li>)}</ul>
              </Notice>
            )}
            {drafts.length === 0 && <Notice tone="bad" title="Nothing to review">None of the files could be read.</Notice>}

            <div className="flex flex-col gap-3">
              {drafts.map((d) => {
                const err = d.selected ? draftError(d) : null;
                return (
                  <Card key={d.id} className={`gap-3 p-4 ${d.selected ? '' : 'opacity-60'}`}>
                    <div className="flex items-start gap-3">
                      <input type="checkbox" className="mt-1 size-5" checked={d.selected} aria-label={`Include ${d.fileName}`}
                        onChange={(e) => patch(d.id, { selected: e.target.checked })} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-xs text-muted-foreground"><FileText className="size-3.5" aria-hidden /><span className="truncate">{d.fileName}</span></div>
                        {d.warnings.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {d.warnings.map((w) => (
                              <Badge key={w} variant={BLOCKING.has(w) ? 'destructive' : 'outline'} className="font-normal">
                                {WARNING_LABELS[w] || w}
                              </Badge>
                            ))}
                          </div>
                        )}
                        {d.parsedResume?.experienceYears != null && (
                          <p className="mt-1.5 text-xs text-muted-foreground">
                            Experience: {d.parsedResume.experienceSource === 'estimated' ? '~' : ''}{d.parsedResume.experienceYears} yrs
                            {d.parsedResume.experienceSource === 'estimated' ? ' (estimated from dates)' : ''}
                          </p>
                        )}
                        {d.existing && <p className="mt-1.5 text-xs text-muted-foreground">Matches {[d.existing.firstName, d.existing.lastName].filter(Boolean).join(' ')}{d.existing.email ? ` (${d.existing.email})` : ''}</p>}
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      <Input aria-label="First name" placeholder="First name" value={d.firstName} onChange={(e) => patch(d.id, { firstName: e.target.value })} />
                      <Input aria-label="Last name" placeholder="Last name" value={d.lastName} onChange={(e) => patch(d.id, { lastName: e.target.value })} />
                      <Input aria-label="Email" type="email" placeholder="Email" value={d.email} onChange={(e) => patch(d.id, { email: e.target.value })} />
                      <div className="flex gap-2">
                        <NativeSelect aria-label="Phone country" className="w-28 shrink-0" value={d.phoneCountry} onChange={(e) => patch(d.id, { phoneCountry: e.target.value })}>
                          <option value="">Country</option>
                          {COUNTRIES.map(([c]) => <option key={c} value={c}>{c}</option>)}
                        </NativeSelect>
                        <Input aria-label="Phone" type="tel" placeholder="Phone" value={d.phone} onChange={(e) => patch(d.id, { phone: e.target.value })} />
                      </div>
                      <Input aria-label="Location" placeholder="Location" value={d.location} onChange={(e) => patch(d.id, { location: e.target.value })} />
                      <Input aria-label="LinkedIn" type="url" placeholder="LinkedIn URL" value={d.linkedinUrl} onChange={(e) => patch(d.id, { linkedinUrl: e.target.value })} />
                    </div>
                    {d.skills.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {d.skills.map((s) => (
                          <Badge key={s} variant="secondary" className="gap-1 border-border font-normal">
                            {s}
                            <button type="button" aria-label={`Remove skill ${s}`} className="rounded-sm hover:text-destructive"
                              onClick={() => patch(d.id, { skills: d.skills.filter((x) => x !== s) })}><X /></button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    {err && <p className="flex items-center gap-1.5 text-sm text-destructive" role="alert"><AlertTriangle className="size-4" aria-hidden />{err}</p>}
                  </Card>
                );
              })}
            </div>

            <div className="sticky bottom-0 -mx-5 flex flex-wrap items-center justify-between gap-3 border-t bg-background px-5 py-3">
              <span className="text-sm text-muted-foreground">{selected.length} of {drafts.length} selected{problems.length ? ` · ${problems.length} need fixing` : ''}</span>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setStep('pick')} disabled={busy}>Back</Button>
                <Button onClick={() => create(selected)} disabled={busy || !selected.length || problems.length > 0}>
                  {busy ? 'Creating…' : `Create ${selected.length} candidate${selected.length === 1 ? '' : 's'}`}
                </Button>
              </div>
            </div>
          </>
        )}

        {step === 'done' && (
          <>
            <Notice tone={created.length ? 'good' : 'warn'} title={`${created.length} candidate${created.length === 1 ? '' : 's'} created${needsAttention.length ? `, ${needsAttention.length} need attention` : ''}`} />
            {created.length > 0 && (
              <ul className="max-h-48 divide-y overflow-auto rounded-md border text-sm">
                {created.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 px-3 py-2"><CheckCircle2 className="size-4 text-emerald-600" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{[d.firstName, d.lastName].filter(Boolean).join(' ')}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{d.fileName}</span></li>
                ))}
              </ul>
            )}
            {needsAttention.length > 0 && (
              <ul className="divide-y rounded-md border text-sm">
                {needsAttention.map((d) => {
                  const r = results[d.id];
                  return (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                      <span className="min-w-0 flex-1"><strong>{[d.firstName, d.lastName].filter(Boolean).join(' ')}</strong>: {r.error}</span>
                      {r.status === 'duplicate' && <Button size="sm" variant="outline" disabled={busy} onClick={() => forceCreate(d)}>Create anyway</Button>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              {needsAttention.length > 0 && <Button variant="outline" onClick={() => setStep('review')} disabled={busy}>Back to review</Button>}
              <Button onClick={close}>Done</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}
