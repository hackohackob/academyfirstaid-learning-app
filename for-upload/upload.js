const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SSH_HOST = 'hacko@hackohackob.com';
const REMOTE_DIR = '/opt/academyfirstaid/questions/';
const CURRENT_DIR = __dirname;
const PROCESSED_DIR = path.join(CURRENT_DIR, 'processed');

// Create processed directory if it doesn't exist
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

// Get all CSV files in current directory
const files = fs.readdirSync(CURRENT_DIR)
  .filter(file => file.endsWith('.csv') && file !== 'upload.js');

if (files.length === 0) {
  console.log('No CSV files found to upload.');
  process.exit(0);
}

console.log(`Found ${files.length} CSV file(s) to upload:`);
files.forEach(file => console.log(`  - ${file}`));

// Upload each file
files.forEach((file, index) => {
  const localPath = path.join(CURRENT_DIR, file);
  const remotePath = `${SSH_HOST}:${REMOTE_DIR}${file}`;
  
  try {
    console.log(`\n[${index + 1}/${files.length}] Uploading ${file}...`);
    
    // Upload file using scp
    execSync(`scp "${localPath}" "${remotePath}"`, {
      stdio: 'inherit',
      cwd: CURRENT_DIR
    });
    
    // Move file to processed folder after successful upload
    const processedPath = path.join(PROCESSED_DIR, file);
    fs.renameSync(localPath, processedPath);
    
    console.log(`✓ Successfully uploaded and moved ${file} to processed folder`);
  } catch (error) {
    console.error(`✗ Failed to upload ${file}:`, error.message);
    process.exit(1);
  }
});

console.log(`\n✓ All files uploaded successfully!`);
console.log(`Files moved to: ${PROCESSED_DIR}`);
