import 'dotenv/config';

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  nodeEnv: optional('NODE_ENV', 'development'),
  port: parseInt(optional('PORT', '3000'), 10),
  host: optional('HOST', '0.0.0.0'),

  betterAuthSecret: required('BETTER_AUTH_SECRET'),

  databaseUrl: required('DATABASE_URL'),

  redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),

  minioEndpoint: optional('MINIO_ENDPOINT', 'localhost'),
  minioPort: parseInt(optional('MINIO_PORT', '9000'), 10),
  minioAccessKey: optional('MINIO_ACCESS_KEY', 'minioadmin'),
  minioSecretKey: optional('MINIO_SECRET_KEY', 'minioadmin'),
  minioBucket: optional('MINIO_BUCKET', 'wazup'),
  minioUseSsl: optional('MINIO_USE_SSL', 'false') === 'true',
  minioPublicEndpoint: process.env.MINIO_PUBLIC_ENDPOINT || '',
  minioPublicPort: parseInt(optional('MINIO_PUBLIC_PORT', '443'), 10),
  minioPublicUseSsl: optional('MINIO_PUBLIC_USE_SSL', 'true') === 'true',

  livekitUrl: optional('LIVEKIT_URL', 'ws://localhost:7880'),
  livekitPublicUrl: optional('LIVEKIT_PUBLIC_URL', ''),
  livekitApiKey: optional('LIVEKIT_API_KEY', 'devkey'),
  livekitApiSecret: optional('LIVEKIT_API_SECRET', 'devsecret'),

  resendApiKey: required('RESEND_API_KEY'),

  apiUrl: optional('API_URL', 'http://localhost:3000'),
  webUrl: optional('WEB_URL', 'http://localhost:5173'),

  vapidPublicKey: optional('VAPID_PUBLIC_KEY', ''),
  vapidPrivateKey: optional('VAPID_PRIVATE_KEY', ''),
  vapidSubject: optional('VAPID_SUBJECT', 'mailto:admin@waz.am'),
} as const;
