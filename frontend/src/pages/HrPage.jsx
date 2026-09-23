import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { apiFetch, ApiError } from '../lib/api';
import { AppLayout } from '../components/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const TABS = [
  { key: 'candidates', label: 'Candidates' },
  { key: 'jobs', label: 'Job Postings' },
  { key: 'tracker', label: 'Tracker' },
];

export function HrPage() {
  const [tab, setTab] = useState('candidates');
  // Teams are needed by all three tabs (filters + form dropdowns) — loaded
  // once here rather than separately in each tab.
  const [teams, setTeams] = useState([]);

  useEffect(() => {
    apiFetch('/api/v1/teams').then((res) => setTeams(res.data.teams)).catch(() => {});
  }, []);

  const teamName = useCallback((id) => teams.find((t) => t.id === id)?.name || '—', [teams]);

  return (
    <AppLayout>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">HR</h1>
        <p className="mt-1 text-sm text-muted-foreground">Candidates, job postings, and the pipeline tracker.</p>
      </div>

      <div className="mb-6 flex gap-1 border-b">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'border-b-2 px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'candidates' && <CandidatesTab teams={teams} teamName={teamName} />}
      {tab === 'jobs' && <JobPostingsTab teams={teams} teamName={teamName} />}
      {tab === 'tracker' && <TrackerTab teams={teams} teamName={teamName} />}
    </AppLayout>
  );
}

const SOURCES = ['job_post', 'manual', 'resume_upload', 'referral', 'agency', 'linkedin', 'other'];

// ── Candidates ────────────────────────────────────────────────────────────
function CandidatesTab({ teams, teamName }) {
  const { isOrgAdmin } = useAuth();
  const [teamFilter, setTeamFilter] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const EMPTY = { firstName: '', lastName: '', ownerTeamId: '', email: '', phone: '', source: 'manual', skills: '' };
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async (teamId) => {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const res = await apiFetch(`/api/v1/candidates${qs}`);
    setCandidates(res.data.candidates);
  }, []);

  useEffect(() => {
    setLoading(true);
    load(teamFilter)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load candidates.'))
      .finally(() => setLoading(false));
  }, [load, teamFilter]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const skills = form.skills.split(',').map((s) => s.trim()).filter(Boolean);
      await apiFetch('/api/v1/candidates', { method: 'POST', body: { ...form, skills, email: form.email || undefined, phone: form.phone || undefined } });
      setForm(EMPTY);
      setShowCreate(false);
      await load(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create candidate.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(c) {
    if (!window.confirm(`Delete ${c.firstName} ${c.lastName}? This can't be undone.`)) return;
    setBusyId(c.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/candidates/${c.id}`, { method: 'DELETE' });
      await load(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete candidate.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="w-56">
          <NativeSelect value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </NativeSelect>
        </div>
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Cancel' : 'New Candidate'}</Button>
      </div>

      {error && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {showCreate && (
        <Card className="mb-6">
          <form onSubmit={handleCreate}>
            <CardHeader><CardTitle>New candidate</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="grid gap-2"><Label>First name</Label><Input value={form.firstName} onChange={update('firstName')} required /></div>
              <div className="grid gap-2"><Label>Last name</Label><Input value={form.lastName} onChange={update('lastName')} required /></div>
              <div className="grid gap-2">
                <Label>Owning team</Label>
                <NativeSelect value={form.ownerTeamId} onChange={update('ownerTeamId')} required>
                  <option value="" disabled>Select a team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Source</Label>
                <NativeSelect value={form.source} onChange={update('source')}>
                  {SOURCES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2"><Label>Email</Label><Input type="email" value={form.email} onChange={update('email')} /></div>
              <div className="grid gap-2"><Label>Phone</Label><Input value={form.phone} onChange={update('phone')} /></div>
              <div className="col-span-2 grid gap-2">
                <Label>Skills</Label>
                <Input value={form.skills} onChange={update('skills')} placeholder="node.js, postgres, react (comma-separated)" />
              </div>
            </CardContent>
            <CardFooter><Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create candidate'}</Button></CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Directory</CardTitle>
          <CardDescription>{candidates.length} candidate(s){teamFilter ? ' in this team' : ''}.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  {isOrgAdmin && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {candidates.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.firstName} {c.lastName}</TableCell>
                    <TableCell className="text-muted-foreground">{c.email || c.phone || '—'}</TableCell>
                    <TableCell>{teamName(c.ownerTeamId)}</TableCell>
                    <TableCell className="capitalize">{c.source.replace('_', ' ')}</TableCell>
                    <TableCell><Badge variant={c.status === 'active' ? 'success' : c.status === 'placed' ? 'default' : 'outline'}>{c.status}</Badge></TableCell>
                    {isOrgAdmin && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={busyId === c.id} onClick={() => handleDelete(c)}>Delete</Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Job Postings ──────────────────────────────────────────────────────────
function JobPostingsTab({ teams, teamName }) {
  const { isOrgAdmin, isManager } = useAuth();
  const canClose = isOrgAdmin || isManager; // hr lacks job_postings:close
  const [jobs, setJobs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const EMPTY = { title: '', description: '', teamId: '', workflowTemplateId: '', location: '', workMode: 'remote', employmentType: 'full_time', vacancies: 1 };
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async () => {
    const [jobsRes, templatesRes] = await Promise.all([
      apiFetch('/api/v1/job-postings'),
      apiFetch('/api/v1/workflows'),
    ]);
    setJobs(jobsRes.data.jobs);
    setTemplates(templatesRes.data.templates);
  }, []);

  useEffect(() => {
    setLoading(true);
    load()
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load job postings.'))
      .finally(() => setLoading(false));
  }, [load]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/v1/job-postings', {
        method: 'POST',
        body: { ...form, workflowTemplateId: form.workflowTemplateId || undefined, vacancies: Number(form.vacancies) },
      });
      setForm(EMPTY);
      setShowCreate(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create job posting.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAction(job, action) {
    setBusyId(job.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/job-postings/${job.id}/${action}`, { method: 'POST' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Could not ${action} this posting.`);
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(job) {
    if (!window.confirm(`Delete "${job.title}"? This can't be undone.`)) return;
    setBusyId(job.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/job-postings/${job.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not delete this posting.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setShowCreate((s) => !s)}>{showCreate ? 'Cancel' : 'New Job Posting'}</Button>
      </div>

      {error && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {templates.length === 0 && (
        <p className="mb-4 rounded-md border border-secondary bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
          No workflow templates exist yet — a job posting can still be created without one, but applications need a
          template to track pipeline stages. Ask an org admin to create one.
        </p>
      )}

      {showCreate && (
        <Card className="mb-6">
          <form onSubmit={handleCreate}>
            <CardHeader><CardTitle>New job posting</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="col-span-2 grid gap-2"><Label>Title</Label><Input value={form.title} onChange={update('title')} required /></div>
              <div className="col-span-2 grid gap-2"><Label>Description</Label><Input value={form.description} onChange={update('description')} required /></div>
              <div className="grid gap-2">
                <Label>Team</Label>
                <NativeSelect value={form.teamId} onChange={update('teamId')} required>
                  <option value="" disabled>Select a team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Workflow template</Label>
                <NativeSelect value={form.workflowTemplateId} onChange={update('workflowTemplateId')}>
                  <option value="">None</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Work mode</Label>
                <NativeSelect value={form.workMode} onChange={update('workMode')}>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">Onsite</option>
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Employment type</Label>
                <NativeSelect value={form.employmentType} onChange={update('employmentType')}>
                  <option value="full_time">Full-time</option>
                  <option value="part_time">Part-time</option>
                  <option value="contract">Contract</option>
                  <option value="temporary">Temporary</option>
                  <option value="internship">Internship</option>
                </NativeSelect>
              </div>
              <div className="grid gap-2"><Label>Location</Label><Input value={form.location} onChange={update('location')} /></div>
              <div className="grid gap-2"><Label>Vacancies</Label><Input type="number" min={1} value={form.vacancies} onChange={update('vacancies')} /></div>
            </CardContent>
            <CardFooter><Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Create posting'}</Button></CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Postings</CardTitle>
          <CardDescription>{jobs.length} posting(s).</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Vacancies</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-medium">{j.title}</TableCell>
                    <TableCell>{teamName(j.teamId)}</TableCell>
                    <TableCell>{j.vacancies}</TableCell>
                    <TableCell><Badge variant={j.status === 'published' ? 'success' : j.status === 'closed' ? 'destructive' : 'secondary'}>{j.status}</Badge></TableCell>
                    <TableCell className="flex justify-end gap-2">
                      {j.status === 'draft' && (
                        <Button size="sm" disabled={busyId === j.id} onClick={() => handleAction(j, 'publish')}>Publish</Button>
                      )}
                      {j.status === 'published' && canClose && (
                        <Button size="sm" variant="outline" disabled={busyId === j.id} onClick={() => handleAction(j, 'close')}>Close</Button>
                      )}
                      {isOrgAdmin && (
                        <Button size="sm" variant="outline" disabled={busyId === j.id} onClick={() => handleDelete(j)}>Delete</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Tracker (applications pipeline) ──────────────────────────────────────
function TrackerTab({ teams, teamName }) {
  const [applications, setApplications] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [stagesByTemplate, setStagesByTemplate] = useState({});
  const [teamFilter, setTeamFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [advanceTarget, setAdvanceTarget] = useState({});

  const EMPTY = { candidateId: '', jobPostingId: '', teamId: '', workflowTemplateId: '' };
  const [form, setForm] = useState(EMPTY);

  const load = useCallback(async (teamId) => {
    const qs = teamId ? `?teamId=${encodeURIComponent(teamId)}` : '';
    const [appsRes, candidatesRes, jobsRes, templatesRes] = await Promise.all([
      apiFetch(`/api/v1/applications${qs}`),
      apiFetch('/api/v1/candidates'),
      apiFetch('/api/v1/job-postings'),
      apiFetch('/api/v1/workflows'),
    ]);
    setApplications(appsRes.data.applications);
    setCandidates(candidatesRes.data.candidates);
    setJobs(jobsRes.data.jobs);
    setTemplates(templatesRes.data.templates);

    const stagesEntries = await Promise.all(
      templatesRes.data.templates.map(async (t) => {
        const res = await apiFetch(`/api/v1/workflows/${t.id}/stages`);
        return [t.id, res.data.stages.sort((a, b) => a.orderIndex - b.orderIndex)];
      })
    );
    setStagesByTemplate(Object.fromEntries(stagesEntries));
  }, []);

  useEffect(() => {
    setLoading(true);
    load(teamFilter)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load the tracker.'))
      .finally(() => setLoading(false));
  }, [load, teamFilter]);

  const candidateName = useCallback((id) => {
    const c = candidates.find((c) => c.id === id);
    return c ? `${c.firstName} ${c.lastName}` : '—';
  }, [candidates]);
  const jobTitle = useCallback((id) => jobs.find((j) => j.id === id)?.title || '—', [jobs]);

  function update(field) {
    return (e) => setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/api/v1/applications', {
        method: 'POST',
        body: { ...form, jobPostingId: form.jobPostingId || undefined },
      });
      setForm(EMPTY);
      setShowCreate(false);
      await load(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create application.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAdvance(app) {
    const nextStageId = advanceTarget[app.id];
    if (!nextStageId) return;
    setBusyId(app.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/applications/${app.id}/advance`, { method: 'POST', body: { nextStageId } });
      await load(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not advance this application.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleHold(app) {
    setBusyId(app.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/applications/${app.id}/hold`, { method: 'POST' });
      await load(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not put this application on hold.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleBlock(app) {
    const reason = window.prompt('Reason for blocking this application:');
    if (!reason) return;
    setBusyId(app.id);
    setError(null);
    try {
      await apiFetch(`/api/v1/applications/${app.id}/block`, { method: 'POST', body: { reason } });
      await load(teamFilter);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not block this application.');
    } finally {
      setBusyId(null);
    }
  }

  const activeCandidates = useMemo(() => candidates.filter((c) => c.status === 'active'), [candidates]);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div className="w-56">
          <NativeSelect value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </NativeSelect>
        </div>
        <Button onClick={() => setShowCreate((s) => !s)} disabled={templates.length === 0}>
          {showCreate ? 'Cancel' : 'New Application'}
        </Button>
      </div>

      {error && <p className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {showCreate && (
        <Card className="mb-6">
          <form onSubmit={handleCreate}>
            <CardHeader>
              <CardTitle>New application</CardTitle>
              <CardDescription>Enters the pipeline at the first stage of the chosen template.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Candidate</Label>
                <NativeSelect value={form.candidateId} onChange={update('candidateId')} required>
                  <option value="" disabled>Select a candidate</option>
                  {activeCandidates.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Job posting (optional)</Label>
                <NativeSelect value={form.jobPostingId} onChange={update('jobPostingId')}>
                  <option value="">None</option>
                  {jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Team</Label>
                <NativeSelect value={form.teamId} onChange={update('teamId')} required>
                  <option value="" disabled>Select a team</option>
                  {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </div>
              <div className="grid gap-2">
                <Label>Workflow template</Label>
                <NativeSelect value={form.workflowTemplateId} onChange={update('workflowTemplateId')} required>
                  <option value="" disabled>Select a template</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </NativeSelect>
              </div>
            </CardContent>
            <CardFooter><Button type="submit" disabled={submitting}>{submitting ? 'Creating…' : 'Add to pipeline'}</Button></CardFooter>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Pipeline</CardTitle>
          <CardDescription>{applications.length} application(s){teamFilter ? ' for this team' : ''}.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Candidate</TableHead>
                  <TableHead>Job Posting</TableHead>
                  <TableHead>Team</TableHead>
                  <TableHead>Current Stage</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {applications.map((app) => {
                  const stages = stagesByTemplate[app.workflowTemplateId] || [];
                  const otherStages = stages.filter((s) => s.id !== app.currentStage?.id);
                  return (
                    <TableRow key={app.id}>
                      <TableCell className="font-medium">{app.candidateName || candidateName(app.candidateId)}</TableCell>
                      <TableCell className="text-muted-foreground">{app.jobPostingTitle || (app.jobPostingId ? jobTitle(app.jobPostingId) : '—')}</TableCell>
                      <TableCell>{teamName(app.teamId)}</TableCell>
                      <TableCell>
                        {app.currentStage ? (
                          <Badge variant={app.currentStage.isFinalSuccess ? 'success' : 'secondary'}>{app.currentStage.name}</Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell><Badge variant={app.status === 'active' ? 'success' : app.status === 'blocked' ? 'destructive' : 'outline'}>{app.status}</Badge></TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-2">
                          {otherStages.length > 0 && (
                            <>
                              <NativeSelect
                                className="h-8 w-36"
                                value={advanceTarget[app.id] || ''}
                                onChange={(e) => setAdvanceTarget((s) => ({ ...s, [app.id]: e.target.value }))}
                              >
                                <option value="" disabled>Move to…</option>
                                {otherStages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                              </NativeSelect>
                              <Button size="sm" disabled={!advanceTarget[app.id] || busyId === app.id} onClick={() => handleAdvance(app)}>
                                Go
                              </Button>
                            </>
                          )}
                          <Button size="sm" variant="outline" disabled={busyId === app.id} onClick={() => handleHold(app)}>Hold</Button>
                          <Button size="sm" variant="outline" disabled={busyId === app.id} onClick={() => handleBlock(app)}>Block</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
