import { createAuthClient } from '@neon/auth';
import { BetterAuthVanillaAdapter } from '@neon/auth/adapters';

const authUrl = import.meta.env.VITE_NEON_AUTH_URL || (typeof window !== 'undefined' ? window.NEON_AUTH_URL : null);

export const authClient = createAuthClient(authUrl, {
  adapter: BetterAuthVanillaAdapter(),
});

export async function signUp(email, password, name) {
  const { data, error } = await authClient.signUp.email({ email, password, name });
  if (error) throw new Error(error.message);
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await authClient.signIn.email({ email, password });
  if (error) throw new Error(error.message);
  return data;
}

export async function signOut() {
  const { error } = await authClient.signOut();
  if (error) throw new Error(error.message);
}

export async function getSession() {
  const { data, error } = await authClient.getSession();
  if (error) throw new Error(error.message);
  return data;
}

export async function getJwtToken() {
  const { data, error } = await authClient.getSession();
  if (error) throw new Error(error.message);
  return data?.session?.token;
}

export async function sendVerificationEmail(email) {
  const res = await fetch('/api/auth/send-verification-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Failed to send verification email');
  return data;
}

export async function verifyEmail(email, code) {
  const res = await fetch('/api/auth/verify-email', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Verification failed');
  return data;
}