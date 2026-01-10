const fs = require('fs');
const path = require('path');

const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts_combined');
const QUESTIONS_DIR = path.join(__dirname, 'questions');

// Ensure questions directory exists
if (!fs.existsSync(QUESTIONS_DIR)) {
  fs.mkdirSync(QUESTIONS_DIR, { recursive: true });
}

function prepareCsvFiles() {
  const files = fs.readdirSync(TRANSCRIPTS_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  if (files.length === 0) {
    console.log('No transcript files found in transcripts_combined directory');
    return;
  }

  console.log(`Found ${files.length} transcript file(s)\n`);

  let created = 0;
  let skipped = 0;

  for (const file of files) {
    const csvFilename = file.replace('.txt', '.csv');
    const csvPath = path.join(QUESTIONS_DIR, csvFilename);

    if (fs.existsSync(csvPath)) {
      console.log(`⏭️  Skipping ${csvFilename} - already exists`);
      skipped++;
      continue;
    }

    // Create CSV file with header only
    const header = 'Въпрос;Отговор\n';
    fs.writeFileSync(csvPath, header, 'utf8');
    console.log(`✅ Created ${csvFilename}`);
    created++;
  }

  console.log(`\n✅ Finished! Created ${created} CSV file(s), skipped ${skipped} existing file(s)`);
}

prepareCsvFiles();






