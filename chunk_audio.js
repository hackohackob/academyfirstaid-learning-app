require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const ROOT = __dirname;
const INPUT_DIR = path.join(ROOT, "compressed");
const OUTPUT_DIR = path.join(ROOT, "compressed_chunked");
const MAX_CHUNK_MB = 12; // stay under Whisper's 25MB cap
const MAX_CHUNK_BYTES = MAX_CHUNK_MB * 1024 * 1024;
const MIN_SEGMENT_SECONDS = 60;
const DEFAULT_SEGMENT_SECONDS = 10 * 60;

function ensureFfmpeg() {
  return new Promise((resolve, reject) => {
    const which = spawn(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { stdio: "ignore" });
    which.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg not found in PATH"))));
  });
}

function getDurationSeconds(inputPath) {
  try {
    const result = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", inputPath], {
      encoding: "utf8",
    });
    if (result.status === 0 && result.stdout) {
      const val = parseFloat(result.stdout.trim());
      if (!Number.isNaN(val)) return val;
    }
  } catch (err) {
    // fall through to ffmpeg parse
  }

  try {
    const probe = spawnSync("ffmpeg", ["-i", inputPath], { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
    const output = probe.stderr || probe.stdout || "";
    const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2], 10);
      const seconds = parseFloat(match[3]);
      return hours * 3600 + minutes * 60 + seconds;
    }
  } catch (err) {
    // ignore and return null
  }
  return null;
}

function computeSegmentSeconds(fileSizeBytes, durationSeconds) {
  if (!durationSeconds || durationSeconds <= 0) {
    return DEFAULT_SEGMENT_SECONDS;
  }
  const chunkCount = Math.max(1, Math.ceil(fileSizeBytes / MAX_CHUNK_BYTES));
  const estimated = Math.ceil(durationSeconds / chunkCount);
  return Math.max(MIN_SEGMENT_SECONDS, estimated);
}

function runFfmpegSegment(inputPath, segmentSeconds, outputPattern) {
  return new Promise((resolve, reject) => {
    const args = [
      "-hide_banner",
      "-y",
      "-i",
      inputPath,
      "-f",
      "segment",
      "-segment_time",
      String(segmentSeconds),
      "-c",
      "copy",
      "-map",
      "0",
      "-reset_timestamps",
      "1",
      outputPattern,
    ];
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

function parseArgs() {
  const fileArgIndex = process.argv.indexOf("--file");
  if (fileArgIndex !== -1 && process.argv[fileArgIndex + 1]) {
    return path.basename(process.argv[fileArgIndex + 1]);
  }
  const fileEq = process.argv.find((arg) => arg.startsWith("--file="));
  if (fileEq) {
    return path.basename(fileEq.split("=")[1] || "");
  }
  return null;
}

function listInputFiles(targetFile) {
  const allowed = [".mp3", ".ogg", ".wav", ".m4a", ".aac", ".flac"];
  const entries = fs.readdirSync(INPUT_DIR, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      const ext = path.extname(name).toLowerCase();
      return allowed.includes(ext);
    })
    .sort();

  if (targetFile) {
    if (!files.includes(targetFile)) {
      throw new Error(`Requested file not found in compressed/: ${targetFile}`);
    }
    return [targetFile];
  }
  return files;
}

async function chunkFile(filename) {
  const inputPath = path.join(INPUT_DIR, filename);
  const stats = fs.statSync(inputPath);
  const sizeBytes = stats.size;
  const sizeMB = (sizeBytes / (1024 * 1024)).toFixed(2);
  const durationSeconds = getDurationSeconds(inputPath);

  const baseName = filename.replace(/\.[^.]+$/, "");
  const ext = path.extname(filename) || ".ogg";
  const fileOutputDir = path.join(OUTPUT_DIR, baseName);
  const outputPattern = path.join(fileOutputDir, `${baseName}_part%03d${ext}`);

  fs.rmSync(fileOutputDir, { recursive: true, force: true });
  fs.mkdirSync(fileOutputDir, { recursive: true });

  const segmentSeconds = computeSegmentSeconds(sizeBytes, durationSeconds);
  const durationLabel = durationSeconds ? `${Math.round(durationSeconds)}s` : "unknown duration";

  console.log(`\n[chunk] ${filename}`);
  console.log(`  Size: ${sizeMB}MB`);
  console.log(`  Duration: ${durationLabel}`);
  console.log(`  Segment length: ${segmentSeconds}s`);
  console.log(`  Output dir: ${path.relative(ROOT, fileOutputDir)}`);

  await runFfmpegSegment(inputPath, segmentSeconds, outputPattern);

  const outputs = fs
    .readdirSync(fileOutputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();

  outputs.forEach((file, idx) => {
    const p = path.join(fileOutputDir, file);
    const mb = (fs.statSync(p).size / (1024 * 1024)).toFixed(2);
    console.log(`    [${idx + 1}/${outputs.length}] ${file} - ${mb}MB`);
  });
}

async function main() {
  try {
    await ensureFfmpeg();
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });

    const targetFile = parseArgs();
    const files = listInputFiles(targetFile);

    if (files.length === 0) {
      console.log(`No audio files found in ${INPUT_DIR}`);
      return;
    }

    console.log(`Found ${files.length} file(s) to chunk (max ~${MAX_CHUNK_MB}MB per piece)`);
    for (const file of files) {
      try {
        await chunkFile(file);
      } catch (err) {
        console.error(`\n❌ Failed to chunk ${file}: ${err.message}`);
      }
    }

    console.log(`\n✅ Chunking complete. Output -> ${path.relative(ROOT, OUTPUT_DIR)}`);
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
