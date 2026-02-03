'use client';

import { useEffect, useMemo, useState } from 'react';
import type { User } from 'firebase/auth';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type PolicyMeta = {
  displayVersion: string;
  requiredVersion: string;
};

type PolicyVersion = {
  version: string;
  titleDa?: string;
  changeType?: 'minor' | 'major';
  requiresReaccept?: boolean;
  status?: 'draft' | 'pending_review' | 'approved' | 'published' | 'rejected';
  createdByUid?: string;
  approvedByUid?: string;
  publishedByUid?: string;
  createdAt?: number;
  updatedAt?: number;
  submittedAt?: number;
  approvedAt?: number;
  publishedAt?: number;
  changeSummary?: string;
  contentMdDa?: string;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function PolicyManager({ user }: { user: User }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [knownPolicies, setKnownPolicies] = useState<string[]>([]);
  const [meta, setMeta] = useState<Record<string, PolicyMeta>>({});
  const [policyKey, setPolicyKey] = useState<string>('dataPolicy');

  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>('');

  // Editor fields
  const [editVersion, setEditVersion] = useState<string>('');
  const [titleDa, setTitleDa] = useState<string>('');
  const [contentMdDa, setContentMdDa] = useState<string>('');
  const [changeType, setChangeType] = useState<'minor' | 'major'>('minor');
  const [requiresReaccept, setRequiresReaccept] = useState<boolean>(false);
  const [changeSummary, setChangeSummary] = useState<string>('');

  const selected = useMemo(
    () => versions.find(v => v.version === (selectedVersion || editVersion)) || null,
    [versions, selectedVersion, editVersion]
  );

  const refreshMeta = async () => {
    const res = await fetch(`${API_URL}/policy/meta`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Failed to load policy meta');
    setKnownPolicies(data.knownPolicies || []);
    setMeta(data.policies || {});
  };

  const refreshVersions = async (key: string) => {
    const token = await user.getIdToken();
    const res = await fetch(`${API_URL}/admin/policy/${key}/versions`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || 'Failed to load versions');
    setVersions((data.versions || []) as PolicyVersion[]);
  };

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError('');
        await refreshMeta();
        await refreshVersions(policyKey);
      } catch (e: any) {
        setError(e?.message || 'Failed to load policies');
      } finally {
        setLoading(false);
      }
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const run = async () => {
      try {
        setLoading(true);
        setError('');
        setMessage('');
        await refreshMeta();
        await refreshVersions(policyKey);
        setSelectedVersion('');
      } catch (e: any) {
        setError(e?.message || 'Failed to load versions');
      } finally {
        setLoading(false);
      }
    };
    run();
  }, [policyKey]);

  const loadIntoEditor = (v: PolicyVersion) => {
    setSelectedVersion(v.version);
    setEditVersion(v.version);
    setTitleDa(v.titleDa || '');
    setContentMdDa(v.contentMdDa || '');
    setChangeType((v.changeType as any) || (v.requiresReaccept ? 'major' : 'minor'));
    setRequiresReaccept(!!v.requiresReaccept);
    setChangeSummary(v.changeSummary || '');
  };

  const saveDraft = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      if (!editVersion.trim()) throw new Error('Version is required');
      if (!titleDa.trim()) throw new Error('Title (DA) is required');
      if (!contentMdDa.trim()) throw new Error('Content (Markdown) is required');

      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/policy/${policyKey}/versions/${encodeURIComponent(editVersion.trim())}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          titleDa,
          contentMdDa,
          changeType,
          requiresReaccept,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to save draft');
      setMessage('Draft saved.');
      await refreshVersions(policyKey);
    } catch (e: any) {
      setError(e?.message || 'Failed to save draft');
    } finally {
      setLoading(false);
    }
  };

  const submit = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const v = editVersion.trim();
      if (!v) throw new Error('Version is required');
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/policy/${policyKey}/versions/${encodeURIComponent(v)}/submit`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to submit');
      setMessage('Submitted for review.');
      await refreshVersions(policyKey);
    } catch (e: any) {
      setError(e?.message || 'Failed to submit');
    } finally {
      setLoading(false);
    }
  };

  const approve = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const v = editVersion.trim();
      if (!v) throw new Error('Version is required');
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/policy/${policyKey}/versions/${encodeURIComponent(v)}/approve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to approve');
      setMessage('Approved.');
      await refreshVersions(policyKey);
    } catch (e: any) {
      setError(e?.message || 'Failed to approve');
    } finally {
      setLoading(false);
    }
  };

  const publish = async () => {
    setLoading(true);
    setError('');
    setMessage('');
    try {
      const v = editVersion.trim();
      if (!v) throw new Error('Version is required');
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/policy/${policyKey}/versions/${encodeURIComponent(v)}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ changeSummary }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || 'Failed to publish');
      setMessage('Published.');
      await refreshMeta();
      await refreshVersions(policyKey);
    } catch (e: any) {
      setError(e?.message || 'Failed to publish');
    } finally {
      setLoading(false);
    }
  };

  const currentMeta = meta[policyKey];

  return (
    <div className="space-y-6">
      <div className="bg-card p-6 rounded-lg shadow border border-border">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="flex-1">
            <label className="block text-sm font-medium text-muted-foreground mb-1">Policy</label>
            <select
              value={policyKey}
              onChange={(e) => setPolicyKey(e.target.value)}
              className="w-full p-2 border border-input rounded bg-background text-foreground"
            >
              {(knownPolicies.length ? knownPolicies : ['dataPolicy', 'publicResultsConsent']).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            {currentMeta && (
              <p className="text-xs text-muted-foreground mt-2">
                Display: <strong>{currentMeta.displayVersion}</strong> • Required: <strong>{currentMeta.requiredVersion}</strong>
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => refreshVersions(policyKey)}
              className="px-4 py-2 rounded border border-border bg-background hover:bg-muted text-sm"
              disabled={loading}
            >
              Refresh
            </button>
            <button
              onClick={() => {
                setSelectedVersion('');
                setEditVersion('');
                setTitleDa('');
                setContentMdDa('');
                setChangeType('minor');
                setRequiresReaccept(false);
                setChangeSummary('');
              }}
              className="px-4 py-2 rounded border border-border bg-background hover:bg-muted text-sm"
              disabled={loading}
            >
              New
            </button>
          </div>
        </div>

        {message && <div className="mt-4 bg-green-50 text-green-700 p-3 rounded border border-green-200">{message}</div>}
        {error && <div className="mt-4 bg-red-50 text-red-700 p-3 rounded border border-red-200">{error}</div>}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="bg-card p-6 rounded-lg shadow border border-border">
          <h2 className="text-lg font-semibold mb-4 text-card-foreground">Versions</h2>
          {loading ? (
            <div className="text-muted-foreground">Loading...</div>
          ) : versions.length === 0 ? (
            <div className="text-muted-foreground text-sm">No versions yet.</div>
          ) : (
            <div className="space-y-2">
              {versions.map(v => (
                <button
                  key={v.version}
                  onClick={() => loadIntoEditor(v)}
                  className={`w-full text-left p-3 rounded border transition ${
                    (selectedVersion === v.version || editVersion === v.version)
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-muted/20'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-card-foreground">{v.version}</div>
                    <div className="text-xs text-muted-foreground">{v.status || ''}</div>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {(v.titleDa || '').trim() || '(no title)'} • {v.changeType || (v.requiresReaccept ? 'major' : 'minor')}
                    {v.requiresReaccept ? ' • requires re-accept' : ''}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card p-6 rounded-lg shadow border border-border lg:col-span-2 space-y-4">
          <h2 className="text-lg font-semibold text-card-foreground">Editor</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Version</label>
              <input
                value={editVersion}
                onChange={(e) => setEditVersion(e.target.value)}
                className="w-full p-2 border border-input rounded bg-background text-foreground"
                placeholder="e.g. 2026-02-03"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Title (DA)</label>
              <input
                value={titleDa}
                onChange={(e) => setTitleDa(e.target.value)}
                className="w-full p-2 border border-input rounded bg-background text-foreground"
                placeholder="Datapolitik"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-4 items-center">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Change type</span>
              <select
                value={changeType}
                onChange={(e) => setChangeType(e.target.value as any)}
                className="p-2 border border-input rounded bg-background text-foreground"
              >
                <option value="minor">minor</option>
                <option value="major">major</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresReaccept}
                onChange={(e) => setRequiresReaccept(e.target.checked)}
              />
              <span className="text-muted-foreground">Requires re-accept</span>
            </label>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Change summary (optional)</label>
            <input
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              className="w-full p-2 border border-input rounded bg-background text-foreground"
              placeholder="Short summary shown in history"
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Content (Markdown, DA)</label>
              <textarea
                value={contentMdDa}
                onChange={(e) => setContentMdDa(e.target.value)}
                className="w-full h-72 p-2 border border-input rounded bg-background text-foreground font-mono text-xs"
                placeholder="# Datapolitik\n..."
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Preview</label>
              <div className="h-72 overflow-auto p-3 border border-border rounded bg-background">
                <div className="prose prose-slate dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{contentMdDa || '_No content_'}</ReactMarkdown>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={saveDraft}
              disabled={loading}
              className="px-4 py-2 rounded bg-primary text-primary-foreground hover:opacity-90 font-medium disabled:opacity-50"
            >
              Save draft
            </button>
            <button
              onClick={submit}
              disabled={loading || !editVersion}
              className="px-4 py-2 rounded border border-border bg-background hover:bg-muted font-medium disabled:opacity-50"
            >
              Submit for review
            </button>
            <button
              onClick={approve}
              disabled={loading || !editVersion}
              className="px-4 py-2 rounded border border-border bg-background hover:bg-muted font-medium disabled:opacity-50"
            >
              Approve
            </button>
            <button
              onClick={publish}
              disabled={loading || !editVersion}
              className="px-4 py-2 rounded bg-foreground text-background hover:opacity-90 font-medium disabled:opacity-50"
            >
              Publish
            </button>
          </div>

          {selected && (
            <div className="text-xs text-muted-foreground">
              Status: <strong>{selected.status || '-'}</strong>
              {selected.createdByUid ? <> • Created by: <strong>{selected.createdByUid}</strong></> : null}
              {selected.approvedByUid ? <> • Approved by: <strong>{selected.approvedByUid}</strong></> : null}
              {selected.publishedByUid ? <> • Published by: <strong>{selected.publishedByUid}</strong></> : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

