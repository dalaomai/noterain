import { cloudConfigured, cloudIndexConfigured, json } from '../_lib/cloud.js';

export async function GET() {
  const available = cloudConfigured();
  return json({
    available,
    upload: available,
    search: available && cloudIndexConfigured(),
    maxFileSize: Number(process.env.CLOUD_MAX_FILE_SIZE ?? 52_428_800),
  }, { status: available ? 200 : 503 });
}

export async function HEAD() {
  return new Response(null, { status: cloudConfigured() ? 200 : 503 });
}