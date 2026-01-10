require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const ROOT = __dirname;
const AUDIO_DIR = path.join(ROOT, "compressed_chunked");
const TRANSCRIPT_DIR = path.join(ROOT, "transcripts");
const API_KEY = process.env.OPENAI_API_KEY;

// Initialize OpenAI client with extended timeout
const openai = new OpenAI({
  apiKey: API_KEY,
  timeout: 60 * 60 * 1000, // 60 minutes in milliseconds
});

const MAX_FILE_SIZE_MB = 25;

async function callWhisper(audioPath) {
  if (!API_KEY) {
    throw new Error("Set OPENAI_API_KEY in your environment before running.");
  }

  try {
    const fileStats = fs.statSync(audioPath);
    const fileSizeMB = fileStats.size / (1024 * 1024);
    const fileSize = fileSizeMB.toFixed(2);
    console.log(`  File size: ${fileSize} MB`);
    
    // Check file size limit
    if (fileSizeMB > MAX_FILE_SIZE_MB) {
      throw new Error(
        `File size (${fileSize} MB) exceeds Whisper API limit of ${MAX_FILE_SIZE_MB} MB. ` +
        `Please split the audio file into smaller chunks.`
      );
    }

    console.log(`  Calling OpenAI Whisper API...`);
    
    // Track request start time
    const startTime = Date.now();
    
    try {
      const transcription = await openai.audio.transcriptions.create({
        file: fs.createReadStream(audioPath),
        model: "whisper-1",
        language: "bg",
        // chunking_strategy: "auto",
        // response_format: "text",
      }, {
        timeout: 60 * 60 * 1000, // 60 minutes in milliseconds
      });
      
      // Calculate elapsed time
      const elapsedTime = Date.now() - startTime;
      const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
      const elapsedMinutes = (elapsedTime / 60000).toFixed(2);
      console.log(`  ✅ Request succeeded in ${elapsedSeconds}s (${elapsedMinutes} minutes)`);

      // The SDK returns the transcription text directly when response_format is "text"
      return transcription;
    } catch (apiErr) {
      // Calculate elapsed time even on error
      const elapsedTime = Date.now() - startTime;
      const elapsedSeconds = (elapsedTime / 1000).toFixed(2);
      const elapsedMinutes = (elapsedTime / 60000).toFixed(2);
      
      console.error(`  ❌ Request failed after ${elapsedSeconds}s (${elapsedMinutes} minutes)`);
      
      if (apiErr.message && apiErr.message.includes("timeout")) {
        throw new Error(`Request timeout after ${elapsedSeconds}s for ${path.basename(audioPath)}`);
      }
      
      // Re-throw OpenAI API errors with more context
      if (apiErr.status) {
        throw new Error(
          `OpenAI API error (${apiErr.status}): ${apiErr.message}\n` +
          `File: ${path.basename(audioPath)}\n` +
          `Elapsed time: ${elapsedSeconds}s`
        );
      }
      
      throw apiErr;
    }
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Audio file not found: ${audioPath}`);
    }
    if (err.message.includes("OpenAI API error") || err.message.includes("Request timeout") || err.message.includes("exceeds Whisper API limit")) {
      throw err;
    }
    throw new Error(`Error calling Whisper API for ${path.basename(audioPath)}: ${err.message}\n${err.stack}`);
  }
}

function getAllChunkFiles() {
  try {
    const allChunks = [];
    
    // Get all subdirectories in compressed_chunked
    const subdirs = fs
      .readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .filter((entry) => entry.name.toLowerCase() !== "processed")
      .map((entry) => entry.name)
      .sort();

    if (subdirs.length === 0) {
      throw new Error(`No subdirectories found in ${AUDIO_DIR}`);
    }

    // For each subdirectory, find all audio files
    for (const subdir of subdirs) {
      const subdirPath = path.join(AUDIO_DIR, subdir);
      const files = fs
        .readdirSync(subdirPath, { withFileTypes: true })
        .filter((entry) => entry.isFile() && 
          (entry.name.toLowerCase().endsWith(".ogg") || 
           entry.name.toLowerCase().endsWith(".mp3")))
        .map((entry) => ({
          name: entry.name,
          fullPath: path.join(subdirPath, entry.name),
          subdir: subdir
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      
      allChunks.push(...files);
    }

    return allChunks;
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Audio directory not found: ${AUDIO_DIR}`);
    }
    throw err;
  }
}

function getUntranscribedChunks() {
  const allChunks = getAllChunkFiles();
  
  if (allChunks.length === 0) {
    throw new Error(`No audio chunks found in ${AUDIO_DIR}`);
  }

  // Filter chunks that haven't been transcribed yet
  const untranscribed = [];
  for (const chunk of allChunks) {
    const transcriptName = chunk.name.replace(/\.[^.]+$/, ".txt");
    const transcriptPath = path.join(TRANSCRIPT_DIR, transcriptName);
    
    if (!fs.existsSync(transcriptPath)) {
      untranscribed.push(chunk);
    }
  }

  return untranscribed;
}

async function main() {
  try {
    fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

    // Get all untranscribed chunks
    const untranscribedChunks = getUntranscribedChunks();
    
    if (untranscribedChunks.length === 0) {
      console.log("✅ All audio chunks have been transcribed!");
      return;
    }

    console.log(`Found ${untranscribedChunks.length} untranscribed chunk(s). Starting transcription...\n`);

    // Process each untranscribed chunk
    for (let i = 0; i < untranscribedChunks.length; i++) {
      const chunk = untranscribedChunks[i];
      const transcriptName = chunk.name.replace(/\.[^.]+$/, ".txt");
      const transcriptPath = path.join(TRANSCRIPT_DIR, transcriptName);

      console.log(`[${i + 1}/${untranscribedChunks.length}] Transcribing ${chunk.name} ...`);
      console.log(`  Audio path: ${chunk.fullPath}`);
      console.log(`  Output path: ${transcriptPath}`);
      
      const transcription = await callWhisper(chunk.fullPath);
      const text = typeof transcription === 'string' ? transcription : transcription.text;
      fs.writeFileSync(transcriptPath, text, "utf8");
      console.log(`  ✅ Saved transcript -> ${path.relative(ROOT, transcriptPath)}`);
      console.log(`  Transcript length: ${text.length} characters\n`);
    }

    console.log(`✅ Successfully transcribed ${untranscribedChunks.length} chunk(s)!`);
  } catch (err) {
    throw err; // Re-throw to be caught by the outer handler
  }
}

main().catch((err) => {
  console.error("\n❌ Error occurred:");
  console.error("─".repeat(60));
  console.error(`Message: ${err.message || err}`);
  if (err.stack && err.stack !== err.message) {
    console.error("\nStack trace:");
    console.error(err.stack);
  }
  if (err.cause) {
    console.error("\nCaused by:");
    console.error(err.cause);
  }
  console.error("─".repeat(60));
  process.exit(1);
});
