import type { MidiFile } from '../../types/midi';
import { loadScoreHistoryFile } from '../../utils/midiDb';
import { uploadScoreSilently } from './cloudApi';

const STORAGE_KEY = 'noterain-cloud-upload-queue-v1';
const RETRY_DELAYS = [10_000, 30_000, 120_000, 600_000, 3_600_000];

interface CloudUploadJob {
  id: string;
  historyId: string;
  title?: string;
  duration: number;
  sourceFormat: MidiFile['sourceFormat'];
  attempts: number;
  nextRetryAt: number;
}

let processing = false;
let retryTimer: number | undefined;

function readQueue(): CloudUploadJob[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeQueue(jobs: CloudUploadJob[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(jobs));
}

function scheduleNext(jobs: CloudUploadJob[]) {
  window.clearTimeout(retryTimer);
  const next = Math.min(...jobs.map((job) => job.nextRetryAt));
  if (!Number.isFinite(next)) return;
  retryTimer = window.setTimeout(
    () => void processCloudUploadQueue(),
    Math.max(1_000, next - Date.now()),
  );
}

export function enqueueCloudUpload(historyId: string, score: MidiFile) {
  const jobs = readQueue();
  if (!jobs.some((job) => job.historyId === historyId)) {
    jobs.push({
      id: crypto.randomUUID(),
      historyId,
      title: score.title,
      duration: score.duration,
      sourceFormat: score.sourceFormat,
      attempts: 0,
      nextRetryAt: Date.now(),
    });
    writeQueue(jobs);
  }
  void processCloudUploadQueue();
}

export async function processCloudUploadQueue() {
  if (processing || !navigator.onLine) return;
  processing = true;
  try {
    const jobs = readQueue();
    for (const job of [...jobs]) {
      if (job.nextRetryAt > Date.now()) continue;
      try {
        const source = await loadScoreHistoryFile(job.historyId);
        const uploaded = await uploadScoreSilently(source, {
          id: job.id,
          name: source.name,
          title: job.title,
          duration: job.duration,
          sourceFormat: job.sourceFormat,
        } as MidiFile);
        if (uploaded) jobs.splice(jobs.indexOf(job), 1);
        else throw new Error('UPLOAD_DEFERRED');
      } catch (error) {
        if (error instanceof Error && /no longer available/i.test(error.message)) {
          jobs.splice(jobs.indexOf(job), 1);
          continue;
        }
        job.attempts++;
        job.nextRetryAt = Date.now()
          + RETRY_DELAYS[Math.min(job.attempts - 1, RETRY_DELAYS.length - 1)];
      }
      writeQueue(jobs);
    }
    scheduleNext(jobs);
  } finally {
    processing = false;
  }
}

export function startCloudUploadQueue() {
  const resume = () => void processCloudUploadQueue();
  window.addEventListener('online', resume);
  resume();
  return () => {
    window.removeEventListener('online', resume);
    window.clearTimeout(retryTimer);
  };
}