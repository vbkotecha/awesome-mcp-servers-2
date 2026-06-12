#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONCURRENCY = 10;
const TIMEOUT_MS = 15_000;
const USER_AGENT = "awesome-mcp-servers-link-checker/1.0";

/** @type {Map<string, Set<string>>} */
const links = new Map();

function isLocalhostUrl(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1";
  } catch {
    return false;
  }
}

function addLink(url, source) {
  const normalized = url.trim().replace(/[`)>.,]+$/, "");
  if (!normalized.startsWith("http://") && !normalized.startsWith("https://")) {
    return;
  }
  if (isLocalhostUrl(normalized)) {
    return;
  }
  if (!links.has(normalized)) {
    links.set(normalized, new Set());
  }
  links.get(normalized).add(source);
}

function collectFromServersJson() {
  const servers = JSON.parse(
    readFileSync(join(root, "data/servers.json"), "utf8")
  );
  for (const server of servers) {
    addLink(server.url, `servers.json (${server.name})`);
  }
}

function collectFromMarkdown(filePath) {
  const relPath = relative(root, filePath);
  const content = readFileSync(filePath, "utf8");

  for (const match of content.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    addLink(match[2], relPath);
  }

  for (const match of content.matchAll(/<((?:https?):\/\/[^>]+)>/g)) {
    addLink(match[1], relPath);
  }

  for (const match of content.matchAll(
    /(?<![(\[])(https?:\/\/[^\s<>"')\]`]+)/g
  )) {
    addLink(match[1], relPath);
  }
}

function collectMarkdownFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".git") {
        continue;
      }
      files.push(...collectMarkdownFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

async function checkLink(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
    });

    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
    }

    if (response.status >= 400) {
      return { ok: false, reason: `${response.status} ${response.statusText}` };
    }

    return { ok: true };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "request failed";
    return { ok: false, reason: message };
  } finally {
    clearTimeout(timeout);
  }
}

async function mapWithConcurrency(items, limit, fn) {
  /** @type {Promise<void>[]} */
  const executing = new Set();
  /** @type {Awaited<ReturnType<typeof fn>>[]} */
  const results = [];

  for (const item of items) {
    const promise = Promise.resolve(fn(item)).then((result) => {
      executing.delete(promise);
      return result;
    });
    executing.add(promise);
    results.push(promise);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

collectFromServersJson();
for (const filePath of collectMarkdownFiles(root)) {
  collectFromMarkdown(filePath);
}

const uniqueLinks = [...links.keys()].sort();
console.error(`Checking ${uniqueLinks.length} unique links...\n`);

const results = await mapWithConcurrency(uniqueLinks, CONCURRENCY, async (url) => {
  const result = await checkLink(url);
  return { url, ...result };
});

const broken = results.filter((result) => !result.ok);

if (broken.length === 0) {
  console.log(`All ${uniqueLinks.length} links are reachable.`);
  process.exit(0);
}

console.log(`Broken links (${broken.length}):\n`);
for (const { url, reason } of broken) {
  const sources = [...links.get(url)].sort().join("; ");
  console.log(url);
  console.log(`  reason: ${reason}`);
  console.log(`  source: ${sources}\n`);
}

process.exit(1);
