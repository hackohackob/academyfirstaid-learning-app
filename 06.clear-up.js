const fs = require('fs');
const path = require('path');

const folders = [
  'audios',
  'compressed',
  'compressed_chunked',
  'questions',
  'transcripts',
  'transcripts_combined',
  'videos'
];

const baseDir = __dirname;

folders.forEach(folder => {
  const folderPath = path.join(baseDir, folder);
  const processedPath = path.join(folderPath, 'processed');
  
  // Check if folder exists
  if (!fs.existsSync(folderPath)) {
    console.log(`Folder ${folder} does not exist, skipping...`);
    return;
  }
  
  // Create processed subfolder if it doesn't exist
  if (!fs.existsSync(processedPath)) {
    fs.mkdirSync(processedPath, { recursive: true });
    console.log(`Created ${processedPath}`);
  }
  
  // Read all items in the folder
  const items = fs.readdirSync(folderPath);
  
  // Filter out the 'processed' folder itself and any hidden files/folders
  const itemsToMove = items.filter(item => {
    const itemPath = path.join(folderPath, item);
    const stat = fs.statSync(itemPath);
    // Move files and directories, but skip the 'processed' folder
    return item !== 'processed' && !item.startsWith('.');
  });
  
  if (itemsToMove.length === 0) {
    console.log(`No files to move in ${folder}`);
    return;
  }
  
  console.log(`\nMoving ${itemsToMove.length} item(s) from ${folder} to processed/`);
  
  itemsToMove.forEach(item => {
    const sourcePath = path.join(folderPath, item);
    const destPath = path.join(processedPath, item);
    
    try {
      // Check if destination already exists
      if (fs.existsSync(destPath)) {
        console.log(`  ⚠️  ${item} already exists in processed/, skipping...`);
        return;
      }
      
      fs.renameSync(sourcePath, destPath);
      console.log(`  ✓ Moved ${item}`);
    } catch (error) {
      console.error(`  ✗ Error moving ${item}:`, error.message);
    }
  });
});

console.log('\nDone!');
