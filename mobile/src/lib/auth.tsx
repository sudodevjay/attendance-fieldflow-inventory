/** Who is logged in (the /me profile), shared by all screens. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, session } from './api';

export interface Me {
  id: number; enrollNo: string; name: string; designation: string; department: string; shift: string; phone: string; email: string;
  gender: string; badgeNo: string; joinDate: string; birthDate: string; address: string; photo: string | null; isManager: boolean;
  mustChange: boolean; company: string; office: string; allowCheckIn: boolean;
  reportingManager: string;
  /** HR profile; Aadhaar and bank account come masked (last 4 digits). */
  hr: Record<HrField, string>;
  /** Fields the employee may ask HR to change. */
  selfFields: string[];
  pendingProfileChange: boolean;
}

export type HrField = 'EmergencyName' | 'EmergencyRelation' | 'EmergencyPhone' | 'BloodGroup' | 'MaritalStatus' | 'PersonalEmail' | 'Pan'
  | 'Aadhaar' | 'Uan' | 'PfNo' | 'EsiNo' | 'BankName' | 'BankAccount' | 'BankIfsc' | 'AccountHolder';

interface Auth {
  ready: boolean;
  me: Me | null;
  reload: () => Promise<void>;
  login: (server: string, enrollNo: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<Auth | null>(null);
export const useAuth = () => useContext(Ctx)!;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [me, setMe] = useState<Me | null>(null);

  const reload = useCallback(async () => {
    if (!session.token()) { setMe(null); return; }
    try { setMe(await api.get<Me>('/me')); } catch { setMe(null); }
  }, []);

  useEffect(() => {
    session.onLogout(() => setMe(null));
    session.load().then(reload).finally(() => setReady(true));
  }, [reload]);

  const login = useCallback(async (server: string, enrollNo: string, password: string) => {
    await session.setServer(server);
    const r = await api.post<{ token: string }>('/login', { enrollNo: enrollNo.trim(), password });
    await session.setToken(r.token);
    await reload();
  }, [reload]);

  const logout = useCallback(async () => {
    api.post('/logout').catch(() => {});
    await session.setToken('');
    setMe(null);
  }, []);

  return <Ctx.Provider value={{ ready, me, reload, login, logout }}>{children}</Ctx.Provider>;
}
