import { createRemoteJWKSet, jwtVerify } from 'jose';

let jwksCache = null;
let jwksFetchedAt = 0;

async function getJWKS() {
  const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
  if (!jwksUrl) throw new Error('NEON_AUTH_JWKS_URL not configured');

  const now = Date.now();
  if (jwksCache && now - jwksFetchedAt < 5 * 60 * 1000) {
    return jwksCache;
  }

  const response = await fetch(jwksUrl);
  if (!response.ok) throw new Error(`Failed to fetch JWKS: ${response.status}`);
  jwksCache = await response.json();
  jwksFetchedAt = now;
  return jwksCache;
}

export async function verifyNeonAuthToken(token) {
  if (!token || typeof token !== 'string') return null;

  try {
    const jwks = await getJWKS();
    const jwksUri = process.env.NEON_AUTH_JWKS_URL;
    const remoteJWKS = createRemoteJWKSet(new URL(jwksUri));
    const { payload } = await jwtVerify(token, remoteJWKS, {
      issuer: process.env.NEON_AUTH_BASE_URL?.replace('/auth', ''),
      audience: process.env.NEON_AUTH_BASE_URL?.replace('/auth', ''),
    });
    return payload;
  } catch (err) {
    console.warn('JWT verification failed:', err.message);
    return null;
  }
}

export async function getSessionFromCookie(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/neon_auth_session=([^;]+)/);
  if (!match) return null;
  const token = decodeURIComponent(match[1]);
  return verifyNeonAuthToken(token);
}