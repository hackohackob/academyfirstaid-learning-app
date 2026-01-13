const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const INPUT_DIR = path.join(ROOT, "transcripts");
const OUTPUT_DIR = path.join(ROOT, "transcripts_combined");

function ensureDirs() {
  if (!fs.existsSync(INPUT_DIR)) {
    throw new Error(`Input transcripts directory not found: ${INPUT_DIR}`);
  }
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

function parseArgs() {
  const fileArgIndex = process.argv.indexOf("--file");
  if (fileArgIndex !== -1 && process.argv[fileArgIndex + 1]) {
    return process.argv[fileArgIndex + 1];
  }
  const fileEq = process.argv.find((arg) => arg.startsWith("--file="));
  if (fileEq) {
    return fileEq.split("=")[1];
  }
  return null;
}

function collectParts(targetBase) {
  const entries = fs.readdirSync(INPUT_DIR, { withFileTypes: true });
  const groups = new Map();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.*)_part(\d+)\.txt$/i);
    if (!match) continue;

    const base = match[1];
    const partNum = parseInt(match[2], 10);
    if (Number.isNaN(partNum)) continue;

    if (targetBase && base !== targetBase) continue;

    if (!groups.has(base)) groups.set(base, []);
    groups.get(base).push({
      name: entry.name,
      part: partNum,
      fullPath: path.join(INPUT_DIR, entry.name),
    });
  }

  return groups;
}

function collectSingles(targetBase, groupedBases) {
  const entries = fs.readdirSync(INPUT_DIR, { withFileTypes: true });
  const singles = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.toLowerCase().endsWith(".txt")) continue;
    if (/_part\d+\.txt$/i.test(entry.name)) continue; // skip part files

    const base = entry.name.replace(/\.txt$/i, "");
    if (groupedBases.has(base)) continue; // a combined version exists
    if (targetBase && base !== targetBase) continue;

    singles.push({
      base,
      name: entry.name,
      fullPath: path.join(INPUT_DIR, entry.name),
    });
  }

  return singles;
}

function stripPrefix(baseName) {
  const prefixes = [
    "ortopediya-i-travmatologiya-",
    "anatomiya-i-fiziologiya-na-choveka-",
    "anatomiya-i-fitsiologiya-na-choveka-",
    "anatomiya-i-fiziologiya-",
    "anatomiya-i-fitsiologiya-",
  ];
  const lowerBase = baseName.toLowerCase();
  for (const prefix of prefixes) {
    const index = lowerBase.indexOf(prefix);
    if (index !== -1) {
      return baseName.substring(0, index) + baseName.substring(index + prefix.length);
    }
  }
  return baseName;
}

function combineGroup(base, parts) {
  const sorted = parts.sort((a, b) => a.part - b.part);
  const outputBase = stripPrefix(base);
  const outputPath = path.join(OUTPUT_DIR, `${outputBase}.txt`);
  const chunks = sorted.map((item) => fs.readFileSync(item.fullPath, "utf8"));
  const combined = chunks.join("\n\n").trimEnd() + "\n";
  fs.writeFileSync(outputPath, combined, "utf8");

  console.log(`✓ Combined ${sorted.length} part(s) -> ${path.relative(ROOT, outputPath)}`);
}

function copySingle(single) {
  const outputBase = stripPrefix(single.base);
  const outputPath = path.join(OUTPUT_DIR, `${outputBase}.txt`);
  fs.copyFileSync(single.fullPath, outputPath);
  console.log(`✓ Copied single transcript -> ${path.relative(ROOT, outputPath)}`);
}

function main() {
  try {
    ensureDirs();
    const targetBase = parseArgs();
    const groups = collectParts(targetBase);
    const singles = collectSingles(targetBase, new Set(groups.keys()));

    if (groups.size === 0 && singles.length === 0) {
      console.log(targetBase ? `No matching transcripts for base: ${targetBase}` : "No transcripts found to process.");
      return;
    }

    let combinedCount = 0;
    for (const [base, parts] of groups.entries()) {
      if (parts.length <= 1) {
        console.log(`Skipped ${base}: only one part found.`);
        continue;
      }
      combineGroup(base, parts);
      combinedCount += 1;
    }

    let copiedCount = 0;
    for (const single of singles) {
      copySingle(single);
      copiedCount += 1;
    }

    console.log(`\nDone. Combined: ${combinedCount}, Copied singles: ${copiedCount}`);
  } catch (err) {
    console.error("\n❌ Error occurred:");
    console.error("─".repeat(60));
    console.error(err.message || err);
    if (err.stack && err.stack !== err.message) {
      console.error("\nStack trace:");
      console.error(err.stack);
    }
    console.error("─".repeat(60));
    process.exit(1);
  }
}

main();
