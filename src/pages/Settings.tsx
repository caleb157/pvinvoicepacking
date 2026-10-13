// Settings: company details used on the documents (LUT, AD code, signatory) and, for admins,
// the people who can sign in (app passwords; the admin from Vercel always works).
import { useEffect, useState } from 'react';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Field } from '@/components/PartyEditor';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { AppSettings, AppUser, UserRow, deleteUser, listUsers, saveSettings, saveUser } from '@/lib/export-docs-data';

/** Reads an image file and shrinks it to at most 600 px wide as a PNG data URL (keeps transparency). */
async function shrinkImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Not an image')); i.src = url; });
    const scale = Math.min(1, 600 / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally { URL.revokeObjectURL(url); }
}

function ImagePick({ label, value, onChange, disabled }: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="flex items-center gap-2">
        <div className="h-16 w-36 rounded border bg-white flex items-center justify-center overflow-hidden">
          {value ? <img src={value} alt={label} className="max-h-full max-w-full object-contain" /> : <span className="text-[11px] text-muted-foreground">none</span>}
        </div>
        {!disabled && (
          <div className="flex flex-col gap-1">
            <label className="text-xs underline cursor-pointer">
              {value ? 'Replace' : 'Upload'}
              <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={async e => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                try { onChange(await shrinkImage(f)); } catch (err: any) { toast.error(err?.message || 'Could not read the image'); }
              }} />
            </label>
            {value && <button type="button" className="text-xs underline text-left text-muted-foreground" onClick={() => onChange('')}>Remove</button>}
          </div>
        )}
      </div>
    </div>
  );
}

interface Draft { id: string | null; email: string; name: string; is_admin: boolean; disabled: boolean; password: string }
const blank: Draft = { id: null, email: '', name: '', is_admin: false, disabled: false, password: '' };

function People() {
  const [users, setUsers] = useState<UserRow[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { listUsers().then(setUsers).catch((e: any) => { setUsers([]); toast.error(e?.message || 'Could not load people'); }); }, []);

  const submit = async () => {
    if (!draft) return;
    if (!draft.id && draft.password.length < 8) { toast.error('Give them a password of at least 8 characters'); return; }
    setBusy(true);
    try {
      setUsers(await saveUser({ ...draft, password: draft.password || null }));
      toast.success(draft.id ? 'Saved' : `${draft.email} can now sign in`);
      setDraft(null);
    } catch (e: any) { toast.error(e?.message || 'Could not save'); }
    finally { setBusy(false); }
  };
  const remove = async (u: UserRow) => {
    if (!window.confirm(`Remove ${u.email}? They will no longer be able to sign in.`)) return;
    try { setUsers(await deleteUser(u.id)); } catch (e: any) { toast.error(e?.message || 'Could not remove'); }
  };

  return (
    <Card>
      <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm">People who can sign in</CardTitle>
        <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setDraft(blank)}><Plus className="h-3.5 w-3.5" /> Add person</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {!users && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {users && (
          <div className="divide-y rounded border">
            {users.length === 0 && <div className="p-3 text-xs text-muted-foreground">Nobody yet besides the admin set in Vercel.</div>}
            {users.map(u => (
              <div key={u.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{u.name || u.email}</div>
                  <div className="text-xs text-muted-foreground truncate">{u.email}{u.is_admin ? ' · admin' : ''}{u.disabled ? ' · disabled' : ''}</div>
                </div>
                <Button size="sm" variant="ghost" className="h-8" onClick={() => setDraft({ ...u, password: '' })}>Edit</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" title="Remove" onClick={() => remove(u)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
        {draft && (
          <div className="rounded border p-3 space-y-2">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="Email" value={draft.email} onChange={email => setDraft({ ...draft, email })} />
              <Field label="Name" value={draft.name} onChange={name => setDraft({ ...draft, name })} />
              <div>
                <label className="text-[11px] text-muted-foreground">{draft.id ? 'New password (leave blank to keep)' : 'Password (8+ characters)'}</label>
                <Input className="h-8 text-sm" type="password" autoComplete="new-password" value={draft.password} onChange={e => setDraft({ ...draft, password: e.target.value })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <label className="flex items-center gap-2"><Checkbox checked={draft.is_admin} onCheckedChange={v => setDraft({ ...draft, is_admin: !!v })} /> Admin (can manage people and settings)</label>
              <label className="flex items-center gap-2"><Checkbox checked={draft.disabled} onCheckedChange={v => setDraft({ ...draft, disabled: !!v })} /> Disabled</label>
              <div className="flex-1" />
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
              <Button size="sm" onClick={submit} disabled={busy || !draft.email.trim()}>{busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Save</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Share the password with them directly; they sign in with this email and password.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Settings({ user, settings, onSaved }: { user: AppUser; settings: AppSettings | null; onSaved: (s: AppSettings) => void }) {
  const [form, setForm] = useState<AppSettings | null>(settings);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(settings), [settings]);
  const set = (p: Partial<AppSettings>) => setForm(f => (f ? { ...f, ...p } : f));

  const submit = async () => {
    if (!form) return;
    setBusy(true);
    try { onSaved(await saveSettings(form)); toast.success('Settings saved'); }
    catch (e: any) { toast.error(e?.missingTables ? 'Run sql/setup.sql first.' : e?.message || 'Could not save'); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Document details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {!form && <p className="text-xs text-muted-foreground">Settings load once the database is set up.</p>}
          {form && (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                <Field label="LUT ARN" value={form.lutArn} onChange={lutArn => set({ lutArn })} className="sm:col-span-3" />
                <Field label="LUT valid from" type="date" value={form.lutFrom} onChange={lutFrom => set({ lutFrom })} />
                <Field label="LUT valid to" type="date" value={form.lutTo} onChange={lutTo => set({ lutTo })} />
                <Field label="AD code (HDFC)" value={form.adCode} onChange={adCode => set({ adCode })} />
                <Field label="Signatory name" value={form.signatoryName} onChange={signatoryName => set({ signatoryName })} />
                <Field label="Signatory title" value={form.signatoryTitle} onChange={signatoryTitle => set({ signatoryTitle })} />
              </div>
              <div className="flex flex-wrap gap-6">
                <ImagePick label="Signature (printed on the letters)" value={form.signatureImage || ''} onChange={signatureImage => set({ signatureImage })} disabled={!user.admin} />
                <ImagePick label="Company stamp" value={form.stampImage || ''} onChange={stampImage => set({ stampImage })} disabled={!user.admin} />
              </div>
              <p className="text-[11px] text-muted-foreground">Use PNGs with a transparent background for the cleanest print. Leave both empty to sign the letters by hand.</p>
              {user.admin
                ? <Button size="sm" className="gap-1.5" onClick={submit} disabled={busy}>{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save</Button>
                : <p className="text-xs text-muted-foreground">Only admins can change these.</p>}
            </>
          )}
        </CardContent>
      </Card>
      {user.admin && <People />}
    </div>
  );
}
