#!/usr/bin/env node
/**
 * Clean-clone Markdown link checker for tracked files.
 *
 * - Resolves relative links against the Git index (and non-ignored working-tree
 *   files so local checks pass before the first commit of a new path)
 * - Validates same-file and cross-file heading anchors (GitHub-style slugs)
 * - Skips external URLs (http/https/mailto/etc.) so CI is not rate-limited
 * - Fails when public docs (outside specs/) link into untracked specs/ paths
 * - Skips archival specs/ops trees (known historical drift)
 * - Soft-skips missing specs/ targets from other specs/ files (local-only plans)
 *
 * Usage (repo root): node scripts/check-markdown-links.mjs
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

/** @returns {Set<string>} posix paths relative to repo root */
function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  return new Set(out.split("\0").filter(Boolean).map(toPosix));
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function isExternalHref(href) {
  return /^[a-z][a-z0-9+.-]*:/i.test(href);
}

function isIgnored(relPosix) {
  try {
    execFileSync("git", ["check-ignore", "-q", "--", relPosix], {
      cwd: ROOT,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** @param {string} relPosix @param {Set<string>} tracked */
function pathExistsInClone(relPosix, tracked) {
  if (tracked.has(relPosix)) return true;
  const abs = path.join(ROOT, relPosix);
  if (!existsSync(abs)) return false;
  if (isIgnored(relPosix)) return false;
  return true;
}

/** @param {string} relPosix @param {Set<string>} tracked */
function isTrackedDir(relPosix, tracked) {
  const prefix = relPosix.replace(/\/?$/, "/");
  return [...tracked].some((t) => t.startsWith(prefix));
}

/** GitHub-flavored heading slug (approximate). */
function githubSlug(headingText) {
  return headingText
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/**
 * @param {string} content
 * @returns {Set<string>}
 */
function headingAnchors(content) {
  const counts = new Map();
  const anchors = new Set();
  for (const line of content.split(/\r?\n/)) {
    const atx = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!atx) continue;
    let text = atx[2]
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/`([^`]+)`/g, "$1");
    let slug = githubSlug(text);
    const n = counts.get(slug) ?? 0;
    counts.set(slug, n + 1);
    if (n > 0) slug = `${slug}-${n}`;
    anchors.add(slug);
  }
  return anchors;
}

/** Strip fenced blocks and inline code so examples are not treated as links. */
function stripCode(content) {
  let out = content.replace(/^(`{3,}|~{3,})[\s\S]*?\n\1[ \t]*$/gm, "");
  out = out.replace(/`[^`\n]+`/g, "``");
  return out;
}

/**
 * @param {string} content
 * @returns {{ href: string, line: number }[]}
 */
function extractLinks(content) {
  const links = [];
  const lines = stripCode(content).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const re = /!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      links.push({ href: m[2], line: i + 1 });
    }
  }
  return links;
}

/**
 * @param {string} fromFile
 * @param {string} href
 */
function resolveRelative(fromFile, href) {
  const hashIndex = href.indexOf("#");
  const rawPath = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? null : href.slice(hashIndex + 1);
  if (!rawPath) {
    return { targetFile: fromFile, fragment, outsideRepo: false };
  }
  const decoded = decodeURIComponent(rawPath);
  const fromDir = path.posix.dirname(fromFile);
  const target = path.posix.normalize(path.posix.join(fromDir, decoded));
  if (target.startsWith("../") || target === "..") {
    return { targetFile: target, fragment, outsideRepo: true };
  }
  return { targetFile: target, fragment, outsideRepo: false };
}

function isPublicDoc(file) {
  return !file.startsWith("specs/");
}

function shouldScan(file) {
  // Archival OpenCode phase plans: tracked but full of historical local links.
  if (file.startsWith("specs/ops/")) return false;
  return true;
}

function main() {
  const tracked = trackedFiles();
  const mdFiles = [...tracked].filter((f) => f.endsWith(".md") && shouldScan(f)).sort();
  /** @type {string[]} */
  const errors = [];
  /** @type {Map<string, Set<string>>} */
  const anchorCache = new Map();

  function anchorsFor(file) {
    if (!anchorCache.has(file)) {
      const content = readFileSync(path.join(ROOT, file), "utf8");
      anchorCache.set(file, headingAnchors(content));
    }
    return /** @type {Set<string>} */ (anchorCache.get(file));
  }

  for (const file of mdFiles) {
    const content = readFileSync(path.join(ROOT, file), "utf8");
    for (const { href, line } of extractLinks(content)) {
      if (isExternalHref(href)) continue;

      const { targetFile, fragment, outsideRepo } = resolveRelative(file, href);
      if (outsideRepo) {
        errors.push(`${file}:${line}: link escapes repository: ${href}`);
        continue;
      }

      let resolvedFile = null;
      if (pathExistsInClone(targetFile, tracked)) {
        const abs = path.join(ROOT, targetFile);
        try {
          if (statSync(abs).isDirectory()) {
            if (pathExistsInClone(`${targetFile.replace(/\/?$/, "")}/README.md`, tracked)) {
              resolvedFile = `${targetFile.replace(/\/?$/, "")}/README.md`;
            } else if (isTrackedDir(targetFile, tracked) || !isIgnored(targetFile)) {
              resolvedFile = null; // directory OK
            }
          } else {
            resolvedFile = targetFile;
          }
        } catch {
          resolvedFile = targetFile;
        }
      } else if (pathExistsInClone(`${targetFile}/README.md`, tracked)) {
        resolvedFile = `${targetFile}/README.md`;
      } else if (isTrackedDir(targetFile, tracked)) {
        resolvedFile = null;
      } else {
        const intoSpecs = targetFile.startsWith("specs/");
        // Specs may reference local-only sibling plans; do not fail CI on those.
        if (!isPublicDoc(file) && intoSpecs) {
          continue;
        }
        if (isPublicDoc(file) && intoSpecs) {
          errors.push(
            `${file}:${line}: public doc links to untracked specs path: ${href}`,
          );
        } else {
          errors.push(`${file}:${line}: broken relative link: ${href}`);
        }
        continue;
      }

      if (fragment && resolvedFile && tracked.has(resolvedFile)) {
        const anchors = anchorsFor(resolvedFile);
        if (!anchors.has(fragment)) {
          errors.push(
            `${file}:${line}: missing anchor #${fragment} in ${resolvedFile} (from ${href})`,
          );
        }
      }
    }
  }

  if (errors.length > 0) {
    console.error(`Markdown link check failed (${errors.length} issue(s)):\n`);
    for (const e of errors) console.error(`  ${e}`);
    process.exit(1);
  }

  console.log(
    `Markdown link check OK (${mdFiles.length} scanned Markdown files; specs/ops skipped).`,
  );
}

main();
