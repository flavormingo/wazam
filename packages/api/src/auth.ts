import { betterAuth } from 'better-auth';
import { username } from 'better-auth/plugins';
import pg from 'pg';
import { Kysely, PostgresDialect } from 'kysely';
import { Resend } from 'resend';
import { VALENTINO_ID } from '@wazup/shared';
import { config } from './config.js';
import type { Database } from './db/database.js';
import { befriendValentino } from './valentino.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl });
const db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
const resend = new Resend(config.resendApiKey);

const FONT = "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

function emailTemplate(title: string, body: string) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title}</title></head>
<body style="margin:0;padding:0;background:#0B1128;font-family:${FONT}">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0B1128;padding:48px 20px">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:40px 36px">
<tr><td>
<div style="margin-bottom:32px">
<span style="font-size:24px;font-weight:800;color:#FFC72C;letter-spacing:-0.5px">wazup</span>
</div>
<h2 style="margin:0 0 12px;font-size:18px;font-weight:600;color:#f0f0f5;font-family:${FONT}">${title}</h2>
${body}
<div style="margin-top:32px;padding-top:20px;border-top:1px solid rgba(255,255,255,0.06)">
<p style="margin:0;font-size:12px;color:#5a5a70;line-height:1.5">If you didn't request this, you can safely ignore this email.</p>
</div>
</td></tr></table>
<p style="margin:20px 0 0;font-size:11px;color:#3a3a4e;font-family:${FONT}">wazup.chat</p>
</td></tr></table>
</body></html>`;
}

async function sendEmail(to: string, subject: string, html: string) {
  console.log(`Sending email to=${to} subject="${subject}"`);
  const { data, error } = await resend.emails.send({
    from: 'wazup <noreply@wazup.chat>',
    to,
    subject,
    html,
  });
  if (error) {
    console.error('Resend error:', JSON.stringify(error));
    throw new Error(`Failed to send email: ${error.message}`);
  }
  console.log(`Email sent id=${data?.id} to=${to}`);
}

export const auth = betterAuth({
  database: pool,
  baseURL: config.apiUrl,
  basePath: '/api/auth',
  secret: config.betterAuthSecret,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    async sendResetPassword({ user, url }: { user: { email: string }; url: string }) {
      await sendEmail(user.email, 'Reset your password', emailTemplate('Reset your password', `
<p style="margin:0 0 24px;font-size:14px;color:#a0a0b8;line-height:1.6;font-family:${FONT}">We received a request to reset the password for your wazup account. Click the button below to choose a new password.</p>
<a href="${url}" style="display:inline-block;padding:12px 28px;background:#FFC72C;color:#0B1128;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;font-family:${FONT}">Reset Password</a>
<p style="margin:16px 0 0;font-size:12px;color:#5a5a70;word-break:break-all;font-family:${FONT}">Or copy this link: ${url}</p>`));
    },
  },
  emailVerification: {
    autoSignInAfterVerification: true,
    async sendVerificationEmail({ user, url }) {
      await sendEmail(user.email, 'Verify your wazup account', emailTemplate('Verify your email', `
<p style="margin:0 0 24px;font-size:14px;color:#a0a0b8;line-height:1.6;font-family:${FONT}">Please verify this email address to confirm it belongs to your wazup account.</p>
<a href="${url}" style="display:inline-block;padding:12px 28px;background:#FFC72C;color:#0B1128;text-decoration:none;border-radius:8px;font-size:14px;font-weight:700;font-family:${FONT}">Verify Email</a>
<p style="margin:16px 0 0;font-size:12px;color:#5a5a70;word-break:break-all;font-family:${FONT}">Or copy this link: ${url}</p>`));
    },
    async afterEmailVerification(user: { id: string }) {
      if (user.id === VALENTINO_ID) return;
      try {
        await befriendValentino(db, user.id);
      } catch (err) {
        console.error('Valentino onboarding failed:', err);
      }
    },
  },
  plugins: [username()],
  user: {
    modelName: 'users',
    changeEmail: {
      enabled: true,
    },
    deleteUser: {
      enabled: true,
    },
    fields: {
      name: 'display_name',
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    additionalFields: {
      avatar_key: {
        type: 'string',
        required: false,
        input: false,
      },
    },
  },
  session: {
    modelName: 'sessions',
    fields: {
      userId: 'user_id',
      expiresAt: 'expires_at',
      ipAddress: 'ip_address',
      userAgent: 'user_agent',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  account: {
    modelName: 'accounts',
    fields: {
      userId: 'user_id',
      accountId: 'account_id',
      providerId: 'provider_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      idToken: 'id_token',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  verification: {
    modelName: 'verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  rateLimit: {
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/*': { window: 60, max: 10 },
      '/sign-up/*': { window: 60, max: 5 },
      '/send-verification-email': { window: 60, max: 3 },
      '/request-password-reset': { window: 60, max: 3 },
    },
  },
  trustedOrigins: [config.webUrl],
});
