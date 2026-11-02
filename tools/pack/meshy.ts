// Minimal Meshy REST client for the pack tool (https://docs.meshy.ai/en/api). The key comes from MESHY_API_KEY,
// read from the repo's .env file, which is gitignored. Never commit a key.

const BASE = 'https://api.meshy.ai/openapi/v1';

/** Credits per call, as priced on 2026-10-27 (https://docs.meshy.ai/en/api/pricing). Shown before spending. */
export const COST = { art: 9, model: 30 } as const;

/** The models the Baby Army and Dinos were made with. */
export const ART_MODEL = 'nano-banana-pro';
export const MESH_MODEL = 'meshy-7.1';

export type TaskKind = 'text-to-image' | 'image-to-image' | 'image-to-3d';

export interface Task {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'CANCELED';
  progress: number;
  image_urls?: string[];
  model_urls?: { glb?: string };
  task_error?: { message?: string };
  consumed_credits?: number;
}

function key(): string {
  const k = process.env.MESHY_API_KEY;
  if (!k) {
    throw new Error('MESHY_API_KEY is not set. Add a line MESHY_API_KEY=... to the .env file in the repo root (it is gitignored).');
  }
  return k;
}

async function call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = res.status === 402 ? ' (not enough credits, or the model needs a higher Meshy plan)' : res.status === 401 ? ' (check MESHY_API_KEY)' : '';
    throw new Error(`Meshy ${method} ${path} failed: ${res.status}${hint}: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

export async function balance(): Promise<number> {
  return (await call<{ balance: number }>('GET', '/balance')).balance;
}

/** Sticker art: image-to-image when there are style reference images, else text-to-image. Returns the task id. */
export async function createArt(prompt: string, references: string[]): Promise<{ kind: TaskKind; id: string }> {
  const common = { ai_model: ART_MODEL, prompt, aspect_ratio: '3:4', remove_background: true };
  if (references.length) {
    const { result } = await call<{ result: string }>('POST', '/image-to-image', { ...common, reference_image_urls: references.slice(0, 5) });
    return { kind: 'image-to-image', id: result };
  }
  const { result } = await call<{ result: string }>('POST', '/text-to-image', common);
  return { kind: 'text-to-image', id: result };
}

/** Textured 3D model from a finished art task (preferred: no upload) or from an image data URI. */
export async function createModel(from: { artTaskId: string } | { image: string }): Promise<string> {
  const { result } = await call<{ result: string }>('POST', '/image-to-3d', {
    ...('artTaskId' in from ? { input_task_id: from.artTaskId } : { image_url: from.image }),
    ai_model: MESH_MODEL,
    should_texture: true,
    texture_resolution: '2k',
    target_formats: ['glb'],
  });
  return result;
}

export function getTask(kind: TaskKind, id: string): Promise<Task> {
  return call<Task>('GET', `/${kind}/${id}`);
}

/** Polls until the task finishes. A slow or dropped connection never re-creates (and re-charges) a task. */
export async function waitTask(kind: TaskKind, id: string, onProgress: (pct: number) => void): Promise<Task> {
  const deadline = Date.now() + 30 * 60_000;
  for (;;) {
    let task: Task;
    try {
      task = await getTask(kind, id);
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await sleep(10_000); // network blip: the task keeps running on Meshy's side, so just ask again
      continue;
    }
    if (task.status === 'SUCCEEDED') return task;
    if (task.status === 'FAILED' || task.status === 'CANCELED') {
      throw new Error(`Meshy ${kind} task ${id} ${task.status.toLowerCase()}: ${task.task_error?.message ?? 'no reason given'} (failed tasks are refunded; re-run with --fresh to try again)`);
    }
    onProgress(task.progress ?? 0);
    if (Date.now() > deadline) throw new Error(`Meshy ${kind} task ${id} is still running after 30 minutes. Re-run the same command later to pick it up.`);
    await sleep(5_000);
  }
}

export async function download(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url.slice(0, 80)}`);
  return Buffer.from(await res.arrayBuffer());
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
