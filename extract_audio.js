const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = __dirname;
const VIDEO_DIR = path.join(ROOT, "videos");
const AUDIO_DIR = path.join(ROOT, "audios");

function transliterateBgToLatin(text) {
  const mapping = {
    а: "a",
    б: "b",
    в: "v",
    г: "g",
    д: "d",
    е: "e",
    ж: "zh",
    з: "z",
    и: "i",
    й: "y",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "h",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "sht",
    ъ: "a",
    ь: "",
    ю: "yu",
    я: "ya",
    ѝ: "i",
    ё: "yo",
    А: "A",
    Б: "B",
    В: "V",
    Г: "G",
    Д: "D",
    Е: "E",
    Ж: "Zh",
    З: "Z",
    И: "I",
    Й: "Y",
    К: "K",
    Л: "L",
    М: "M",
    Н: "N",
    О: "O",
    П: "P",
    Р: "R",
    С: "S",
    Т: "T",
    У: "U",
    Ф: "F",
    Х: "H",
    Ц: "Ts",
    Ч: "Ch",
    Ш: "Sh",
    Щ: "Sht",
    Ъ: "A",
    Ь: "",
    Ю: "Yu",
    Я: "Ya",
    Ѝ: "I",
    Ё: "Yo",
  };

  const transliterated = [...text].map((char) => mapping[char] ?? char).join("");
  const ascii = transliterated.normalize("NFKD").replace(/[^\x00-\x7F]/g, "");
  const slug = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "audio";
}

function parseVideoName(fileName) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const match = stem.match(/^\s*(\d+)\s*[._-]?\s*(.*)$/);
  if (match) {
    const [, number, title] = match;
    return { number, title: title || stem };
  }
  // If no number prefix, use "0" as number and whole stem as title
  return { number: "0", title: stem };
}

function ensureFfmpeg() {
  try {
    const which = spawn(process.platform === "win32" ? "where" : "which", ["ffmpeg"], { stdio: "ignore" });
    return new Promise((resolve, reject) => {
      which.on("exit", (code) => (code === 0 ? resolve() : reject(new Error("ffmpeg not found in PATH"))));
    });
  } catch (err) {
    return Promise.reject(err);
  }
}

function runFfmpeg(videoPath, outputPath) {
  return new Promise((resolve, reject) => {
    const args = ["-y", "-i", videoPath, "-vn", "-map", "0:a:0?", "-c:a", "mp3", "-q:a", "2", outputPath];
    const proc = spawn("ffmpeg", args, { stdio: "inherit" });
    proc.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

async function extractAudio(videoFile) {
  const { number, title } = parseVideoName(videoFile);
  const slug = transliterateBgToLatin(title);
  const outputName = `${number}-${slug}.mp3`;
  const videoPath = path.join(VIDEO_DIR, videoFile);
  const outputPath = path.join(AUDIO_DIR, outputName);

  console.log(`[ffmpeg] ${videoFile} -> ${outputName}`);
  await runFfmpeg(videoPath, outputPath);
}

async function main() {
  await ensureFfmpeg();
  fs.mkdirSync(AUDIO_DIR, { recursive: true });

  // Get pattern from command-line argument
  const pattern = process.argv[2];

  let files = fs.readdirSync(VIDEO_DIR).filter((file) => file.toLowerCase().endsWith(".mp4")).sort();
  
  // Filter files by pattern if provided
  if (pattern) {
    const regex = new RegExp(pattern, "i"); // case-insensitive
    files = files.filter((file) => regex.test(file));
    if (files.length === 0) {
      console.log(`No .mp4 files found matching pattern: ${pattern}`);
      return;
    }
    console.log(`Filtering files by pattern: ${pattern}`);
  }

  if (files.length === 0) {
    console.log("No .mp4 files found in the videos directory.");
    return;
  }

  console.log(`Processing ${files.length} file(s)...`);

  for (const file of files) {
    try {
      await extractAudio(file);
    } catch (err) {
      console.error(String(err));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
