import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const siteRoot = path.resolve(scriptDir, "..");
const documentsRoot = path.resolve(siteRoot, "..");
const appRoot = process.env.CRITTER_APP_DIR || path.join(documentsRoot, "critterapp");
const assetsRoot = process.env.CRITTER_ASSETS_DIR || path.join(documentsRoot, "critter-assets");

const appAttributionsPath = path.join(appRoot, "ATTRIBUTIONS.md");
const textureManifestPath = path.join(appRoot, "public", "textures", "manifest.json");
const catalogAttributionsPath = path.join(assetsRoot, "Attributions.txt");
const outputDir = path.join(siteRoot, "legal", "third-party-notices");
const outputPath = path.join(outputDir, "index.html");

const generatedDate = process.env.NOTICES_GENERATED_DATE || formatDate(new Date());

const LICENSE_LINKS = [
  { test: /Apache(?: License)? 2\.0|Apache-2\.0/i, label: "Apache License 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  { test: /Clear BSD|BSD[- ]3[- ]Clause[- ]Clear/i, label: "The Clear BSD License", url: "https://spdx.org/licenses/BSD-3-Clause-Clear.html" },
  { test: /BSD[- ]3[- ]Clause(?![- ]?Clear)/i, label: "BSD 3-Clause", url: "https://opensource.org/license/bsd-3-clause" },
  { test: /BSD[- ]2[- ]Clause/i, label: "BSD 2-Clause", url: "https://opensource.org/license/bsd-2-clause" },
  { test: /\bMIT\b/i, label: "MIT License", url: "https://opensource.org/license/mit" },
  { test: /\bISC\b/i, label: "ISC License", url: "https://opensource.org/license/isc-license-txt" },
  { test: /CC0(?:-1\.0)?/i, label: "CC0 1.0", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { test: /CC[- ]BY[- ]4\.0/i, label: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  { test: /Unlicense/i, label: "Unlicense", url: "https://unlicense.org/" },
  { test: /\b0BSD\b/i, label: "0BSD", url: "https://opensource.org/license/0bsd" },
];

const SECTION_SOURCES = {
  app: "Critter app attribution file",
  catalog: "Critter asset catalog attribution file",
  textures: "Critter texture manifest",
  dependencies: "Production dependency license scan",
};

const ITEM_NAME_OVERRIDES = new Map([
  ["Iit Softfoot", "IIT SoftFoot"],
  ["I2rt Yam", "I2RT YAM"],
  ["Trs So Arm100", "TRS SO-ARM100"],
  ["Robotis Op3", "ROBOTIS OP3"],
  ["Arx L5", "ARX L5"],
]);

const AUTHOR_OVERRIDES = new Map([
  ["Franka Emika Panda", ["Google DeepMind / MuJoCo Menagerie"]],
  ["TetherIA Aero Hand Open", ["Copyright 2025 TetherIA Inc."]],
  ["MolmoSpaces THOR Object Subset", ["Allen Institute for AI"]],
  ["Scene HDRIs", ["Studio Small 08 by Sergej Majboroda", "Ferndale Studio 03 by Dimitrios Savva and Greg Zaal"]],
]);

const SOURCE_OWNER_FALLBACKS = [
  { test: /github\.com\/google-deepmind\/mujoco_menagerie/i, label: "Google DeepMind / MuJoCo Menagerie" },
  { test: /github\.com\/unitreerobotics\/unitree_mujoco/i, label: "Unitree Robotics" },
  { test: /github\.com\/Farama-Foundation\/Gymnasium-Robotics/i, label: "Farama Foundation / Gymnasium Robotics" },
  { test: /huggingface\.co\/datasets\/allenai\/molmospaces/i, label: "Allen Institute for AI" },
];

const appNotices = parseAttributionFile(readRequired(appAttributionsPath), {
  root: appRoot,
  source: SECTION_SOURCES.app,
});

const catalogNotices = parseAttributionFile(readRequired(catalogAttributionsPath), {
  root: assetsRoot,
  source: SECTION_SOURCES.catalog,
}).filter((notice) => !isProjectAuthoredOnly(notice));

const textureNotices = parseTextureManifest(readRequired(textureManifestPath));
const dependencyNotices = parsePnpmLicenseScan(runProductionLicenseScan());

const html = renderPage({
  appNotices,
  catalogNotices,
  textureNotices,
  dependencyNotices,
});

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, html, "utf8");
console.log(`Wrote ${path.relative(siteRoot, outputPath)}`);
console.log(`Notices: ${appNotices.length} app, ${catalogNotices.length} catalog, ${textureNotices.length} textures, ${dependencyNotices.length} runtime packages`);

function readRequired(filePath) {
  if (!existsSync(filePath)) throw new Error(`Required source file not found: ${filePath}`);
  return readFileSync(filePath, "utf8");
}

function runProductionLicenseScan() {
  const stdout = execFileSync("pnpm", ["--dir", appRoot, "licenses", "list", "--prod", "--json"], {
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

function parseAttributionFile(markdown, options) {
  const normalized = markdown.replace(/\r\n/g, "\n");
  const chunks = normalized.split(/\n---+\n/g);

  return chunks
    .map((chunk) => parseAttributionSection(chunk, options))
    .filter(Boolean)
    .map((notice) => enrichAssetNotice(notice, options))
    .filter(Boolean);
}

function parseAttributionSection(section, options) {
  const headingMatch = section.match(/^##\s+(.+)$/m);
  if (!headingMatch) return null;

  const itemName = stripMarkdown(headingMatch[1]);
  const body = section.slice(headingMatch.index + headingMatch[0].length).trim();
  const fields = parseFields(body);
  const rawLicense = firstField(fields, "license") || "See source record";
  const inferred = inferAssetLicense(rawLicense, fields, options);
  const rawUrls = findUrls(body);

  return {
    itemName,
    source: options.source,
    sourceUrls: collectSourceUrls(fields, rawUrls),
    locations: fields.location || [],
    copyright: collectCopyrightNotices(body, rawLicense),
    licenseName: inferred.licenseName,
    licenseTextLinks: licenseTextLinks(inferred.licenseName, rawUrls),
    attributionRequired: attributionRequirement(inferred.licenseName),
    notes: collectNotes(fields, body, rawLicense, inferred),
  };
}

function enrichAssetNotice(notice, options) {
  const enriched = {
    ...notice,
    itemName: normalizeItemName(notice),
    sourceUrls: normalizeNoticeSourceUrls(notice),
    copyright: [...notice.copyright],
    licenseTextLinks: [...notice.licenseTextLinks],
    notes: [...notice.notes],
  };

  applyAuthorOverrides(enriched);

  const licenseFile = findNearbyLicenseFile(enriched.locations, options.root);
  if (licenseFile) {
    for (const copyright of extractCopyrightNotices(licenseFile.text)) addUniqueString(enriched.copyright, copyright);
    const licenseFileUrl = upstreamLicenseUrl(enriched.sourceUrls[0]?.url);
    if (licenseFileUrl) addUnique(enriched.licenseTextLinks, { label: "Upstream LICENSE", url: licenseFileUrl });
  }

  if (enriched.itemName === "MolmoSpaces THOR Object Subset") {
    addUnique(enriched.sourceUrls, { label: "https://huggingface.co/datasets/allenai/molmospaces", url: "https://huggingface.co/datasets/allenai/molmospaces" });
    addUnique(enriched.licenseTextLinks, { label: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/" });
  }

  if (!enriched.copyright.length) {
    const fallback = sourceOwnerFallback(enriched.sourceUrls);
    if (fallback) addUniqueString(enriched.copyright, fallback);
  }

  if (!enriched.licenseTextLinks.length) {
    const standardLinks = licenseTextLinks(enriched.licenseName, enriched.sourceUrls.map((source) => source.url));
    for (const link of standardLinks) addUnique(enriched.licenseTextLinks, link);
  }

  enriched.notes = cleanNoticeNotes(enriched.notes);
  return enriched;
}

function normalizeItemName(notice) {
  if (notice.itemName === "Unitree H1") {
    if (notice.locations.some((location) => /robots\/h1\/?$/i.test(location))) return "Unitree H1 (unitree_mujoco)";
    if (notice.locations.some((location) => /robots\/unitree_h1\/?$/i.test(location))) return "Unitree H1 (MuJoCo Menagerie)";
  }
  return ITEM_NAME_OVERRIDES.get(notice.itemName) || notice.itemName;
}

function normalizeNoticeSourceUrls(notice) {
  const sourceUrls = notice.sourceUrls.map((source) => ({ ...source, label: source.url }));
  if (notice.itemName === "MolmoSpaces THOR Object Subset") {
    addUnique(sourceUrls, { label: "https://huggingface.co/datasets/allenai/molmospaces", url: "https://huggingface.co/datasets/allenai/molmospaces" });
  }
  return sourceUrls;
}

function applyAuthorOverrides(notice) {
  for (const value of AUTHOR_OVERRIDES.get(notice.itemName) || []) addUniqueString(notice.copyright, value);

  if (notice.itemName === "Scene HDRIs") {
    for (const source of notice.sourceUrls) {
      if (/studio_small_08/i.test(source.url)) addUniqueString(notice.copyright, "Studio Small 08 by Sergej Majboroda");
      if (/ferndale_studio_03/i.test(source.url)) addUniqueString(notice.copyright, "Ferndale Studio 03 by Dimitrios Savva and Greg Zaal");
    }
  }
}

function findNearbyLicenseFile(locations, root) {
  const candidates = [];

  for (const location of locations) {
    const firstLocation = location
      .split("\n")[0]
      .replace(/`/g, "")
      .replace(/^[-\s]+/, "")
      .replace(/\s+in\s+CritterEngine\/critter-assets$/i, "")
      .trim()
      .replace(/[\\/]$/, "");

    if (!firstLocation || /public\//i.test(firstLocation)) continue;
    const basename = path.basename(firstLocation);

    for (const relativePath of [
      path.join(firstLocation, "LICENSE"),
      path.join(firstLocation, "LICENSE.txt"),
      path.join(firstLocation, "LICENSE.md"),
      path.join("robots", basename, "LICENSE"),
      path.join("attachments", basename, "LICENSE"),
      path.join("objects", basename, "LICENSE"),
    ]) {
      candidates.push(relativePath);
    }

    if (/^robots\/(a2|b2|b2w|go2w|h1|h1_2)\/?$/i.test(firstLocation)) {
      candidates.push(path.join("robots", "unitree_LICENSE"));
    }
  }

  for (const relativePath of candidates) {
    const absolutePath = path.join(root, relativePath);
    if (existsSync(absolutePath)) return { relativePath, text: readFileSync(absolutePath, "utf8") };
  }

  return null;
}

function extractCopyrightNotices(text) {
  const notices = [];
  const normalized = text.replace(/\r\n/g, "\n");
  const copyrightLine = /^Copyright(?: \(c\))?\s+(?:\[[0-9]{4}\]\s+\[[^\]]+\]|<[^>]+>|[0-9]{4}(?:[-\u2013][0-9]{2,4})?)(?:\b|\s|$)/i;

  for (const line of normalized.split("\n")) {
    const trimmed = line.trim();
    if (copyrightLine.test(trimmed) && !/\[yyyy\]/i.test(trimmed)) addUniqueString(notices, trimmed);
    if (/^All rights reserved\.?$/i.test(trimmed)) addUniqueString(notices, trimmed);
  }

  return notices;
}

function upstreamLicenseUrl(sourceUrl) {
  if (!sourceUrl || !/github\.com/i.test(sourceUrl)) return "";
  const repoMatch = sourceUrl.match(/^(https:\/\/github\.com\/[^/]+\/[^/]+)(?:\/tree\/([^/]+)\/(.*)|\/tree\/([^/]+)|\/blob\/([^/]+)\/.*)?$/i);
  if (!repoMatch) return "";

  const repo = repoMatch[1];
  const branch = repoMatch[2] || repoMatch[4] || repoMatch[5] || "main";
  const repoPath = (repoMatch[3] || "").replace(/\/$/, "");

  if (/unitree_mujoco/i.test(repo)) return `${repo}/blob/${branch}/LICENSE`;
  if (repoPath) return `${repo}/blob/${branch}/${repoPath}/LICENSE`;
  // The local attribution-file layout does not mirror upstream repos, so never
  // build upstream URLs from local relative paths; fall back to the repo root.
  return `${repo}/blob/${branch}/LICENSE`;
}

function sourceOwnerFallback(sourceUrls) {
  for (const source of sourceUrls) {
    const match = SOURCE_OWNER_FALLBACKS.find((candidate) => candidate.test.test(source.url));
    if (match) return match.label;
  }
  return "";
}

function cleanNoticeNotes(notes) {
  return notes
    .filter((note) => !/testing-only|slated for deletion/i.test(note))
    .map((note) => note.replace(/licensed under the Apache License 2\.0\. A copy is available at$/i, "licensed under the Apache License 2.0. A copy is available at https://www.apache.org/licenses/LICENSE-2.0"));
}

function parseFields(body) {
  const fields = {};
  let current = null;

  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (!current || fields[current]?.length) current = null;
      continue;
    }

    const match = trimmed.match(/^(?:\*\*)?([A-Za-z ]+):(\*\*)?\s*(.*)$/);
    if (match) {
      const key = normalizeFieldName(match[1]);
      if (key) {
        current = key;
        if (!fields[key]) fields[key] = [];
        if (match[3]) fields[key].push(stripMarkdown(match[3]));
        continue;
      }
    }

    if (current && (trimmed.startsWith("- ") || trimmed.startsWith(">") || current === "note" || current === "source" || current === "location")) {
      fields[current].push(stripMarkdown(trimmed.replace(/^[- >]+/, "")));
    }
  }

  return fields;
}

function normalizeFieldName(name) {
  const normalized = name.toLowerCase().trim();
  if (normalized === "location" || normalized === "locations") return "location";
  if (normalized === "license") return "license";
  if (normalized === "source" || normalized === "sources" || normalized === "mesh source") return "source";
  if (normalized === "note") return "note";
  return null;
}

function firstField(fields, key) {
  return fields[key]?.find(Boolean);
}

function collectSourceUrls(fields, rawUrls) {
  const sourceUrls = [];
  const sourceLines = fields.source || [];

  for (const line of sourceLines) {
    const urls = findUrls(line);
    if (urls.length) {
      for (const url of urls) addUnique(sourceUrls, { label: line.replace(url, "").replace(/\s+-\s*$/, "").trim() || url, url });
    } else if (/^https?:\/\//i.test(line)) {
      addUnique(sourceUrls, { label: line, url: line });
    }
  }

  if (!sourceUrls.length && rawUrls.length) {
    addUnique(sourceUrls, { label: rawUrls[0], url: rawUrls[0] });
  }

  return sourceUrls;
}

function collectCopyrightNotices(body, rawLicense) {
  const notices = [];
  for (const line of body.split("\n")) {
    const trimmed = stripMarkdown(line.trim());
    if (/^copyright\b/i.test(trimmed) || /\bis copyright\b/i.test(trimmed) || /^all rights reserved\.?$/i.test(trimmed)) addUniqueString(notices, trimmed);
  }
  if (/copyright/i.test(rawLicense)) addUniqueString(notices, rawLicense);
  return notices;
}

function inferAssetLicense(rawLicense, fields, options) {
  const location = firstField(fields, "location");
  const licenseFileText = location ? readNearbyLicenseFile(location, options.root) : "";
  const inferredFromFile = inferLicenseNameFromText(licenseFileText);

  if (/copyright/i.test(rawLicense) && inferredFromFile) {
    return { licenseName: inferredFromFile, inferredFromFile: true };
  }

  if (/^BSD$/i.test(rawLicense) && inferredFromFile) {
    return { licenseName: inferredFromFile, inferredFromFile: true };
  }

  return { licenseName: normalizeLicenseName(rawLicense), inferredFromFile: false };
}

function readNearbyLicenseFile(location, root) {
  const firstLocation = location
    .split("\n")[0]
    .replace(/`/g, "")
    .replace(/^[-\s]+/, "")
    .trim()
    .replace(/[\\/]$/, "");

  if (!firstLocation || /public\/|scene\//i.test(firstLocation)) return "";

  const basename = path.basename(firstLocation);
  const candidates = [
    path.join(root, firstLocation, "LICENSE"),
    path.join(root, firstLocation, "LICENSE.txt"),
    path.join(root, firstLocation, "LICENSE.md"),
    path.join(root, "robots", basename, "LICENSE"),
    path.join(root, "attachments", basename, "LICENSE"),
    path.join(root, "objects", basename, "LICENSE"),
  ];

  if (/^robots\/(a2|b2|b2w|go2w|h1|h1_2)\/?$/i.test(firstLocation)) {
    candidates.push(path.join(root, "robots", "unitree_LICENSE"));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }

  return "";
}

function inferLicenseNameFromText(text) {
  if (!text) return "";
  if (/The Clear BSD License/i.test(text)) return "The Clear BSD License (BSD-3-Clause-Clear)";
  if (/Apache License[\s\S]{0,80}Version 2\.0/i.test(text)) return "Apache License 2.0";
  if (/BSD 3-Clause License/i.test(text)) return "BSD 3-Clause";
  if (/BSD 2-Clause License/i.test(text)) return "BSD 2-Clause";
  if (/MIT License|permission is hereby granted, free of charge/i.test(text)) return "MIT";
  if (/Redistribution and use in source and binary forms[\s\S]+Neither the name/i.test(text)) return "BSD 3-Clause";
  if (/Redistribution and use in source and binary forms[\s\S]+binary form/i.test(text)) return "BSD 2-Clause";
  return "";
}

function normalizeLicenseName(rawLicense) {
  return rawLicense
    .replace(/Apache License 2\.0/i, "Apache License 2.0")
    .replace(/CC BY 4\.0/i, "CC BY 4.0")
    .replace(/CC0-1\.0/i, "CC0-1.0")
    .trim();
}

function collectNotes(fields, body, rawLicense, inferred) {
  const notes = [];
  for (const note of fields.note || []) addUniqueString(notes, note);

  for (const line of body.split("\n")) {
    const trimmed = stripMarkdown(line.trim().replace(/^>\s?/, ""));
    // Skip field lines (e.g. "Note:", "License:") that parseFields already captured.
    if (/^[A-Za-z ]+:/.test(trimmed)) continue;
    if (/verify|copy of the .*license|included at|available at|repository license/i.test(trimmed)) {
      addUniqueString(notes, trimmed);
    }
  }

  if (inferred.inferredFromFile && rawLicense !== inferred.licenseName) {
    addUniqueString(notes, `License name inferred from the nearby upstream LICENSE file; source record states: ${rawLicense}`);
  }

  return notes;
}

function parseTextureManifest(json) {
  const manifest = JSON.parse(json);
  return (manifest.textures || []).map((texture) => {
    const licenseName = normalizeLicenseName(texture.license || "See source record");
    return {
      itemName: texture.name,
      source: SECTION_SOURCES.textures,
      sourceUrls: [],
      locations: [`public/textures/${texture.file}`],
      copyright: [],
      licenseName,
      licenseTextLinks: licenseTextLinks(licenseName, []),
      attributionRequired: attributionRequirement(licenseName),
      notes: ["Built-in texture listed in public/textures/manifest.json."],
    };
  });
}

function parsePnpmLicenseScan(scan) {
  const packages = [];

  for (const [licenseName, entries] of Object.entries(scan)) {
    for (const entry of entries) {
      packages.push({
        itemName: entry.name,
        versions: entry.versions || [],
        sourceUrl: entry.homepage || npmPackageUrl(entry.name),
        author: entry.author || "",
        licenseName,
        licenseTextLinks: licenseTextLinks(licenseName, []),
      });
    }
  }

  return packages.sort((a, b) => a.itemName.localeCompare(b.itemName));
}

function licenseTextLinks(licenseName, fallbackUrls) {
  const matches = [];
  for (const link of LICENSE_LINKS) {
    if (link.test.test(licenseName)) addUnique(matches, { label: link.label, url: link.url });
  }

  if (!matches.length) {
    const licenseUrl = fallbackUrls.find((url) => /license|legal/i.test(url));
    if (licenseUrl) addUnique(matches, { label: "License text", url: licenseUrl });
  }

  return matches;
}

function attributionRequirement(licenseName) {
  if (/CC[- ]BY/i.test(licenseName)) {
    return "Attribution required. Preserve creator/source credit and link to the license where practical.";
  }

  if (/Apache|BSD|MIT|ISC/i.test(licenseName)) {
    return "Preserve copyright, license text, and required notices with redistributions.";
  }

  if (/CC0|Unlicense|0BSD/i.test(licenseName)) {
    return "No attribution required by the license; listed here for transparency.";
  }

  return "See the source and license record for applicable attribution or notice requirements.";
}

function isProjectAuthoredOnly(notice) {
  return /project-authored asset unless otherwise documented/i.test(notice.licenseName);
}

function npmPackageUrl(packageName) {
  return `https://www.npmjs.com/package/${packageName}`;
}

function findUrls(text) {
  return [...text.matchAll(/https?:\/\/[^\s)]+/g)].map((match) => match[0].replace(/[.,;]+$/, ""));
}

function stripMarkdown(text) {
  return text
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1 - $2")
    .trim();
}

function renderPage({ appNotices, catalogNotices, textureNotices, dependencyNotices }) {
  const dependencyLicenses = [...new Set(dependencyNotices.map((notice) => notice.licenseName))].sort();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta
      name="description"
      content="Third-party software and asset notices for Critter Engine."
    />

    <title>Third-Party Notices | Critter Engine</title>

    <link rel="icon" href="../../logo/favicon.ico" sizes="any" />
    <link rel="icon" type="image/png" href="../../logo/favicon.png" />
    <link rel="apple-touch-icon" href="../../logo/icon-192.png" />
    <link rel="stylesheet" href="../../styles.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>

    <header class="site-header">
      <div class="container header-inner">
        <a class="brand" href="../../index.html" aria-label="Critter Engine home">
          <img class="brand-mark" src="../../logo/logo.svg" alt="" />
          <span class="brand-name">Critter Engine</span>
        </a>

        <button
          class="menu-toggle"
          type="button"
          aria-label="Open menu"
          aria-expanded="false"
          aria-controls="primary-nav"
          data-menu-toggle
        >
          <span></span>
          <span></span>
          <span></span>
        </button>

        <nav class="site-nav" id="primary-nav" aria-label="Primary" data-site-nav>
          <a href="../../index.html#why">Why Critter Engine</a>
          <a href="../../index.html#mujoco">MuJoCo</a>
          <a href="../../index.html#features">Features</a>
          <a href="../../updates/index.html">Updates</a>
          <a href="../../feedback/index.html">Send Feedback</a>
          <a href="../../index.html#faq">FAQ</a>
        </nav>

        <a class="button button-primary header-cta" href="../../updates/index.html">Sign Up</a>
      </div>
    </header>

    <main id="main">
      <section class="section legal-page">
        <div class="container legal-layout">
          <div class="legal-hero">
            <p class="eyebrow">Legal</p>
            <h1>Third-Party Notices</h1>
            <p class="lead">
              These notices cover third-party software and assets included in or made available
              through Critter Engine.
            </p>
            <p class="legal-updated">Generated ${escapeHtml(generatedDate)} from internal attribution sources and a production dependency license scan.</p>
          </div>

          <section class="notice-section" aria-labelledby="notice-sources">
            <h2 id="notice-sources">Source Records</h2>
            <p>
              This page is generated from Critter's internal attribution records and a
              production dependency license scan.
            </p>
          </section>

          <section class="notice-section" aria-labelledby="app-assets">
            <h2 id="app-assets">Bundled App Assets And Engines</h2>
            <div class="notice-grid">
              ${appNotices.map(renderAssetNotice).join("\n")}
            </div>
          </section>

          <section class="notice-section" aria-labelledby="catalog-assets">
            <h2 id="catalog-assets">Public Catalog Assets</h2>
            <div class="notice-grid">
              ${catalogNotices.map(renderAssetNotice).join("\n")}
            </div>
          </section>

          <section class="notice-section" aria-labelledby="textures">
            <h2 id="textures">Built-In Textures</h2>
            <div class="notice-grid notice-grid-compact">
              ${textureNotices.map(renderAssetNotice).join("\n")}
            </div>
          </section>

          <section class="notice-section" aria-labelledby="runtime-dependencies">
            <h2 id="runtime-dependencies">Runtime Software Dependencies</h2>
            <p>
              Production dependency scan includes ${dependencyNotices.length} package records under
              these license categories: ${dependencyLicenses.map((license) => `<code>${escapeHtml(license)}</code>`).join(", ")}.
            </p>
            <div class="notice-table-wrap">
              <table class="notice-table">
                <thead>
                  <tr>
                    <th scope="col">Item</th>
                    <th scope="col">Source URL</th>
                    <th scope="col">Author/copyright</th>
                    <th scope="col">License</th>
                    <th scope="col">License text</th>
                    <th scope="col">Attribution required</th>
                  </tr>
                </thead>
                <tbody>
                  ${dependencyNotices.map(renderDependencyRow).join("\n")}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </section>
    </main>

    <footer class="site-footer">
      <div class="container footer-inner">
        <a class="footer-brand" href="../../index.html" aria-label="Critter Engine home">
          <img class="footer-mark" src="../../logo/logo.svg" alt="" />
          <span>Critter Engine</span>
        </a>
        <p class="footer-meta">
          <span>&copy; <span id="year"></span></span>
          <span class="dot" aria-hidden="true">&middot;</span>
          <a href="../../updates/index.html">Updates</a>
          <span class="dot" aria-hidden="true">&middot;</span>
          <a href="../../feedback/index.html">Send Feedback</a>
          <span class="dot" aria-hidden="true">&middot;</span>
          <a href="../../legal/third-party-notices/" aria-current="page">Third-Party Notices</a>
        </p>
      </div>
    </footer>

    <script src="../../script.js" defer></script>
  </body>
</html>
`;
}

function renderAssetNotice(notice) {
  return `<article class="notice-card">
                <h3>${escapeHtml(notice.itemName)}</h3>
                <dl class="notice-meta">
                  ${renderDefinition("Source URL", renderSourceUrls(notice.sourceUrls))}
                  ${renderDefinition("Author/copyright", renderListOrFallback(notice.copyright, "Not specified in source record."))}
                  ${renderDefinition("License", escapeHtml(notice.licenseName))}
                  ${renderDefinition("License text", renderLicenseLinks(notice.licenseTextLinks, notice.sourceUrls))}
                  ${renderDefinition("Attribution required", escapeHtml(notice.attributionRequired))}
                  ${renderDefinition("Location", renderListOrFallback(notice.locations, "Not specified in source record."))}
                  ${renderDefinition("Notes", renderListOrFallback(notice.notes, "None."))}
                </dl>
              </article>`;
}

function renderDependencyRow(notice) {
  const item = [notice.itemName, notice.versions.join(", ")].filter(Boolean).join(" ");
  return `<tr>
                    <td>${escapeHtml(item)}</td>
                    <td><a href="${escapeAttribute(notice.sourceUrl)}">${escapeHtml(notice.sourceUrl)}</a></td>
                    <td>${escapeHtml(notice.author || "Not specified in scan output.")}</td>
                    <td>${escapeHtml(notice.licenseName)}</td>
                    <td>${renderLicenseLinks(notice.licenseTextLinks, [{ label: notice.sourceUrl, url: notice.sourceUrl }])}</td>
                    <td>${escapeHtml(attributionRequirement(notice.licenseName))}</td>
                  </tr>`;
}

function renderDefinition(term, valueHtml) {
  return `<div>
                    <dt>${escapeHtml(term)}</dt>
                    <dd>${valueHtml}</dd>
                  </div>`;
}

function renderSourceUrls(sourceUrls) {
  if (!sourceUrls.length) return "Not specified in source record.";
  return renderLinks(sourceUrls);
}

function renderLicenseLinks(links, fallbackSourceUrls) {
  if (links.length) return renderLinks(links);
  if (fallbackSourceUrls.length) {
    const first = fallbackSourceUrls[0];
    return `<a href="${escapeAttribute(first.url)}">See source record</a>`;
  }
  return "See source record.";
}

function renderLinks(links) {
  return `<ul>${links.map((link) => `<li><a href="${escapeAttribute(link.url)}">${escapeHtml(link.label || link.url)}</a></li>`).join("")}</ul>`;
}

function renderListOrFallback(values, fallback) {
  const filtered = values.filter(Boolean);
  if (!filtered.length) return escapeHtml(fallback);
  return `<ul>${filtered.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function addUnique(list, item) {
  if (!list.some((existing) => existing.url === item.url && existing.label === item.label)) list.push(item);
}

function addUniqueString(list, value) {
  const cleaned = value.trim();
  if (cleaned && !list.includes(cleaned)) list.push(cleaned);
}

function formatDate(date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}
