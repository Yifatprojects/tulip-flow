# Supabase password reset (TULIP Flow)

## Link validity (10+ minutes)

OTP / reset link lifetime is set in **Supabase Dashboard**, not in this app:

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **Authentication** → **Providers** → **Email**.
2. Set **Email OTP Expiration** to at least **600** seconds (10 minutes). The default is often **3600** (1 hour).
3. Save.

If links fail immediately, common causes are:

- Opening an **older** reset email (only the **latest** link works).
- Email **preview/scanners** opening the link once before you do.
- **Redirect URL** missing: add `https://tulip-flow.vercel.app/reset-password` under **Authentication** → **URL configuration** → **Redirect URLs**.

## Email template (recommended)

Under **Authentication** → **Email Templates** → **Reset password**, use a link that includes the token, for example:

```html
<a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">
  Reset password
</a>
```

Or rely on `{{ .ConfirmationURL }}` with `redirectTo` set to `https://tulip-flow.vercel.app/reset-password` from the app.

## Site URL

**Authentication** → **URL configuration**:

- **Site URL**: `https://tulip-flow.vercel.app`
- **Redirect URLs**: `https://tulip-flow.vercel.app/reset-password`, `http://localhost:5173/reset-password`
