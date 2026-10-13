// Sign-in gate and the app frame: Documents, Shipping bills, Remittances, Settings.
// People sign in with an app password (added in Settings by an admin); nobody needs Odoo.
import { useEffect, useState } from 'react';
import { FileText, Landmark, Loader2, LogOut, Settings as SettingsIcon, Ship } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/sonner';
import { AppSettings, AppUser, loadInit, login, logout, whoAmI } from '@/lib/export-docs-data';
import Editor from '@/pages/Editor';
import Remittances from '@/pages/Remittances';
import Settings from '@/pages/Settings';
import ShippingBills from '@/pages/ShippingBills';

function SignIn({ onSignedIn }: { onSignedIn: (u: AppUser) => void }) {
  const [form, setForm] = useState({ email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { onSignedIn(await login(form.email.trim(), form.password)); }
    catch (err: any) { setError(err?.message || 'Could not sign in'); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><Ship className="h-5 w-5 text-primary" /> Shipping Documents</CardTitle>
          <p className="text-sm text-muted-foreground">Parable Ventures. Sign in with the email and password you were given.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div>
              <Label htmlFor="email" className="text-xs">Email</Label>
              <Input id="email" type="email" autoComplete="username" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs">Password</Label>
              <Input id="password" type="password" autoComplete="current-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !form.email || !form.password}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const TABS = [
  { key: 'docs', label: 'Documents', icon: FileText },
  { key: 'bills', label: 'Shipping bills', icon: Ship },
  { key: 'remit', label: 'Remittances', icon: Landmark },
  { key: 'settings', label: 'Settings', icon: SettingsIcon },
] as const;
type Tab = typeof TABS[number]['key'];

const tabFromHash = (): Tab => {
  const h = window.location.hash.replace('#', '');
  return (TABS.find(t => t.key === h)?.key ?? 'docs') as Tab;
};

export default function App() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);
  const [tab, setTab] = useState<Tab>(tabFromHash);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    whoAmI().then(setUser).catch(e => { setUser(null); toast.error(e?.message || 'Could not reach the app server'); });
    const out = () => setUser(null);
    const hash = () => setTab(tabFromHash());
    window.addEventListener('ip:signed-out', out);
    window.addEventListener('hashchange', hash);
    return () => { window.removeEventListener('ip:signed-out', out); window.removeEventListener('hashchange', hash); };
  }, []);

  useEffect(() => {
    if (user) loadInit().then(r => setSettings(r.settings)).catch(() => { /* Documents shows the setup message */ });
  }, [user]);

  const signOut = async () => {
    try { await logout(); } finally { setUser(null); }
  };

  return (
    <>
      <Toaster />
      {user === undefined && (
        <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}
      {user === null && <SignIn onSignedIn={setUser} />}
      {user && (
        <div className="min-h-screen bg-background">
          <header className="border-b">
            <div className="px-4 sm:px-6 h-14 flex items-center gap-3">
              <h1 className="page-title flex items-center gap-2 shrink-0"><Ship className="h-5 w-5 text-primary" /> <span className="hidden md:inline">Shipping Documents</span></h1>
              <nav className="flex gap-1 overflow-x-auto flex-1 min-w-0">
                {TABS.map(t => (
                  <a key={t.key} href={`#${t.key}`}
                    className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap ${tab === t.key ? 'bg-secondary font-medium' : 'text-muted-foreground hover:text-foreground'}`}>
                    <t.icon className="h-4 w-4" /> <span className="hidden sm:inline">{t.label}</span>
                  </a>
                ))}
              </nav>
              <span className="text-xs text-muted-foreground hidden lg:inline">{user.name || user.email}</span>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={signOut}><LogOut className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Sign out</span></Button>
            </div>
          </header>
          {tab === 'docs' && <Editor settings={settings} />}
          {tab === 'bills' && <ShippingBills />}
          {tab === 'remit' && <Remittances />}
          {tab === 'settings' && <Settings user={user} settings={settings} onSaved={setSettings} />}
        </div>
      )}
    </>
  );
}
