// netlify/functions/_verifyUser.js
//
// Shared helper: verifies a Supabase user access token by calling
// Supabase Auth's /auth/v1/user endpoint directly. Avoids needing the
// @supabase/supabase-js package (and therefore any npm install/build
// step) in these functions — plain fetch is enough.
//
// Returns the user object on success, or null if the token is missing/invalid.

async function verifyUser(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length);

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;

  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
      },
    });
    if (!res.ok) return null;
    return await res.json(); // { id, email, ... }
  } catch {
    return null;
  }
}

module.exports = { verifyUser };
