const fs = require('fs');
const path = require('path');
const { OpenAI } = require('openai');
require('dotenv').config();

const TRANSCRIPTS_DIR = path.join(__dirname, 'transcripts_combined');
const QUESTIONS_DIR = path.join(__dirname, 'questions');

// Ensure questions directory exists
if (!fs.existsSync(QUESTIONS_DIR)) {
  fs.mkdirSync(QUESTIONS_DIR, { recursive: true });
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function extractQuestionsFromTranscript(transcriptText) {
  const prompt = `Извлечи въпроси и отговори от следния лекционен текст на български език. 
Създай списък с въпроси и отговори във формат:
- Въпросът трябва да бъде конкретен и ясен
- Отговорът трябва да бъде кратък и точен
- Фокус върху ключовите концепции, дефиниции, процеси и факти
- Избягвай въпроси за незначителни детайли

Текст:
${transcriptText}

Върни само списък с въпроси и отговори, всеки на нов ред във формат:
ВЪПРОС: [въпросът]
ОТГОВОР: [отговорът]

Без допълнителни обяснения.`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Ти си помощник, който извлича структурирана информация от лекционни текстове. Връщаш само списък с въпроси и отговори без допълнителни коментари.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
    });

    return response.choices[0].message.content;
  } catch (error) {
    console.error('Error calling OpenAI:', error);
    throw error;
  }
}

function parseQAPairs(text) {
  const pairs = [];
  const lines = text.split('\n').filter(line => line.trim());
  
  let currentQuestion = null;
  let currentAnswer = null;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('ВЪПРОС:') || trimmed.startsWith('Въпрос:')) {
      if (currentQuestion && currentAnswer) {
        pairs.push({ question: currentQuestion, answer: currentAnswer });
      }
      currentQuestion = trimmed.replace(/^ВЪПРОС:\s*/i, '').trim();
      currentAnswer = null;
    } else if (trimmed.startsWith('ОТГОВОР:') || trimmed.startsWith('Отговор:')) {
      currentAnswer = trimmed.replace(/^ОТГОВОР:\s*/i, '').trim();
    } else if (currentQuestion && !currentAnswer) {
      // Continuation of question
      currentQuestion += ' ' + trimmed;
    } else if (currentAnswer) {
      // Continuation of answer
      currentAnswer += ' ' + trimmed;
    } else if (currentQuestion) {
      // First line after question, assume it's the answer
      currentAnswer = trimmed;
    }
  }

  // Add last pair
  if (currentQuestion && currentAnswer) {
    pairs.push({ question: currentQuestion, answer: currentAnswer });
  }

  return pairs;
}

function escapeCsv(value) {
  if (!value) return '';
  const needsQuotes = /[;"\n]/.test(value);
  if (needsQuotes) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function writeCsvFile(filePath, pairs) {
  const lines = ['Въпрос;Отговор'];
  for (const pair of pairs) {
    lines.push(`${escapeCsv(pair.question)};${escapeCsv(pair.answer)}`);
  }
  fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
}

async function processTranscriptFile(filename) {
  const transcriptPath = path.join(TRANSCRIPTS_DIR, filename);
  const csvFilename = filename.replace('.txt', '.csv');
  const csvPath = path.join(QUESTIONS_DIR, csvFilename);

  // Skip if CSV already exists
  if (fs.existsSync(csvPath)) {
    console.log(`⏭️  Skipping ${filename} - CSV already exists`);
    return;
  }

  console.log(`\n📖 Processing ${filename}...`);
  
  const transcriptText = fs.readFileSync(transcriptPath, 'utf8');
  
  if (!transcriptText.trim()) {
    console.log(`⚠️  Skipping ${filename} - file is empty`);
    return;
  }

  try {
    console.log(`  🤖 Extracting questions and answers...`);
    const extractedText = await extractQuestionsFromTranscript(transcriptText);
    
    console.log(`  📝 Parsing Q&A pairs...`);
    const pairs = parseQAPairs(extractedText);
    
    if (pairs.length === 0) {
      console.log(`  ⚠️  No Q&A pairs extracted from ${filename}`);
      // Create empty CSV with just header
      writeCsvFile(csvPath, []);
      return;
    }

    console.log(`  💾 Writing ${pairs.length} Q&A pairs to CSV...`);
    writeCsvFile(csvPath, pairs);
    
    console.log(`  ✅ Created ${csvFilename} with ${pairs.length} questions`);
  } catch (error) {
    console.error(`  ❌ Error processing ${filename}:`, error.message);
    // Create empty CSV file anyway
    writeCsvFile(csvPath, []);
  }
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ Error: OPENAI_API_KEY not found in environment variables');
    console.error('   Please set it in your .env file');
    process.exit(1);
  }

  const files = fs.readdirSync(TRANSCRIPTS_DIR)
    .filter(f => f.endsWith('.txt'))
    .sort();

  if (files.length === 0) {
    console.log('No transcript files found in transcripts_combined directory');
    return;
  }

  console.log(`Found ${files.length} transcript file(s) to process\n`);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`[${i + 1}/${files.length}]`);
    await processTranscriptFile(file);
  }

  console.log(`\n✅ Finished processing all transcript files!`);
}

main().catch((err) => {
  console.error('\n❌ Error occurred:', err);
  process.exit(1);
});

