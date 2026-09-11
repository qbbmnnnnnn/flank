#!/usr/bin/env node
// 一次性同步三处版本号，避免发版时漏改。
// 用法: npm run bump-version -- 0.2.0
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("用法: npm run bump-version -- 0.2.0");
  process.exit(1);
}

function replaceOnce(relativePath, pattern, replacement) {
  const file = resolve(root, relativePath);
  const text = readFileSync(file, "utf8");
  const next = text.replace(pattern, replacement);
  if (next === text) throw new Error(`未在 ${relativePath} 中找到 version 字段`);
  writeFileSync(file, next);
  console.log(`${relativePath} -> ${version}`);
}

// package.json 与 tauri.conf.json 都是 JSON，取第一个顶层 "version"。
replaceOnce("package.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
replaceOnce("src-tauri/tauri.conf.json", /("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
// Cargo.toml 只改 [package] 下那一行（依赖项的 version 不在行首，不会命中）。
replaceOnce("src-tauri/Cargo.toml", /^version\s*=\s*"[^"]*"/m, `version = "${version}"`);

// package-lock.json 有两处根版本：顶层的 "version" 和 packages[""] 里的 "version"。
// 不同步的话，CI 里第一步 npm ci 就会因为锁文件与 package.json 不一致而失败。
// 注意：不能简单匹配缩进，因为 packages 下每个依赖项在同样缩进处也有 "version"。
replaceOnce("package-lock.json", /^(\s{2}"version"\s*:\s*)"[^"]*"/m, `$1"${version}"`);
replaceOnce(
  "package-lock.json",
  /("packages"\s*:\s*\{\s*""\s*:\s*\{\s*"name"\s*:\s*"[^"]*",\s*"version"\s*:\s*)"[^"]*"/,
  `$1"${version}"`,
);

console.log("四处版本号已同步（src-tauri/Cargo.lock 会在下次构建时自动更新）。");
