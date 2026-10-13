// Sign-in gate and the app frame. People sign in with their own Odoo login.
import { useEffect, useState } from 'react';
import { FileText, Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/sonner';
import { AppUser, login, logout, whoAmI } from '@/lib/export-docs-data';
import Editor from '@/pages/Editor';

function SignIn({ onSignedIn }: { onSignedIn: (u: AppUser) => void }) {
  const [form, setForm] = useState({ login: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { onSignedIn(await login(form.login.trim(), form.password)); }
    catch (err: any) { setError(err?.message || 'Could not sign in'); }
    finally { setBusy(false); }
  };
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <Card className="w-full max-w-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2"><FileText className="h-5 w-5 text-primary" /> Invoice &amp; Packing List</CardTitle>
          <p className="text-sm text-muted-foreground">Sign in with your Odoo login.</p>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div>
              <Label htmlFor="login" className="text-xs">Odoo email</Label>
              <Input id="login" autoComplete="username" value={form.login} onChange={e => setForm(f => ({ ...f, login: e.target.value }))} />
            </div>
            <div>
              <Label htmlFor="password" className="text-xs">Password or API key</Label>
              <Input id="password" type="password" autoComplete="current-password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy || !form.login || !form.password}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Sign in
            </Button>
            <p className="text-[11px] text-muted-foreground">If your Odoo account uses two-step sign-in, use an API key from Odoo → My Profile → Account Security.</p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<AppUser | null | undefined>(undefined);

  useEffect(() => {
    whoAmI().then(setUser).catch(e => { setUser(null); toast.error(e?.message || 'Could not reach the app server'); });
    const out = () => setUser(null);
    window.addEventListener('ip:signed-out', out);
    return () => window.removeEventListener('ip:signed-out', out);
  }, []);

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
            <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center gap-3">
              <h1 className="page-title flex items-center gap-2 flex-1 min-w-0 truncate">
                <FileText className="h-5 w-5 text-primary shrink-0" /> Commercial Invoice &amp; Packing List
              </h1>
              <span className="text-xs text-muted-foreground hidden sm:inline">{user.name}</span>
              <Button variant="ghost" size="sm" className="h-8 gap-1.5" onClick={signOut}><LogOut className="h-3.5 w-3.5" /> Sign out</Button>
            </div>
          </header>
          <Editor />
        </div>
      )}
    </>
  );
}
