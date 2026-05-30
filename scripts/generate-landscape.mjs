#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const categories = JSON.parse(
  readFileSync(join(root, "data/categories.json"), "utf8")
);
const servers = JSON.parse(
  readFileSync(join(root, "data/servers.json"), "utf8")
);

const categoryMap = new Map(
  categories.map((category) => [category.id, category])
);

function yamlString(value) {
  const text = String(value);
  if (
    /^[\w.-]+$/.test(text) &&
    !["true", "false", "null", "yes", "no", "on", "off"].includes(
      text.toLowerCase()
    )
  ) {
    return text;
  }
  return `"${text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")}"`;
}

function indent(level) {
  return "  ".repeat(level);
}

function extractRepoUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "github.com") {
      return undefined;
    }
    const [owner, repo] = parsed.pathname.split("/").filter(Boolean);
    if (!owner || !repo) {
      return undefined;
    }
    return `https://github.com/${owner}/${repo}`;
  } catch {
    return undefined;
  }
}

function loadLogoMap() {
  const logoMapPath = join(root, "landscape/logo-map.json");
  if (!existsSync(logoMapPath)) {
    console.error(
      "Missing landscape/logo-map.json. Run: npm run fetch-logos"
    );
    process.exit(1);
  }
  return JSON.parse(readFileSync(logoMapPath, "utf8"));
}

const logoMap = loadLogoMap();

function buildItem(server) {
  const logo = logoMap[server.name] ?? "placeholder.svg";
  const lines = [
    `${indent(5)}- name: ${yamlString(server.name)}`,
    `${indent(6)}homepage_url: ${yamlString(server.url)}`,
    `${indent(6)}logo: ${logo}`,
    `${indent(6)}description: ${yamlString(server.description)}`,
  ];

  const repoUrl = extractRepoUrl(server.url);
  if (repoUrl) {
    lines.push(`${indent(6)}repo_url: ${yamlString(repoUrl)}`);
  }

  const searchTags = [
    ...server.tags,
    server.language,
    server.provider,
    server.official ? "official" : "community",
  ]
    .filter(Boolean)
    .join(", ");

  lines.push(`${indent(6)}extra:`);
  lines.push(`${indent(7)}summary_tags: ${yamlString(searchTags)}`);
  lines.push(`${indent(7)}annotations:`);
  lines.push(`${indent(8)}language: ${yamlString(server.language)}`);
  lines.push(`${indent(8)}provider: ${yamlString(server.provider)}`);
  lines.push(
    `${indent(8)}official: ${yamlString(server.official ? "true" : "false")}`
  );

  return lines.join("\n");
}

const grouped = new Map(categories.map((category) => [category.id, []]));
for (const server of servers) {
  grouped.get(server.category)?.push(server);
}

const landscapeCategories = [];

for (const category of categories) {
  const entries = grouped.get(category.id) ?? [];
  if (entries.length === 0) {
    continue;
  }

  entries.sort((left, right) => left.name.localeCompare(right.name));

  const official = entries.filter((entry) => entry.official);
  const community = entries.filter((entry) => !entry.official);

  const subcategories = [];
  if (official.length > 0) {
    subcategories.push({
      name: "Official",
      items: official,
    });
  }
  if (community.length > 0) {
    subcategories.push({
      name: "Community",
      items: community,
    });
  }

  landscapeCategories.push({
    name: category.name,
    subcategories,
  });
}

const lines = ["categories:"];

for (const category of landscapeCategories) {
  lines.push(`${indent(1)}- name: ${yamlString(category.name)}`);
  lines.push(`${indent(2)}subcategories:`);

  for (const subcategory of category.subcategories) {
    lines.push(`${indent(3)}- name: ${yamlString(subcategory.name)}`);
    lines.push(`${indent(4)}items:`);
    for (const server of subcategory.items) {
      lines.push(buildItem(server));
    }
  }
}

const outputPath = join(root, "landscape/data.yml");
writeFileSync(outputPath, `${lines.join("\n")}\n`);

const itemCount = servers.length;
console.log(
  `Generated landscape/data.yml with ${itemCount} servers across ${landscapeCategories.length} categories.`
);
