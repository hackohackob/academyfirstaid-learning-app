const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const currentDir = __dirname;
const processedDir = path.join(currentDir, 'processed-xlsx');

// Ensure processed-xlsx directory exists
if (!fs.existsSync(processedDir)) {
  fs.mkdirSync(processedDir, { recursive: true });
}

// Get all xlsx files in current directory
const files = fs.readdirSync(currentDir)
  .filter(file => file.endsWith('.xlsx') && file !== 'xlsx-to-csv.js')
  .sort();

if (files.length === 0) {
  console.log('No xlsx files found in current directory');
  process.exit(0);
}

console.log(`Found ${files.length} xlsx file(s) to convert\n`);

let converted = 0;
let errors = 0;

for (const file of files) {
  try {
    const xlsxPath = path.join(currentDir, file);
    const csvFilename = file.replace('.xlsx', '.csv');
    const csvPath = path.join(currentDir, csvFilename);
    
    // Read the xlsx file
    const workbook = XLSX.readFile(xlsxPath);
    
    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // Convert to JSON first, then format as CSV with semicolon delimiter
    // This avoids quote issues since we control the formatting
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    // Format as CSV with semicolon delimiter
    const csvLines = jsonData.map(row => {
      return row.map(cell => {
        // Convert cell to string, handle null/undefined
        const cellValue = cell == null ? '' : String(cell);
        // Escape quotes if present (double them)
        const escaped = cellValue.replace(/"/g, '""');
        // Only quote if contains semicolon, newline, or quote
        if (escaped.includes(';') || escaped.includes('\n') || escaped.includes('"')) {
          return `"${escaped}"`;
        }
        return escaped;
      }).join(';');
    });
    
    const csvWithSemicolon = csvLines.join('\n');
    
    // Write CSV file
    fs.writeFileSync(csvPath, csvWithSemicolon, 'utf8');
    console.log(`✅ Converted: ${file} -> ${csvFilename}`);
    
    // Move xlsx file to processed-xlsx folder
    const processedPath = path.join(processedDir, file);
    fs.renameSync(xlsxPath, processedPath);
    console.log(`   Moved to: processed-xlsx/${file}`);
    
    converted++;
  } catch (error) {
    console.error(`❌ Error processing ${file}:`, error.message);
    errors++;
  }
}

console.log(`\n✅ Finished! Converted ${converted} file(s), ${errors} error(s)`);
