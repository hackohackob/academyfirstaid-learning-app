const fs = require('fs');
const path = require('path');

const folderPath = __dirname;
const outputFile = path.join(folderPath, 'unique-questions.csv');

// Map to store unique questions (key: normalized question, value: { question, answer, image })
const uniqueQuestions = new Map();

// Function to normalize question text for comparison
function normalizeQuestion(text) {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Function to detect delimiter
function detectDelimiter(line) {
  const semicolonCount = (line.match(/;/g) || []).length;
  const commaCount = (line.match(/,/g) || []).length;
  return semicolonCount > commaCount ? ';' : ',';
}

// Function to parse CSV line
function parseCSVLine(line, delimiter) {
  const result = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  
  return result;
}

// Get all CSV files in the folder
const files = fs.readdirSync(folderPath)
  .filter(file => file.endsWith('.csv') && file !== 'unique-questions.csv');

console.log(`Found ${files.length} CSV files to process:\n`);

files.forEach(file => {
  const filePath = path.join(folderPath, file);
  console.log(`Processing ${file}...`);
  
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());
    
    if (lines.length === 0) {
      console.log(`  ⚠️  File is empty, skipping...\n`);
      return;
    }
    
    // Detect delimiter from first line
    const delimiter = detectDelimiter(lines[0]);
    console.log(`  Using delimiter: ${delimiter === ';' ? 'semicolon' : 'comma'}`);
    
    // Skip header row
    const dataLines = lines.slice(1);
    let processed = 0;
    let duplicates = 0;
    
    dataLines.forEach((line, index) => {
      if (!line.trim()) return;
      
      const columns = parseCSVLine(line, delimiter);
      
      // Handle different column structures
      let question = '';
      let answer = '';
      let image = '';
      
      if (columns.length >= 2) {
        question = columns[0].replace(/^"|"$/g, ''); // Remove surrounding quotes
        answer = columns[1].replace(/^"|"$/g, '');
        image = columns[2] ? columns[2].replace(/^"|"$/g, '') : '';
      }
      
      if (!question) return;
      
      const normalized = normalizeQuestion(question);
      
      if (!uniqueQuestions.has(normalized)) {
        uniqueQuestions.set(normalized, {
          question: question,
          answer: answer,
          image: image
        });
        processed++;
      } else {
        duplicates++;
        // Update if we have an image and the existing one doesn't
        const existing = uniqueQuestions.get(normalized);
        if (!existing.image && image) {
          existing.image = image;
        }
      }
    });
    
    console.log(`  ✓ Processed ${processed} new questions, ${duplicates} duplicates\n`);
  } catch (error) {
    console.error(`  ✗ Error processing ${file}:`, error.message);
  }
});

// Write unique questions to output file
console.log(`\nTotal unique questions: ${uniqueQuestions.size}`);
console.log(`Writing to ${outputFile}...`);

const header = 'Question;Answer;Image\n';
const rows = Array.from(uniqueQuestions.values())
  .map(q => {
    const question = q.question.includes(';') ? `"${q.question}"` : q.question;
    const answer = q.answer.includes(';') ? `"${q.answer}"` : q.answer;
    const image = q.image || '';
    return `${question};${answer};${image}`;
  })
  .join('\n');

fs.writeFileSync(outputFile, header + rows, 'utf-8');

console.log(`✓ Successfully created ${outputFile} with ${uniqueQuestions.size} unique questions!`);
