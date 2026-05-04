import { getStore } from "@netlify/blobs";

const STORE_NAME = "sisi-slowscores";
const ENTRY_PREFIX = "entries/";
const MAX_NAME_LENGTH = 14;
const MAX_SCORE_SECONDS = 60 * 60 * 6;
const DEFAULT_SCORES = [{ name: "Easy Stef", score: 336.4, createdAt: "2026-05-04T00:00:00.000Z" }];

const headers = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers });
}

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_NAME_LENGTH) || "Easy speler";
}

function cleanScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score) || score <= 0) return null;
  return Math.min(score, MAX_SCORE_SECONDS);
}

function cleanScores(scores) {
  const bestByName = new Map();
  scores
    .filter((entry) => entry && typeof entry.name === "string" && Number.isFinite(entry.score))
    .forEach((entry) => {
      const score = cleanScore(entry.score);
      if (score === null) return;

      const cleaned = {
        name: cleanName(entry.name),
        score,
        createdAt: entry.createdAt || new Date().toISOString(),
      };
      const existing = bestByName.get(cleaned.name);
      if (!existing || cleaned.score > existing.score) bestByName.set(cleaned.name, cleaned);
    });

  return Array.from(bestByName.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);
}

async function readScores() {
  const store = getStore(STORE_NAME);
  const blobs = [];
  let cursor;

  do {
    const page = await store.list({ prefix: ENTRY_PREFIX, cursor });
    blobs.push(...page.blobs);
    cursor = page.cursor;
  } while (cursor);

  const entries = await Promise.all(
    blobs.map(async (blob) => {
      try {
        return await store.get(blob.key, { type: "json" });
      } catch {
        return null;
      }
    }),
  );

  return cleanScores([...DEFAULT_SCORES, ...entries]);
}

async function saveScore(payload) {
  const score = cleanScore(payload?.score);
  if (score === null) return null;

  const entry = {
    name: cleanName(payload?.name),
    score,
    createdAt: new Date().toISOString(),
  };
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const store = getStore(STORE_NAME);
  await store.setJSON(`${ENTRY_PREFIX}${Date.now()}-${id}.json`, entry);
  return entry;
}

export default async (request) => {
  if (request.method === "OPTIONS") return new Response("", { status: 204, headers });

  if (request.method === "GET") {
    return json({ scores: await readScores() });
  }

  if (request.method === "POST") {
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: "Invalid JSON" }, 400);
    }

    const entry = await saveScore(payload);
    if (!entry) return json({ error: "Invalid score" }, 400);
    return json({ entry, scores: await readScores() }, 201);
  }

  return json({ error: "Method not allowed" }, 405);
};
