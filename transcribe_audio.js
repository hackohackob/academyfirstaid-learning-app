const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const AUDIO_DIR = path.join(ROOT, "audios");
const TRANSCRIPT_DIR = path.join(ROOT, "transcripts");
const API_KEY = process.env.OPENAI_API_KEY;

async function callWhisper(audioPath) {
  if (!API_KEY) {
    throw new Error("Set OPENAI_API_KEY in your environment before running.");
  }

  const fileBuffer = fs.readFileSync(audioPath);
  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer]), path.basename(audioPath));
  formData.append("model", "whisper-1");
  formData.append("language", "bg");
  formData.append("response_format", "text");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${API_KEY}` },
    body: formData,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI API error ${res.status}: ${body}`);
  }

  return res.text();
}

function pickAudio(argv) {
  const all = fs
    .readdirSync(AUDIO_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".mp3"))
    .map((entry) => entry.name)
    .sort();

  if (all.length === 0) {
    throw new Error("No .mp3 files found in audios/. Run extract_audio.js first.");
  }

  const fileFlagIndex = argv.indexOf("--file");
  if (fileFlagIndex !== -1 && argv[fileFlagIndex + 1]) {
    const requested = path.basename(argv[fileFlagIndex + 1]);
    if (!all.includes(requested)) {
      throw new Error(`Requested file not found in audios/: ${requested}`);
    }
    return requested;
  }

  return all[0];
}

async function main() {
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

  const audioFile = pickAudio(process.argv.slice(2));
  const audioPath = path.join(AUDIO_DIR, audioFile);
  const transcriptName = audioFile.replace(/\.[^.]+$/, ".txt");
  const transcriptPath = path.join(TRANSCRIPT_DIR, transcriptName);

  console.log(`Transcribing ${audioFile} ...`);
  const text = await callWhisper(audioPath);
  fs.writeFileSync(transcriptPath, text, "utf8");
  console.log(`Saved transcript -> ${path.relative(ROOT, transcriptPath)}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
