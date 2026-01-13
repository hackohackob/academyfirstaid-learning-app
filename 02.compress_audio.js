require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { execSync, spawnSync } = require("child_process");

const ROOT = __dirname;
const AUDIO_DIR = path.join(ROOT, "audios");
const COMPRESSED_DIR = path.join(ROOT, "compressed");
const TARGET_SIZE_MB = 25;
const TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024;

// Check if ffmpeg is available
function checkFFmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

// Get file size in bytes
function getFileSize(filePath) {
  return fs.statSync(filePath).size;
}

// Get audio duration in seconds
function getAudioDuration(inputPath) {
  try {
    // ffmpeg outputs info to stderr and exits with code 1 when no output file is specified
    // Use spawnSync to properly capture stderr
    const result = spawnSync('ffmpeg', ['-i', inputPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024
    });
    
    // ffmpeg info is in stderr
    const stderr = result.stderr || '';
    const match = stderr.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const seconds = parseFloat(match[3]);
      return hours * 3600 + minutes * 60 + seconds;
    }
  } catch (err) {
    // Fallback: try to extract from error message
    const output = err.stderr ? err.stderr.toString() : (err.message || "");
    const match = output.match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    if (match) {
      const hours = parseInt(match[1]);
      const minutes = parseInt(match[2]);
      const seconds = parseFloat(match[3]);
      return hours * 3600 + minutes * 60 + seconds;
    }
  }
  return null;
}

// Compress audio with specific bitrate using Opus codec (better compression than MP3)
function compressAudio(inputPath, outputPath, bitrate) {
  try {
    // Use Opus codec in OGG container - much better compression at low bitrates
    // Opus is more efficient than MP3, especially at bitrates below 64kbps
    execSync(
      `ffmpeg -i "${inputPath}" -codec:a libopus -b:a ${bitrate}k -y "${outputPath}"`,
      { stdio: "ignore" }
    );
    return true;
  } catch (err) {
    return false;
  }
}

// Copy file without re-encoding
function copyFile(inputPath, outputPath) {
  try {
    fs.copyFileSync(inputPath, outputPath);
    return true;
  } catch (err) {
    return false;
  }
}

// Calculate approximate bitrate needed to achieve target size
function calculateNeededBitrate(durationSeconds, targetBytes) {
  // bitrate (kbps) = (target_size_bytes * 8) / (duration_seconds * 1000)
  const bitrate = (targetBytes * 8) / (durationSeconds * 1000);
  // Round to nearest integer and add small buffer (95% of target to be safe)
  return Math.floor(bitrate * 0.95);
}

// Test a specific bitrate and return the result
function testBitrate(inputPath, outputPath, bitrate) {
  if (!compressAudio(inputPath, outputPath, bitrate)) {
    return null;
  }
  const size = getFileSize(outputPath);
  const sizeMB = (size / (1024 * 1024)).toFixed(2);
  console.log(`  Trying ${bitrate}kbps... Result: ${sizeMB}MB`);
  return { bitrate, size, sizeMB };
}

// Find optimal bitrate using smart boundary testing
function findOptimalBitrate(inputPath, outputPath, durationSeconds) {
  // Calculate starting bitrate based on duration
  const estimatedBitrate = calculateNeededBitrate(durationSeconds, TARGET_SIZE_BYTES);
  
  console.log(`  Estimated bitrate needed: ~${estimatedBitrate}kbps`);

  let bestBitrate = 0;
  let bestSize = Infinity;
  const testedBitrates = new Map(); // Track tested bitrates and their sizes

  // Test meaningful bitrate values for speech/voice content first
  // Priority order: 38 (high-quality voice), 32 (very clean), 24 (sweet spot), 20 (clear speech)
  // These are the most important quality levels for speech transcription
  const minAllowedBitrate = 12;
  
  // Always test these key bitrates first: 38, 32, 24, 20 (in that order)
  let testBitrates = [38, 32, 24, 20];
  
  // If estimated is very low, also include lower bitrates (16, 12)
  if (estimatedBitrate <= 20) {
    testBitrates.push(16, 12);
  }
  
  // Remove duplicates and keep descending order (test higher quality first)
  testBitrates = [...new Set(testBitrates)].filter(rate => rate >= minAllowedBitrate).sort((a, b) => b - a);

  console.log(`  Testing boundary bitrates: ${testBitrates.join('kbps, ')}kbps`);

  // Test bitrates and stop as soon as we find one that works (under 25MB)
  for (const bitrate of testBitrates) {
    const result = testBitrate(inputPath, outputPath, bitrate);
    if (result) {
      testedBitrates.set(bitrate, result.size);
      
      if (result.size <= TARGET_SIZE_BYTES) {
        // Found a working bitrate! Save it and stop searching
        bestBitrate = bitrate;
        bestSize = result.size;
        console.log(`  ✓ Found working bitrate: ${bitrate}kbps -> ${result.sizeMB}MB`);
        break; // Stop searching, we found one that works
      }
    }
  }

  // If we didn't find a working bitrate in the initial tests, search lower
  if (bestBitrate === 0) {
    // No working bitrate found in boundaries, need to go lower
    console.log(`  No working bitrate in boundaries, searching lower...`);
    let testLower = Math.min(...testBitrates);
    
    // Allow going below 24kbps if needed (minimum 16kbps for very long files)
    const minAllowedBitrate = 16;
    
    while (testLower > minAllowedBitrate) {
      testLower -= 2; // Test in steps of 2
      if (testLower < minAllowedBitrate) break;
      
      const result = testBitrate(inputPath, outputPath, testLower);
      if (result) {
        testedBitrates.set(testLower, result.size);
        
        if (result.size <= TARGET_SIZE_BYTES) {
          bestBitrate = testLower;
          bestSize = result.size;
          // Continue to find the highest bitrate that still works
          break;
        }
      }
    }
    
    // If we found a working bitrate by going lower, try to optimize upward
    if (bestBitrate > 0) {
      console.log(`  Found working bitrate at ${bestBitrate}kbps, optimizing upward...`);
      let testUp = bestBitrate;
      const maxTest = Math.min(...testBitrates.filter(b => b > bestBitrate)) || bestBitrate + 10;
      
      while (testUp < maxTest) {
        testUp += 1;
        const result = testBitrate(inputPath, outputPath, testUp);
        if (result) {
          testedBitrates.set(testUp, result.size);
          if (result.size <= TARGET_SIZE_BYTES) {
            bestBitrate = testUp;
            bestSize = result.size;
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }
  }

  // Final compression with best bitrate found
  if (bestBitrate > 0 && bestSize < Infinity) {
    compressAudio(inputPath, outputPath, bestBitrate);
    const finalSize = getFileSize(outputPath);
    const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);
    console.log(`  Final: ${bestBitrate}kbps -> ${finalSizeMB}MB`);
    return bestBitrate;
  }

  // Fallback: use estimated bitrate
  console.log(`  ⚠ No working bitrate found in search, using estimated: ${estimatedBitrate}kbps`);
  compressAudio(inputPath, outputPath, estimatedBitrate);
  return estimatedBitrate;
}

// Process a single audio file
function processAudioFile(filename) {
  const inputPath = path.join(AUDIO_DIR, filename);
  // Change extension to .ogg for Opus codec
  const outputFilename = filename.replace(/\.[^.]+$/, ".ogg");
  const outputPath = path.join(COMPRESSED_DIR, outputFilename);
  
  const originalSize = getFileSize(inputPath);
  const originalSizeMB = (originalSize / (1024 * 1024)).toFixed(2);
  
  console.log(`\nProcessing: ${filename}`);
  console.log(`  Original size: ${originalSizeMB}MB`);
  
  // If already under target, just copy it (don't re-encode)
  if (originalSize <= TARGET_SIZE_BYTES) {
    console.log(`  Already under ${TARGET_SIZE_MB}MB, copying without re-encoding...`);
    copyFile(inputPath, outputPath);
    const finalSize = getFileSize(outputPath);
    const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);
    console.log(`  ✓ Copied: ${originalSizeMB}MB -> ${finalSizeMB}MB (no compression needed)`);
    return;
  }
  
  // Get duration to calculate optimal bitrate
  const duration = getAudioDuration(inputPath);
  if (!duration) {
    console.log(`  ⚠ Could not determine duration, using default compression...`);
    findOptimalBitrate(inputPath, outputPath, 3600); // Assume 1 hour if unknown
  } else {
    const durationMin = Math.floor(duration / 60);
    const durationSec = Math.floor(duration % 60);
    console.log(`  Duration: ${durationMin}:${durationSec.toString().padStart(2, '0')}`);
    findOptimalBitrate(inputPath, outputPath, duration);
  }
  
  const finalSize = getFileSize(outputPath);
  const finalSizeMB = (finalSize / (1024 * 1024)).toFixed(2);
  const compressionRatio = ((1 - finalSize / originalSize) * 100).toFixed(1);
  
  console.log(`  ✓ Compressed: ${originalSizeMB}MB -> ${finalSizeMB}MB (${compressionRatio}% reduction)`);
  
  if (finalSize > TARGET_SIZE_BYTES) {
    console.log(`  ⚠ Warning: File still exceeds ${TARGET_SIZE_MB}MB after compression`);
  }
}

// Main function
function main() {
  try {
    // Check ffmpeg
    if (!checkFFmpeg()) {
      throw new Error(
        "ffmpeg is not installed or not in PATH.\n" +
        "Please install ffmpeg: https://ffmpeg.org/download.html\n" +
        "On macOS: brew install ffmpeg"
      );
    }

    // Create compressed directory
    if (!fs.existsSync(COMPRESSED_DIR)) {
      fs.mkdirSync(COMPRESSED_DIR, { recursive: true });
      console.log(`Created directory: ${COMPRESSED_DIR}`);
    }

    // Get all audio files
    const audioFiles = fs
      .readdirSync(AUDIO_DIR, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isFile()) return false;
        const ext = path.extname(entry.name).toLowerCase();
        return [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"].includes(ext);
      })
      .map((entry) => entry.name)
      .sort();

    if (audioFiles.length === 0) {
      throw new Error(`No audio files found in ${AUDIO_DIR}`);
    }

    console.log(`Found ${audioFiles.length} audio file(s) to process`);
    console.log(`Target size: <${TARGET_SIZE_MB}MB per file`);
    console.log(`Using Opus codec (better compression than MP3 at low bitrates)\n`);

    // Process each file
    audioFiles.forEach((filename) => {
      try {
        processAudioFile(filename);
      } catch (err) {
        console.error(`\n❌ Error processing ${filename}:`);
        console.error(`   ${err.message}`);
      }
    });

    console.log(`\n✅ Compression complete!`);
    console.log(`   Output directory: ${COMPRESSED_DIR}`);
  } catch (err) {
    console.error("\n❌ Error occurred:");
    console.error("─".repeat(60));
    console.error(`Message: ${err.message || err}`);
    if (err.stack && err.stack !== err.message) {
      console.error("\nStack trace:");
      console.error(err.stack);
    }
    console.error("─".repeat(60));
    process.exit(1);
  }
}

main();
