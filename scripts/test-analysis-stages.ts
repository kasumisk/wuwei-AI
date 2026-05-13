/**
 * 测试图片分析渐进式阶段接口
 *
 * 用途：登录 → 上传图片 → 循环轮询 → 打印每个 stage 到达时间戳和耗时
 *
 * 运行方式：
 *   npx ts-node --project apps/api-server/tsconfig.json scripts/test-analysis-stages.ts [图片路径]
 *   # 默认使用 images/ 目录下第一张 .jpeg
 *
 * 环境：API server 必须在 http://localhost:4000 运行
 */

import * as fs from 'fs';
import * as path from 'path';
import * as FormData from 'form-data';
import fetch from 'node-fetch';

const BASE_URL = process.env.API_URL ?? 'http://localhost:4000';
const PHONE = process.env.TEST_PHONE ?? '13800138001';
const CODE = '888888';
const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 120_000;

// ─── helpers ──────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().replace('T', ' ').slice(0, 23);
}

function elapsed(start: number): string {
  return `+${Date.now() - start}ms`;
}

async function json(res: Awaited<ReturnType<typeof fetch>>) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ─── auth ─────────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
  // 1. send code
  const sendRes = await fetch(`${BASE_URL}/api/app/auth/phone/send-code`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, type: 'login' }),
  });
  const sendBody = await json(sendRes);
  if (!sendRes.ok) {
    throw new Error(`send-code failed: ${JSON.stringify(sendBody)}`);
  }

  // 2. verify
  const verifyRes = await fetch(`${BASE_URL}/api/app/auth/phone/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: PHONE, code: CODE }),
  });
  const verifyBody = await json(verifyRes);
  if (!verifyRes.ok || !verifyBody.data?.token) {
    throw new Error(`verify failed: ${JSON.stringify(verifyBody)}`);
  }
  return verifyBody.data.token as string;
}

// ─── upload ───────────────────────────────────────────────────────────────────

async function uploadImage(token: string, imagePath: string): Promise<string> {
  const form = new FormData();
  form.append('file', fs.createReadStream(imagePath), {
    filename: path.basename(imagePath),
    contentType: 'image/jpeg',
  });

  const res = await fetch(`${BASE_URL}/api/app/food/analyze`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      ...form.getHeaders(),
    },
    body: form,
  });
  const body = await json(res);
  if (!res.ok || !body.data?.requestId) {
    throw new Error(`analyze POST failed: ${JSON.stringify(body)}`);
  }
  return body.data.requestId as string;
}

// ─── poll ─────────────────────────────────────────────────────────────────────

async function poll(token: string, requestId: string): Promise<void> {
  const start = Date.now();
  const seen = new Set<string>();

  console.log(`\n[${ts()}] 开始轮询 requestId=${requestId}\n`);

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${BASE_URL}/api/app/food/analyze/${requestId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await json(res);

    if (!res.ok) {
      console.error(`[${ts()}] poll error ${res.status}: ${JSON.stringify(body)}`);
      break;
    }

    const data = body.data ?? body;
    const stage: string = data.stage ?? 'analyzing';
    const status: string = data.status ?? 'processing';

    if (!seen.has(stage)) {
      seen.add(stage);
      const label = `[stage=${stage}]`.padEnd(30);
      console.log(`${ts()} ${label} status=${status}  ${elapsed(start)}`);

      if (stage === 'vision_done' && data.visionDoneFoods) {
        const names = (data.visionDoneFoods as any[]).map((f) => f.name).join(', ');
        console.log(`   ↳ visionDoneFoods (${data.visionDoneFoods.length}): ${names}`);
      }
      if (stage === 'foods_identified' && data.identifiedFoods) {
        const names = (data.identifiedFoods as any[]).map((f) => f.name).join(', ');
        console.log(`   ↳ identifiedFoods (${data.identifiedFoods.length}): ${names}`);
      }
      if (stage === 'nutrition_filled' && data.foods) {
        const names = (data.foods as any[]).map((f) => f.name).join(', ');
        console.log(`   ↳ nutritionFilledFoods (${data.foods.length}): ${names}`);
      }
      if (stage === 'needs_review') {
        console.log(`   ↳ confidence=${data.confidence?.overall}, reasons=${JSON.stringify(data.confidence?.reasons)}`);
      }
      if (stage === 'final') {
        const result = data.result;
        console.log(`   ↳ foods: ${(result?.foods ?? []).map((f: any) => f.name).join(', ')}`);
        console.log(`   ↳ totalCalories=${result?.totals?.calories}, decision=${result?.decision?.recommendation}`);
        break;
      }
    }

    if (status === 'failed') {
      console.error(`[${ts()}] 分析失败: ${data.error}`);
      break;
    }
  }

  const total = Date.now() - start;
  console.log(`\n[${ts()}] 轮询结束，总耗时 ${total}ms\n`);
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  // Pick image: CLI arg or first .jpeg in images/
  let imagePath = process.argv[2];
  if (!imagePath) {
    const imagesDir = path.resolve(__dirname, '../images');
    const files = fs.readdirSync(imagesDir).filter((f) => f.endsWith('.jpeg'));
    if (!files.length) throw new Error('No .jpeg files found in images/');
    imagePath = path.join(imagesDir, files[0]);
  }
  console.log(`图片路径: ${imagePath}`);

  console.log(`\n[${ts()}] 登录 phone=${PHONE} ...`);
  const token = await login();
  console.log(`[${ts()}] 登录成功，token=${token.slice(0, 20)}...`);

  console.log(`\n[${ts()}] 上传图片提交分析 ...`);
  const requestId = await uploadImage(token, imagePath);
  console.log(`[${ts()}] 提交成功，requestId=${requestId}`);

  await poll(token, requestId);
}

main().catch((err) => {
  console.error('\n[FATAL]', err.message ?? err);
  process.exit(1);
});
