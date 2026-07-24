-- Launchify Sites — Supabase schema (new, separate project)
-- Run this in the Supabase SQL editor for your new Launchify project.

-- ============================================================
-- SITES TABLE
-- ============================================================
create table if not exists public.sites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  business_description text not null,
  html_content text not null,
  images jsonb default '[]'::jsonb,       -- array of {token, generated: bool}
  slug text unique,                        -- set on publish, e.g. "abc123"
  custom_domain text unique,               -- e.g. "coffeeshop.com", optional
  published boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists sites_user_id_idx on public.sites(user_id);
create index if not exists sites_slug_idx on public.sites(slug) where slug is not null;
create index if not exists sites_custom_domain_idx on public.sites(custom_domain) where custom_domain is not null;

alter table public.sites enable row level security;

-- Owners can do everything with their own rows.
create policy "Users can view their own sites"
  on public.sites for select
  using (auth.uid() = user_id);

create policy "Users can insert their own sites"
  on public.sites for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own sites"
  on public.sites for update
  using (auth.uid() = user_id);

create policy "Users can delete their own sites"
  on public.sites for delete
  using (auth.uid() = user_id);

-- Published sites are readable by anyone (needed for the public
-- /sites/:slug view — that Netlify function uses the anon key, not the
-- service role key, so this policy is what makes published pages visible).
create policy "Anyone can view published sites"
  on public.sites for select
  using (published = true);

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists sites_set_updated_at on public.sites;
create trigger sites_set_updated_at
  before update on public.sites
  for each row execute function public.set_updated_at();

-- ============================================================
-- STORAGE — real image storage for SAVED sites
-- ============================================================
-- The live, unsaved preview still embeds images as base64 (ephemeral,
-- matches the original design). Once a user clicks Save, save-site.js
-- uploads those images to this bucket and rewrites the HTML to
-- reference real URLs instead — much lighter pages, real CDN delivery,
-- same as any production site builder.
--
-- Run this after creating a public bucket named "site-images" in the
-- Supabase dashboard (Storage → New bucket → name: site-images → Public: on).

create policy "Anyone can view site images"
  on storage.objects for select
  using (bucket_id = 'site-images');

create policy "Service role can upload site images"
  on storage.objects for insert
  with check (bucket_id = 'site-images');

-- ============================================================
-- AUTH SETUP (do this in the Supabase dashboard, not SQL)
-- ============================================================
-- 1. Authentication → Providers → Email: already on by default.
-- 2. Authentication → Providers → Google: toggle on, add your Google
--    OAuth client ID + secret (same pattern as Never Worry Wealth's
--    Google OAuth setup, but this is a SEPARATE Google OAuth client —
--    don't reuse Never Worry Wealth's, since redirect URLs differ).
-- 3. Authentication → URL Configuration → Redirect URLs: add your real
--    Launchify domain once it's live, e.g. https://launchifysites.com/**
