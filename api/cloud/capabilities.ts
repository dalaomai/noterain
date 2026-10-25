import { cloudConfigured, cloudIndexConfigured, json } from '../_lib/cloud.js';

export default async function handler() {
  const available = cloudConfigured();
  return json({
    available,
    upload: available,
    search: available && cloudIndexConfigured(),
    maxFileSize: Number(process.env.CLOUD_MAX_FILE_SIZE ?? 52_428_800),
  }, { status: available ? 200 : 503 });
}