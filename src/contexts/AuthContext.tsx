import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User } from '@supabase/supabase-js';
import { App } from '@capacitor/app';
import { Browser } from '@capacitor/browser';
import { Capacitor } from '@capacitor/core';
import { supabase, Profile } from '../lib/supabase';

type AuthContextType = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  authError: string | null;
  retryProfile: () => Promise<void>;
  signUp: (email: string, password: string, fullName: string, phone?: string) => Promise<{ requiresEmailConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<void>;
  signInWithOAuth: (provider: 'google' | 'facebook') => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const BOOTSTRAP_ADMIN_EMAIL = 'admin@admin.com';
const PROFILE_LOAD_RETRY_DELAYS_MS = [500, 1500];
const CAPACITOR_AUTH_REDIRECT_URL = 'com.sistemapedidos.web://auth/callback';

function isNetworkError(error: unknown) {
  if (error instanceof Error) {
    return /failed to fetch|networkerror|load failed/i.test(error.message);
  }

  if (error && typeof error === 'object' && 'message' in error) {
    return /failed to fetch|networkerror|load failed/i.test(String(error.message));
  }

  return false;
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) return error.message;

  if (error && typeof error === 'object') {
    const { message, code, details, hint } = error as Record<string, unknown>;
    const parts = [message, code && `Codigo: ${code}`, details, hint].filter(
      (part): part is string => typeof part === 'string' && part.length > 0,
    );

    if (parts.length > 0) return parts.join(' - ');
  }

  return fallback;
}

function getAuthRedirectUrl() {
  const configuredRedirectUrl = import.meta.env.VITE_AUTH_REDIRECT_URL?.trim();
  if (configuredRedirectUrl) return configuredRedirectUrl;

  if (Capacitor.isNativePlatform()) return CAPACITOR_AUTH_REDIRECT_URL;

  return window.location.origin;
}

function getOAuthCallbackError() {
  const params = new URLSearchParams(window.location.search);
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const error = params.get('error') || hashParams.get('error');
  const description = params.get('error_description') || hashParams.get('error_description');

  if (!error && !description) return null;

  return description || error || 'No se pudo completar el inicio de sesion con el proveedor';
}

function clearOAuthCallbackError() {
  if (!window.history.replaceState) return;

  const url = new URL(window.location.href);
  url.searchParams.delete('error');
  url.searchParams.delete('error_code');
  url.searchParams.delete('error_description');

  if (url.hash.includes('error')) {
    url.hash = '';
  }

  window.history.replaceState({}, document.title, url.toString());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    let removeAppUrlOpenListener: (() => void) | undefined;

    async function initializeSession() {
      try {
        const oauthCallbackError = getOAuthCallbackError();
        if (oauthCallbackError) {
          setAuthError(oauthCallbackError);
          clearOAuthCallbackError();
        }

        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!isMounted) return;

        setUser(session?.user ?? null);
        if (session?.user) {
          await loadProfile(session.user);
        } else {
          setLoading(false);
        }
      } catch (error) {
        if (!isMounted) return;
        console.error('Error initializing session:', error);
        setAuthError(getErrorMessage(error, 'No se pudo iniciar la sesion'));
        setLoading(false);
      }
    }

    void initializeSession();

    if (Capacitor.isNativePlatform()) {
      void App.addListener('appUrlOpen', async (event) => {
        if (!event.url.startsWith(CAPACITOR_AUTH_REDIRECT_URL)) return;

        try {
          await Browser.close();
        } catch {
          // Browser.close can fail if the browser was already dismissed.
        }

        const callbackUrl = new URL(event.url);
        const errorDescription = callbackUrl.searchParams.get('error_description');
        const error = callbackUrl.searchParams.get('error');
        const code = callbackUrl.searchParams.get('code');

        if (errorDescription || error) {
          setAuthError(errorDescription || error || 'No se pudo completar el inicio de sesion con Google');
          setLoading(false);
          return;
        }

        if (!code) return;

        setLoading(true);
        setAuthError(null);

        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setAuthError(getErrorMessage(exchangeError, 'No se pudo completar el inicio de sesion con Google'));
          setLoading(false);
        }
      }).then((listener) => {
        removeAppUrlOpenListener = () => void listener.remove();
      });
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isMounted) return;

      setUser(session?.user ?? null);
      if (session?.user) {
        setLoading(true);
        // Run database queries after the auth callback releases its internal lock.
        setTimeout(() => {
          if (isMounted) void loadProfile(session.user);
        }, 0);
      } else {
        setProfile(null);
        setAuthError(null);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      removeAppUrlOpenListener?.();
      subscription.unsubscribe();
    };
  }, []);

  async function loadProfile(authUser: User) {
    setLoading(true);
    setAuthError(null);

    try {
      const fetchProfile = () => supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle();

      let profileResult = await fetchProfile();
      for (const retryDelay of PROFILE_LOAD_RETRY_DELAYS_MS) {
        if (!profileResult.error || !isNetworkError(profileResult.error)) break;
        await wait(retryDelay);
        profileResult = await fetchProfile();
      }

      const { data, error } = profileResult;

      if (error) throw error;

      if (data) {
        setProfile(data);
        return;
      }

      const recoveredProfile = await createMissingProfile(authUser);
      setProfile(recoveredProfile);
    } catch (error) {
      console.error('Error loading profile:', error);
      setProfile(null);
      setAuthError(
        isNetworkError(error)
          ? 'No se pudo conectar con Supabase. Verifica la conexion a Internet y vuelve a intentar.'
          : getErrorMessage(error, 'No se pudo cargar el perfil del usuario'),
      );
    } finally {
      setLoading(false);
    }
  }

  async function createMissingProfile(authUser: User) {
    const metadataRole = authUser.app_metadata?.role || authUser.user_metadata?.role;
    const role: Profile['role'] =
      authUser.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL
        ? 'admin'
        : metadataRole === 'admin' || metadataRole === 'restaurant_owner' || metadataRole === 'driver' || metadataRole === 'waiter'
          ? metadataRole
          : 'customer';

    const metadataFullName = authUser.user_metadata?.full_name || authUser.user_metadata?.name;
    const fullName =
      typeof metadataFullName === 'string' && metadataFullName.trim()
        ? metadataFullName.trim()
        : authUser.email || 'Usuario';

    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: authUser.id,
        email: authUser.email || '',
        full_name: fullName,
        role,
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async function signUp(email: string, password: string, fullName: string, phone?: string) {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName,
          role: 'customer',
          phone: phone || null,
        },
      },
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('No user returned');

    if (authData.session) {
      await loadProfile(authData.user);
    }

    return { requiresEmailConfirmation: !authData.session };
  }

  async function signIn(email: string, password: string) {
    setAuthError(null);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
  }

  async function signInWithOAuth(provider: 'google' | 'facebook') {
    setAuthError(null);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: getAuthRedirectUrl(),
        skipBrowserRedirect: Capacitor.isNativePlatform(),
      },
    });

    if (error) throw error;

    if (Capacitor.isNativePlatform() && data.url) {
      await Browser.open({ url: data.url });
    }
  }

  async function signOut() {
    setUser(null);
    setProfile(null);
    setAuthError(null);
    setLoading(false);

    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) {
      console.error('Error signing out:', error);
      throw error;
    }
  }

  async function retryProfile() {
    if (user) await loadProfile(user);
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, authError, retryProfile, signUp, signIn, signInWithOAuth, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
