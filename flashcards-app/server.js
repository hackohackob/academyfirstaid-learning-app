const fs = require("fs");
const path = require("path");
const http = require("http");
const { URL } = require("url");
const { execSync } = require("child_process");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "..");
const QUESTIONS_DIR = path.join(ROOT, "questions");
const DATA_DIR = path.join(__dirname, "data");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const DB_FILE = path.join(DATA_DIR, "app.db");

logInfo("Server configuration", {
  questionsDir: QUESTIONS_DIR,
  dataDir: DATA_DIR,
  mediaDir: MEDIA_DIR,
  dbFile: DB_FILE,
});

const CATEGORY_LABELS = ["Again", "Hard", "Good", "Easy"];

// Logging utilities
function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
  if (Object.keys(data).length > 0) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

function logInfo(message, data) {
  log("info", message, data);
}

function logError(message, error) {
  const errorData = error instanceof Error ? { message: error.message, stack: error.stack } : error;
  log("error", message, errorData);
}

function logWarn(message, data) {
  log("warn", message, data);
}

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function runSql(sql) {
  ensureDataDirs();
  try {
    execSync(`sqlite3 ${shellq(DB_FILE)} "${sql.replace(/"/g, '""')}"`);
  } catch (error) {
    logError("SQL execution failed", { sql: sql.substring(0, 200), error });
    throw error;
  }
}

function runSqlBatch(statements) {
  if (!statements.length) return;
  const script = statements.join(";\n");
  runSql(script);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function randomToken() {
  return crypto.randomBytes(24).toString("hex");
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 20000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  const hashedInput = crypto.pbkdf2Sync(password, salt, 20000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(hashedInput, "hex"));
}

function runQuery(sql) {
  ensureDataDirs();
  try {
    const out = execSync(`sqlite3 -json ${shellq(DB_FILE)} "${sql.replace(/"/g, '""')}"`, { encoding: "utf8" });
    if (!out.trim()) return [];
    return JSON.parse(out);
  } catch (error) {
    logError("SQL query failed", { sql: sql.substring(0, 200), error });
    throw error;
  }
}

function shellq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function tableHasColumn(table, column) {
  const rows = runQuery(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
}

function initDb() {
  logInfo("Initializing database", { dbFile: DB_FILE });
  ensureDataDirs();
  runSql(
    `
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS decks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      filename TEXT
    );
    CREATE TABLE IF NOT EXISTS cards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      image TEXT,
      answer_image TEXT,
      UNIQUE(deck_id, question, answer),
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS progress (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_progress_user_card_time ON progress(user_id, deck_id, card_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS ratings (
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('up','down','more_info','ignore')),
      PRIMARY KEY (user_id, card_id),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    `
  );

  logInfo("Running database migrations");
  migrateProgressRatingsToCardIds();
  migrateProgressHistory();
  migrateDeckIdsToInt();
  migrateAnswerImages();
  migrateRatingsSchema();
  ensureDefaultAdmin();
  const existingDecks = getDecksFromDb();
  if (existingDecks.length === 0) {
    logInfo("No decks found, seeding from CSV");
    seedFromCsv();
  } else {
    logInfo("Syncing new CSV decks", { existingDecks: existingDecks.length });
    syncNewCsvDecks(existingDecks);
  }
  logInfo("Database initialization complete", { decks: getDecksFromDb().length });
}

function extractNumericPrefix(title) {
  // Extract numeric prefix from title (e.g., "01-Lesson" -> 1, "10-Lesson" -> 10, "14A-Lesson" -> 14)
  const match = title.match(/^0?(\d+)/);
  return match ? parseInt(match[1], 10) : 9999; // Put non-numeric titles at the end
}

function extractSuffix(title) {
  // Extract suffix after number (e.g., "14A-Lesson" -> "A", "14-Lesson" -> "")
  const match = title.match(/^0?\d+([A-Za-z])/);
  return match ? match[1].toUpperCase() : "";
}

function compareDeckTitles(a, b) {
  const numA = extractNumericPrefix(a.title);
  const numB = extractNumericPrefix(b.title);
  if (numA !== numB) {
    return numA - numB;
  }
  // If numbers are equal, sort by suffix (empty suffix comes before letters)
  const suffixA = extractSuffix(a.title);
  const suffixB = extractSuffix(b.title);
  if (!suffixA && !suffixB) return 0;
  if (!suffixA) return -1; // No suffix comes before suffix
  if (!suffixB) return 1;  // Suffix comes after no suffix
  return suffixA.localeCompare(suffixB);
}

function getDecksFromDb() {
  const rows = runQuery(`SELECT id, title, filename FROM decks ORDER BY id`);
  // Sort by numeric prefix in title (01-09, 10-99, 14A after 14, etc.)
  return rows.sort(compareDeckTitles);
}

function seedFromCsv() {
  if (!fs.existsSync(QUESTIONS_DIR)) {
    logWarn("Questions directory not found", { path: QUESTIONS_DIR });
    return;
  }
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  logInfo("Seeding decks from CSV", { fileCount: files.length });
  files.forEach((file) => {
    importCsvDeck(file);
  });
}

function syncNewCsvDecks(existingDecks = []) {
  if (!fs.existsSync(QUESTIONS_DIR)) return;
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  const knownSlugs = new Set(existingDecks.map((d) => String(d.slug || "").toLowerCase()));
  const knownFilenames = new Set(existingDecks.map((d) => String(d.filename || "").toLowerCase()));

  let importedCount = 0;
  files.forEach((file) => {
    const slug = path.basename(file, path.extname(file)).toLowerCase();
    if (knownSlugs.has(slug) || knownFilenames.has(file.toLowerCase())) return;
    importCsvDeck(file);
    importedCount++;
    knownSlugs.add(slug);
    knownFilenames.add(file.toLowerCase());
  });
  if (importedCount > 0) {
    logInfo("Imported new CSV decks", { count: importedCount });
  }
}

function importCsvDeck(file) {
  try {
    const slug = path.basename(file, path.extname(file));
    const title = slug.replace(/[-_]+/g, " ");
    logInfo("Importing CSV deck", { file, slug, title });
    runSql(`INSERT OR IGNORE INTO decks (slug, title, filename) VALUES (${q(slug)}, ${q(title)}, ${q(file)})`);
    const deckRow = runQuery(`SELECT id FROM decks WHERE slug = ${q(slug)} LIMIT 1`)[0];
    if (!deckRow) {
      logWarn("Failed to create deck", { file, slug });
      return;
    }
    const deckDbId = deckRow.id;
    const cards = parseCsvQuestions(path.join(QUESTIONS_DIR, file));
    logInfo("Parsed CSV cards", { file, cardCount: cards.length });
    const imageCache = new Map();
    const values = cards
      .map((c) => {
        const questionImage = c.imageUrl ? processImage(c.imageUrl, slug, imageCache) : null;
        const answerImage = c.answerImageUrl ? processImage(c.answerImageUrl, `${slug}-answer`, imageCache) : null;
        return `(${q(deckDbId)}, ${q(c.question)}, ${q(c.answer)}, ${questionImage ? q(questionImage) : "NULL"}, ${
          answerImage ? q(answerImage) : "NULL"
        })`;
      })
      .join(",");
    if (values) {
      runSql(`INSERT OR IGNORE INTO cards (deck_id, question, answer, image, answer_image) VALUES ${values}`);
      logInfo("Imported cards into database", { file, cardCount: cards.length });
    }
  } catch (error) {
    logError("Failed to import CSV deck", { file, error });
  }
}

function migrateProgressRatingsToCardIds() {
  const hasCardKeyProgress = tableHasColumn("progress", "card_key");
  const hasCardKeyRatings = tableHasColumn("ratings", "card_key");
  const hasUserProgress = tableHasColumn("progress", "user_id");
  const hasUserRatings = tableHasColumn("ratings", "user_id");
  if (!hasCardKeyProgress && !hasCardKeyRatings && hasUserProgress && hasUserRatings) {
    logInfo("Progress/Ratings migration not needed");
    return;
  }
  logInfo("Migrating progress/ratings to card IDs");
  const adminId = ensureDefaultAdmin();
  // Migrate progress
  if (hasCardKeyProgress) {
    runSqlBatch([
      `CREATE TABLE IF NOT EXISTS progress_new (
        user_id INTEGER NOT NULL,
        card_id INTEGER NOT NULL,
        deck_id TEXT NOT NULL,
        category TEXT NOT NULL,
        PRIMARY KEY (user_id, card_id),
        FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `INSERT OR IGNORE INTO progress_new (user_id, card_id, deck_id, category)
       SELECT ${adminId}, c.id, c.deck_id, p.category
       FROM progress p
       JOIN cards c ON (c.question || '|||' || c.answer) = p.card_key`,
      `DROP TABLE progress`,
      `ALTER TABLE progress_new RENAME TO progress`,
    ]);
  }
  if (!hasUserProgress && tableHasColumn("progress", "card_id") && tableHasColumn("progress", "category")) {
    runSqlBatch([
      `CREATE TABLE IF NOT EXISTS progress_new (
        user_id INTEGER NOT NULL,
        card_id INTEGER NOT NULL,
        deck_id TEXT NOT NULL,
        category TEXT NOT NULL,
        PRIMARY KEY (user_id, card_id),
        FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `INSERT OR IGNORE INTO progress_new (user_id, card_id, deck_id, category)
       SELECT ${adminId}, card_id, deck_id, category FROM progress`,
      `DROP TABLE progress`,
      `ALTER TABLE progress_new RENAME TO progress`,
    ]);
  }

  // Migrate ratings
  if (hasCardKeyRatings) {
    runSqlBatch([
      `CREATE TABLE IF NOT EXISTS ratings_new (
        user_id INTEGER NOT NULL,
        card_id INTEGER NOT NULL,
        deck_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('up','down','more_info','ignore')),
        PRIMARY KEY (user_id, card_id),
        FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `INSERT OR IGNORE INTO ratings_new (user_id, card_id, deck_id, rating)
       SELECT ${adminId}, c.id, c.deck_id, r.rating
       FROM ratings r
       JOIN cards c ON (c.question || '|||' || c.answer) = r.card_key`,
      `DROP TABLE ratings`,
      `ALTER TABLE ratings_new RENAME TO ratings`,
    ]);
  }
  if (!hasUserRatings && tableHasColumn("ratings", "card_id") && tableHasColumn("ratings", "rating")) {
    runSqlBatch([
      `CREATE TABLE IF NOT EXISTS ratings_new (
        user_id INTEGER NOT NULL,
        card_id INTEGER NOT NULL,
        deck_id TEXT NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('up','down','more_info','ignore')),
        PRIMARY KEY (user_id, card_id),
        FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,
      `INSERT OR IGNORE INTO ratings_new (user_id, card_id, deck_id, rating)
       SELECT ${adminId}, card_id, deck_id, rating FROM ratings`,
      `DROP TABLE ratings`,
      `ALTER TABLE ratings_new RENAME TO ratings`,
    ]);
  }
}

function migrateProgressHistory() {
  const hasCreatedAt = tableHasColumn("progress", "created_at");
  const hasId = tableHasColumn("progress", "id");
  if (hasCreatedAt && hasId) {
    runSql(`CREATE INDEX IF NOT EXISTS idx_progress_user_card_time ON progress(user_id, deck_id, card_id, created_at DESC)`);
    logInfo("Progress history migration not needed");
    return;
  }
  logInfo("Migrating progress history");
  runSqlBatch([
    `CREATE TABLE IF NOT EXISTS progress_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      deck_id TEXT NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`,
    `INSERT INTO progress_new (user_id, card_id, deck_id, category, created_at)
     SELECT user_id, card_id, deck_id, category, ${nowSeconds()} FROM progress`,
    `DROP TABLE progress`,
    `ALTER TABLE progress_new RENAME TO progress`,
    `CREATE INDEX IF NOT EXISTS idx_progress_user_card_time ON progress(user_id, deck_id, card_id, created_at DESC)`
  ]);
}

function migrateDeckIdsToInt() {
  const deckInfo = runQuery(`PRAGMA table_info(decks)`);
  const hasSlug = deckInfo.some((c) => c.name === "slug");
  const idIsInt = deckInfo.some((c) => c.name === "id" && c.type && c.type.toLowerCase().includes("int"));
  if (hasSlug && idIsInt) {
    logInfo("Deck IDs migration not needed");
    return;
  }
  logInfo("Migrating deck IDs to integer");

  const cardInfo = runQuery(`PRAGMA table_info(cards)`);
  const hasAnswerImage = cardInfo.some((c) => c.name === "answer_image");

  const hasProgressCreatedAt = tableHasColumn("progress", "created_at");

  runSqlBatch([
    `CREATE TABLE IF NOT EXISTS decks_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      filename TEXT
    )`,
    `INSERT OR IGNORE INTO decks_new (slug, title, filename)
     SELECT id, title, filename FROM decks`,

    `CREATE TABLE IF NOT EXISTS cards_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deck_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      image TEXT,
      answer_image TEXT,
      UNIQUE(deck_id, question, answer),
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    )`,
    `INSERT INTO cards_new (id, deck_id, question, answer, image, answer_image)
     SELECT c.id, d.id, c.question, c.answer, c.image, ${hasAnswerImage ? "c.answer_image" : "NULL"}
     FROM cards c
     JOIN decks_new d ON d.slug = c.deck_id`,

    `CREATE TABLE IF NOT EXISTS progress_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      category TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    )`,
    `INSERT INTO progress_new (user_id, card_id, deck_id, category, created_at)
     SELECT p.user_id, p.card_id, d.id, p.category, ${hasProgressCreatedAt ? "p.created_at" : nowSeconds()}
     FROM progress p
     JOIN decks_new d ON d.slug = p.deck_id`,
    `CREATE INDEX IF NOT EXISTS idx_progress_user_card_time ON progress_new(user_id, deck_id, card_id, created_at DESC)`,

      `CREATE TABLE IF NOT EXISTS ratings_new (
        user_id INTEGER NOT NULL,
        card_id INTEGER NOT NULL,
        deck_id INTEGER NOT NULL,
        rating TEXT NOT NULL CHECK (rating IN ('up','down','more_info','ignore')),
        PRIMARY KEY (user_id, card_id),
        FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
        FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
      )`,
    `INSERT INTO ratings_new (user_id, card_id, deck_id, rating)
     SELECT r.user_id, r.card_id, d.id, r.rating
     FROM ratings r
     JOIN decks_new d ON d.slug = r.deck_id`,

    `DROP TABLE ratings`,
    `ALTER TABLE ratings_new RENAME TO ratings`,
    `DROP TABLE progress`,
    `ALTER TABLE progress_new RENAME TO progress`,
    `DROP TABLE cards`,
    `ALTER TABLE cards_new RENAME TO cards`,
    `DROP TABLE decks`,
    `ALTER TABLE decks_new RENAME TO decks`
  ]);
}

function migrateAnswerImages() {
  if (tableHasColumn("cards", "answer_image")) {
    logInfo("Answer images migration not needed");
    return;
  }
  logInfo("Adding answer_image column to cards table");
  runSql(`ALTER TABLE cards ADD COLUMN answer_image TEXT`);
}

function migrateRatingsSchema() {
  // Check if ratings table exists and what CHECK constraint it has
  const tableInfo = runQuery(`SELECT sql FROM sqlite_master WHERE type='table' AND name='ratings'`);
  if (!tableInfo || !tableInfo[0]) {
    logInfo("Ratings table does not exist, will be created with new schema");
    return;
  }
  const sql = tableInfo[0].sql || "";
  // Check if the constraint already includes the new rating types
  if (sql.includes("'more_info'") && sql.includes("'ignore'")) {
    logInfo("Ratings schema migration not needed");
    return;
  }
  logInfo("Migrating ratings schema to support new rating types");
  runSqlBatch([
    `CREATE TABLE IF NOT EXISTS ratings_new (
      user_id INTEGER NOT NULL,
      card_id INTEGER NOT NULL,
      deck_id INTEGER NOT NULL,
      rating TEXT NOT NULL CHECK (rating IN ('up','down','more_info','ignore')),
      PRIMARY KEY (user_id, card_id),
      FOREIGN KEY(card_id) REFERENCES cards(id) ON DELETE CASCADE,
      FOREIGN KEY(deck_id) REFERENCES decks(id) ON DELETE CASCADE
    )`,
    `INSERT INTO ratings_new (user_id, card_id, deck_id, rating)
     SELECT user_id, card_id, deck_id, rating FROM ratings`,
    `DROP TABLE ratings`,
    `ALTER TABLE ratings_new RENAME TO ratings`,
  ]);
  logInfo("Ratings schema migration complete");
}

function ensureDefaultAdmin() {
  const existing = runQuery(`SELECT id FROM users WHERE email = ${q("admin@example.com")} LIMIT 1`);
  if (existing[0]) {
    logInfo("Default admin user exists", { id: existing[0].id });
    return existing[0].id;
  }
  logInfo("Creating default admin user");
  const hash = hashPassword("admin123");
  runSql(`INSERT INTO users (email, name, password_hash, is_admin) VALUES (${q("admin@example.com")}, ${q("Admin")}, ${q(hash)}, 1)`);
  const inserted = runQuery(`SELECT id FROM users WHERE email = ${q("admin@example.com")} LIMIT 1`);
  logInfo("Default admin user created", { id: inserted[0]?.id });
  return inserted[0]?.id;
}

function listDecks() {
  return getDecksFromDb();
}

function parseCsvQuestions(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw.trim()) {
      logWarn("Empty CSV file", { filePath });
      return [];
    }
    
    // Auto-detect delimiter from header row
    const firstLineEnd = raw.indexOf('\n');
    const header = firstLineEnd > 0 ? raw.substring(0, firstLineEnd) : raw.split('\r')[0];
    const delimiter = header.includes(";") ? ";" : ",";
    
    // Parse CSV properly handling multi-line quoted fields
    const rows = parseCsvWithMultiline(raw, delimiter);
    
    // Skip header row
    if (rows.length > 0) {
      rows.shift();
    }
    
    return rows
      .filter(row => row.length >= 2 && row[0] && row[1])
      .map(row => ({
        question: row[0].trim(),
        answer: row[1].trim(),
        imageUrl: (row[2] || "").trim() || null,
        answerImageUrl: (row[3] || "").trim() || null,
      }));
  } catch (error) {
    logError("Failed to parse CSV questions", { filePath, error });
    return [];
  }
}

// CSV parser that properly handles quoted fields spanning multiple lines
function parseCsvWithMultiline(raw, delimiter = ",") {
  const rows = [];
  const fields = [];
  let currentField = "";
  let inQuotes = false;
  let rowStart = true;
  
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    
    // Handle escaped quotes ("")
    if (ch === '"' && inQuotes && next === '"') {
      currentField += '"';
      i++; // Skip next quote
      continue;
    }
    
    // Toggle quote state
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    
    // Handle delimiter (only when not in quotes)
    if (ch === delimiter && !inQuotes) {
      fields.push(currentField);
      currentField = "";
      rowStart = false;
      continue;
    }
    
    // Handle newline
    if ((ch === '\n' || (ch === '\r' && next !== '\n')) && !inQuotes) {
      // End of row
      fields.push(currentField);
      if (fields.length > 0 && fields.some(f => f.trim())) {
        rows.push(fields.slice());
      }
      fields.length = 0;
      currentField = "";
      rowStart = true;
      // Skip \r\n combination
      if (ch === '\r' && next === '\n') {
        i++;
      }
      continue;
    }
    
    // Add character to current field
    currentField += ch;
  }
  
  // Handle last field/row (if file doesn't end with newline)
  if (currentField || fields.length > 0) {
    fields.push(currentField);
    if (fields.length > 0 && fields.some(f => f.trim())) {
      rows.push(fields);
    }
  }
  
  return rows;
}

// Basic CSV splitter that supports double-quoted values with commas.
function smartSplit(line, delimiter = ",") {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1];
    if (ch === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
    } else if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function getDeck(deckId) {
  const deckRow = runQuery(`SELECT id, title, filename FROM decks WHERE id = ${q(deckId)} LIMIT 1`)[0];
  if (!deckRow) return null;
  const cards = runQuery(`SELECT id, question, answer, image, answer_image FROM cards WHERE deck_id = ${q(deckId)} ORDER BY id`);
  const enriched = cards.map((c) => {
    return {
      id: c.id,
      question: c.question,
      answer: c.answer,
      image: c.image ? `/media/${c.image}` : null,
      answerImage: c.answer_image ? `/media/${c.answer_image}` : null,
      deckId: deckRow.id,
      deckTitle: deckRow.title,
    };
  });
  return { ...deckRow, cards: enriched };
}

function getProgressReport(userId) {
  const rows = runQuery(`
    WITH latest AS (
      SELECT card_id, deck_id, category
      FROM (
        SELECT card_id, deck_id, category,
               ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY created_at DESC, id DESC) AS rn
        FROM progress
        WHERE user_id = ${q(userId)}
      )
      WHERE rn = 1
    )
    SELECT d.id AS deck_id,
           d.title AS deck_title,
           COUNT(c.id) AS total_cards,
           SUM(CASE WHEN l.category = 'Again' THEN 1 ELSE 0 END) AS again_count,
           SUM(CASE WHEN l.category = 'Hard' THEN 1 ELSE 0 END) AS hard_count,
           SUM(CASE WHEN l.category = 'Good' THEN 1 ELSE 0 END) AS good_count,
           SUM(CASE WHEN l.category = 'Easy' THEN 1 ELSE 0 END) AS easy_count,
           SUM(CASE WHEN l.category IS NULL THEN 1 ELSE 0 END) AS unanswered_count
    FROM decks d
    JOIN cards c ON c.deck_id = d.id
    LEFT JOIN latest l ON l.card_id = c.id
    GROUP BY d.id, d.title
    ORDER BY d.id
  `);

  const result = rows.map((row) => ({
    deckId: row.deck_id,
    title: row.deck_title,
    totalCards: row.total_cards,
    categories: {
      Again: row.again_count,
      Hard: row.hard_count,
      Good: row.good_count,
      Easy: row.easy_count,
    },
    unanswered: row.unanswered_count,
    answered: row.total_cards - row.unanswered_count,
  }));
  
  // Sort by numeric prefix in title (01-09, 10-99, 14A after 14, etc.)
  return result.sort(compareDeckTitles);
}

function getAllUsersWithProgress() {
  const users = runQuery(`SELECT id, email, name, is_admin FROM users ORDER BY LOWER(name), LOWER(email)`);
  return users.map((user) => {
    const decks = getProgressReport(user.id);
    const totals = decks.reduce(
      (acc, deck) => {
        acc.totalCards += deck.totalCards || 0;
        acc.answered += deck.answered || 0;
        acc.unanswered += deck.unanswered || 0;
        return acc;
      },
      { totalCards: 0, answered: 0, unanswered: 0 }
    );
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isAdmin: !!user.is_admin,
      decks,
      totals,
    };
  });
}

function resetUserProgress(userId) {
  logInfo("Resetting user progress", { userId });
  runSqlBatch([
    `DELETE FROM progress WHERE user_id = ${q(userId)}`,
    `DELETE FROM ratings WHERE user_id = ${q(userId)}`,
  ]);
  logInfo("User progress reset complete", { userId });
}

function getCorsHeaders(origin) {
  const allowedOrigins = ["http://localhost:8081", "http://localhost:19006", "http://localhost:19000"];
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function sendJson(res, status, data, origin) {
  const payload = JSON.stringify(data);
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    ...getCorsHeaders(origin),
  };
  res.writeHead(status, headers);
  res.end(payload);
}

function serveStatic(req, res, pathname) {
  const publicDir = path.join(__dirname, "public");
  const mediaDir = MEDIA_DIR;
  let urlPath = (pathname || req.url.split("?")[0]).replace(/\/+$/, "") || "/";
  // Decode URL-encoded characters
  try {
    urlPath = decodeURIComponent(urlPath);
  } catch (e) {
    // If decoding fails, use original path
  }
  if (urlPath.startsWith("/media/")) {
    const filename = decodeURIComponent(urlPath.replace("/media/", ""));
    const filePath = path.join(mediaDir, filename);
    if (filePath.startsWith(mediaDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const stream = fs.createReadStream(filePath);
      res.writeHead(200, { "Content-Type": contentType(filePath) });
      stream.pipe(res);
      return true;
    }
    return false;
  }
  const filePath = urlPath === "/" ? path.join(publicDir, "index.html") : path.join(publicDir, urlPath.slice(1));

  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end();
    return true;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    stream.pipe(res);
    return true;
  }
  // Debug logging (remove after fixing)
  if (process.env.NODE_ENV !== 'production' || urlPath.includes('admin-users')) {
    console.error(`[serveStatic] File not found: ${filePath}`);
    console.error(`[serveStatic] urlPath: ${urlPath}, publicDir: ${publicDir}`);
    console.error(`[serveStatic] File exists: ${fs.existsSync(filePath)}`);
    if (fs.existsSync(filePath)) {
      console.error(`[serveStatic] Is file: ${fs.statSync(filePath).isFile()}`);
    }
  }
  return false;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js") return "application/javascript";
  if (ext === ".css") return "text/css";
  if (ext === ".json") return "application/json";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "text/plain; charset=utf-8";
}

function parseBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1e6) req.destroy();
    });
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null);
      }
    });
  });
}

function createServer() {
  return http.createServer(async (req, res) => {
    const startTime = Date.now();
    let statusCode = 200;
    
    try {
      const url = new URL(req.url, "http://localhost");
      const pathParts = url.pathname.split("/").filter(Boolean);
      const auth = getAuth(req);
      const origin = req.headers.origin;

      // Log request
      const logRequest = () => {
        const duration = Date.now() - startTime;
        const userInfo = auth.user ? `user=${auth.user.id}(${auth.user.email})` : "anonymous";
        logInfo("HTTP Request", {
          method: req.method,
          path: url.pathname,
          status: statusCode,
          duration: `${duration}ms`,
          user: userInfo,
        });
      };

      // Wrap response methods to log response
      const originalWriteHead = res.writeHead.bind(res);
      res.writeHead = function(code, ...args) {
        statusCode = code;
        return originalWriteHead(code, ...args);
      };

      const originalEnd = res.end.bind(res);
      res.end = function(...args) {
        logRequest();
        return originalEnd(...args);
      };

    if (req.method === "GET" && url.pathname === "/api/decks") {
      const decks = listDecks();
      logInfo("List decks request", { count: decks.length });
      return sendJson(res, 200, { decks }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/reports/progress") {
      if (!auth.user) {
        logWarn("Unauthorized progress report request");
        return sendJson(res, 401, { error: "Unauthorized" }, origin);
      }
      const report = getProgressReport(auth.user.id);
      logInfo("Progress report generated", { userId: auth.user.id, deckCount: report.length });
      return sendJson(res, 200, { decks: report, generatedAt: nowSeconds() }, origin);
    }

    if (req.method === "GET" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2]) {
      if (!auth.user) {
        logWarn("Unauthorized deck request", { deckId: pathParts[2] });
        return sendJson(res, 401, { error: "Unauthorized" }, origin);
      }
      const deck = getDeck(pathParts[2]);
      if (!deck) {
        logWarn("Deck not found", { deckId: pathParts[2] });
        return sendJson(res, 404, { error: "Deck not found" }, origin);
      }
      logInfo("Deck retrieved", { deckId: pathParts[2], cardCount: deck.cards.length, userId: auth.user.id });
      const progressRows = runQuery(`
        SELECT card_id, category FROM (
          SELECT card_id, category,
                 ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY created_at DESC, id DESC) AS rn
          FROM progress
          WHERE deck_id = ${q(deck.id)} AND user_id = ${q(auth.user.id)}
        ) WHERE rn = 1
      `);
      const progress = Object.fromEntries(progressRows.map((p) => [String(p.card_id), p.category]));
      const ratingRows = runQuery(`SELECT card_id, rating FROM ratings WHERE deck_id = ${q(deck.id)} AND user_id = ${q(auth.user.id)}`);
      const ratings = Object.fromEntries(ratingRows.map((r) => [String(r.card_id), r.rating]));
      
      // For admin users, include aggregate rating counts for all cards
      let ratingCounts = {};
      if (auth.user.is_admin) {
        const aggregateRatings = runQuery(`
          SELECT card_id, 
                 SUM(CASE WHEN rating = 'up' THEN 1 ELSE 0 END) as thumbs_up,
                 SUM(CASE WHEN rating = 'down' THEN 1 ELSE 0 END) as thumbs_down
          FROM ratings
          WHERE deck_id = ${q(deck.id)}
          GROUP BY card_id
        `);
        ratingCounts = Object.fromEntries(
          aggregateRatings.map((r) => [
            String(r.card_id),
            { thumbsUp: r.thumbs_up || 0, thumbsDown: r.thumbs_down || 0 }
          ])
        );
      }
      
      return sendJson(res, 200, { ...deck, progress, ratings, ratingCounts, categories: CATEGORY_LABELS }, origin);
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2] && pathParts[3] === "progress") {
      if (!auth.user) {
        logWarn("Unauthorized progress update");
        return sendJson(res, 401, { error: "Unauthorized" }, origin);
      }
      const body = await parseBody(req);
      const { cardId, category } = body || {};
      if (cardId === undefined || cardId === null) {
        logWarn("Invalid progress update - missing cardId", { body });
        return sendJson(res, 400, { error: "cardId is required" }, origin);
      }
      if (!CATEGORY_LABELS.includes(category)) {
        logWarn("Invalid progress update - invalid category", { cardId, category });
        return sendJson(res, 400, { error: "Invalid category" }, origin);
      }
      runSql(
        `INSERT INTO progress (user_id, card_id, deck_id, category) VALUES (${q(auth.user.id)}, ${q(cardId)}, ${q(pathParts[2])}, ${q(category)})`
      );
      logInfo("Progress updated", { userId: auth.user.id, deckId: pathParts[2], cardId, category });
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (
      req.method === "POST" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "decks" &&
      pathParts[3] &&
      pathParts[4] === "cards" &&
      pathParts[5] &&
      pathParts[6] === "reset-ratings"
    ) {
      if (!auth.user || !auth.user.is_admin) {
        logWarn("Unauthorized admin rating reset attempt", { userId: auth.user?.id });
        return sendJson(res, 403, { error: "Admin required" }, origin);
      }
      const deckId = pathParts[3];
      const cardId = pathParts[5];
      const deck = getDeck(deckId);
      if (!deck) {
        logWarn("Admin rating reset - deck not found", { deckId, userId: auth.user.id });
        return sendJson(res, 404, { error: "Deck not found" }, origin);
      }
      const cardExists = deck.cards.some((c) => String(c.id) === String(cardId));
      if (!cardExists) {
        logWarn("Admin rating reset - card not found", { deckId, cardId, userId: auth.user.id });
        return sendJson(res, 404, { error: "Card not found" }, origin);
      }
      logInfo("Admin resetting all ratings for card", { deckId, cardId, userId: auth.user.id });
      runSql(`DELETE FROM ratings WHERE deck_id = ${q(deckId)} AND card_id = ${q(cardId)}`);
      logInfo("All ratings reset for card", { deckId, cardId, userId: auth.user.id });
      return sendJson(res, 200, { ok: true, thumbsUp: 0, thumbsDown: 0 }, origin);
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "admin" && pathParts[2] === "decks" && pathParts[3] && pathParts.length === 4) {
      if (!auth.user || !auth.user.is_admin) {
        logWarn("Unauthorized admin deck update attempt", { userId: auth.user?.id, deckId: pathParts[3] });
        return sendJson(res, 403, { error: "Admin required" }, origin);
      }
      const deckId = pathParts[3];
      const deck = getDeck(deckId);
      if (!deck) {
        logWarn("Admin deck update - deck not found", { deckId, userId: auth.user.id });
        return sendJson(res, 404, { error: "Deck not found" }, origin);
      }
      const body = await parseBody(req);
      if (!body || !Array.isArray(body.cards)) {
        logWarn("Admin deck update - invalid body", { deckId, userId: auth.user.id });
        return sendJson(res, 400, { error: "cards array required" }, origin);
      }
      const newTitle = typeof body.title === "string" ? body.title.trim() : deck.title;
      if (!newTitle) {
        logWarn("Admin deck update - missing title", { deckId, userId: auth.user.id });
        return sendJson(res, 400, { error: "title is required" }, origin);
      }
      logInfo("Admin updating deck", { deckId, userId: auth.user.id, cardCount: body.cards.length, newTitle });

      const existing = runQuery(`SELECT id, question, answer, image, answer_image FROM cards WHERE deck_id = ${q(deckId)}`);
      const existingById = new Map(existing.map((c) => [c.id, c]));
      const existingIds = new Set(existing.map((c) => c.id));

      const rows = [];
      const insertValues = [];
      const updateStatements = [];
      const keepIds = new Set();

      for (const item of body.cards) {
        if (!item.question || !item.answer) continue;
        const question = String(item.question);
        const answer = String(item.answer);
        const existingCard = item.id ? existingById.get(item.id) : null;

        let filename = null;
        let answerFilename = null;
        if (item.imageData && typeof item.imageData === "string" && item.imageData.startsWith("data:")) {
          filename = saveDataUrl(item.imageData, deckId);
        } else if (item.imagePath && typeof item.imagePath === "string") {
          filename = path.basename(item.imagePath.replace("/media/", ""));
        } else if (item.removeImage) {
          filename = null;
        } else if (existingCard && existingCard.image) {
          filename = existingCard.image;
        }

        if (item.answerImageData && typeof item.answerImageData === "string" && item.answerImageData.startsWith("data:")) {
          answerFilename = saveDataUrl(item.answerImageData, `${deckId}-answer`);
        } else if (item.answerImagePath && typeof item.answerImagePath === "string") {
          answerFilename = path.basename(item.answerImagePath.replace("/media/", ""));
        } else if (item.removeAnswerImage) {
          answerFilename = null;
        } else if (existingCard && existingCard.answer_image) {
          answerFilename = existingCard.answer_image;
        }

        if (existingCard) {
          keepIds.add(existingCard.id);
          updateStatements.push(
            `UPDATE cards SET question=${q(question)}, answer=${q(answer)}, image=${filename ? q(filename) : "NULL"}, answer_image=${
              answerFilename ? q(answerFilename) : "NULL"
            } WHERE id=${existingCard.id}`
          );
        } else {
          insertValues.push(
            `(${q(deckId)}, ${q(question)}, ${q(answer)}, ${filename ? q(filename) : "NULL"}, ${
              answerFilename ? q(answerFilename) : "NULL"
            })`
          );
        }
        rows.push({
          question,
          answer,
          image: filename ? `/media/${filename}` : "",
          answerImage: answerFilename ? `/media/${answerFilename}` : "",
        });
      }

      const stmts = [`BEGIN`, `UPDATE decks SET title = ${q(newTitle)} WHERE id = ${q(deckId)}`];
      if (updateStatements.length) stmts.push(...updateStatements);
      if (insertValues.length)
        stmts.push(`INSERT INTO cards (deck_id, question, answer, image, answer_image) VALUES ${insertValues.join(",")}`);
      const removeIds = [...existingIds].filter((id) => !keepIds.has(id));
      if (removeIds.length) {
        stmts.push(`DELETE FROM cards WHERE deck_id = ${q(deckId)} AND id IN (${removeIds.join(",")})`);
      }
      stmts.push(`DELETE FROM progress WHERE deck_id = ${q(deckId)} AND card_id NOT IN (SELECT id FROM cards WHERE deck_id=${q(deckId)})`);
      stmts.push(`DELETE FROM ratings WHERE deck_id = ${q(deckId)} AND card_id NOT IN (SELECT id FROM cards WHERE deck_id=${q(deckId)})`);
      stmts.push(`COMMIT`);
      runSqlBatch(stmts);

      writeDeckCsv(deckId, rows, deck.filename);
      cleanupUnusedMedia();
      logInfo("Admin deck update complete", { deckId, userId: auth.user.id, cardCount: rows.length });
      return sendJson(res, 200, { ok: true, title: newTitle }, origin);
    }

    if (
      req.method === "DELETE" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "decks" &&
      pathParts[3]
    ) {
      if (!auth.user || !auth.user.is_admin) {
        logWarn("Unauthorized admin deck deletion attempt", { userId: auth.user?.id, deckId: pathParts[3] });
        return sendJson(res, 403, { error: "Admin required" }, origin);
      }
      const deckId = pathParts[3];
      const deck = runQuery(`SELECT id, filename FROM decks WHERE id = ${q(deckId)} LIMIT 1`)[0];
      if (!deck) {
        logWarn("Admin deck deletion - deck not found", { deckId, userId: auth.user.id });
        return sendJson(res, 404, { error: "Deck not found" }, origin);
      }
      logInfo("Admin deleting deck", { deckId, userId: auth.user.id, filename: deck.filename });
      const statements = [
        "BEGIN",
        `DELETE FROM progress WHERE deck_id = ${q(deckId)}`,
        `DELETE FROM ratings WHERE deck_id = ${q(deckId)}`,
        `DELETE FROM cards WHERE deck_id = ${q(deckId)}`,
        `DELETE FROM decks WHERE id = ${q(deckId)}`,
        "COMMIT",
      ];
      runSqlBatch(statements);
      if (deck.filename) {
        const csvPath = path.join(QUESTIONS_DIR, deck.filename);
        if (fs.existsSync(csvPath)) {
          fs.unlinkSync(csvPath);
          logInfo("Deleted CSV file", { path: csvPath });
        }
      }
      cleanupUnusedMedia();
      logInfo("Admin deck deletion complete", { deckId, userId: auth.user.id });
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (
      req.method === "GET" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "users" &&
      pathParts.length === 3
    ) {
      if (!auth.user || !auth.user.is_admin) {
        logWarn("Unauthorized admin users list request", { userId: auth.user?.id });
        return sendJson(res, 403, { error: "Admin required" }, origin);
      }
      const users = getAllUsersWithProgress();
      logInfo("Admin users list requested", { userId: auth.user.id, userCount: users.length });
      return sendJson(res, 200, { users }, origin);
    }

    if (
      req.method === "POST" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "users" &&
      pathParts[3] &&
      pathParts[4] === "reset"
    ) {
      if (!auth.user || !auth.user.is_admin) {
        logWarn("Unauthorized admin user reset attempt", { userId: auth.user?.id, targetUserId: pathParts[3] });
        return sendJson(res, 403, { error: "Admin required" }, origin);
      }
      const userId = pathParts[3];
      const exists = runQuery(`SELECT id FROM users WHERE id = ${q(userId)} LIMIT 1`)[0];
      if (!exists) {
        logWarn("Admin user reset - user not found", { targetUserId: userId, adminUserId: auth.user.id });
        return sendJson(res, 404, { error: "User not found" }, origin);
      }
      logInfo("Admin resetting user progress", { targetUserId: userId, adminUserId: auth.user.id });
      resetUserProgress(userId);
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (
      req.method === "DELETE" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "users" &&
      pathParts[3]
    ) {
      if (!auth.user || !auth.user.is_admin) {
        logWarn("Unauthorized admin user deletion attempt", { userId: auth.user?.id, targetUserId: pathParts[3] });
        return sendJson(res, 403, { error: "Admin required" }, origin);
      }
      const userId = pathParts[3];
      const user = runQuery(`SELECT id, email, name FROM users WHERE id = ${q(userId)} LIMIT 1`)[0];
      if (!user) {
        logWarn("Admin user deletion - user not found", { targetUserId: userId, adminUserId: auth.user.id });
        return sendJson(res, 404, { error: "User not found" }, origin);
      }
      // Prevent deleting yourself
      if (parseInt(userId) === auth.user.id) {
        logWarn("Admin attempted to delete own account", { userId: auth.user.id });
        return sendJson(res, 400, { error: "Cannot delete your own account" }, origin);
      }
      logInfo("Admin deleting user", { targetUserId: userId, targetEmail: user.email, adminUserId: auth.user.id });
      // Delete user (cascades to progress, ratings, and sessions via foreign keys)
      runSql(`DELETE FROM users WHERE id = ${q(userId)}`);
      logInfo("Admin user deletion complete", { targetUserId: userId, adminUserId: auth.user.id });
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2] && pathParts[3] === "rating") {
      if (!auth.user) {
        logWarn("Unauthorized rating update");
        return sendJson(res, 401, { error: "Unauthorized" }, origin);
      }
      const deckId = pathParts[2];
      const body = await parseBody(req);
      const { cardId, rating } = body || {};
      if (cardId === undefined || cardId === null) {
        logWarn("Invalid rating update - missing cardId", { body });
        return sendJson(res, 400, { error: "cardId is required" }, origin);
      }
      if (rating !== "up" && rating !== "down" && rating !== "more_info" && rating !== "ignore" && rating !== null) {
        logWarn("Invalid rating update - invalid rating", { cardId, rating });
        return sendJson(res, 400, { error: "rating must be up, down, more_info, ignore, or null" }, origin);
      }
      if (rating === null) {
        runSql(`DELETE FROM ratings WHERE user_id = ${q(auth.user.id)} AND card_id = ${q(cardId)} AND deck_id = ${q(deckId)}`);
        logInfo("Rating removed", { userId: auth.user.id, deckId, cardId });
      } else {
        runSql(
          `INSERT OR REPLACE INTO ratings (user_id, card_id, deck_id, rating) VALUES (${q(auth.user.id)}, ${q(cardId)}, ${q(deckId)}, ${q(rating)})`
        );
        logInfo("Rating updated", { userId: auth.user.id, deckId, cardId, rating });
      }
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      const body = await parseBody(req);
      const { email, name, password } = body || {};
      if (!email || !name || !password) {
        logWarn("Registration attempt with missing fields", { hasEmail: !!email, hasName: !!name, hasPassword: !!password });
        return sendJson(res, 400, { error: "email, name, password required" }, origin);
      }
      const exists = runQuery(`SELECT id FROM users WHERE email = ${q(email)} LIMIT 1`);
      if (exists[0]) {
        logWarn("Registration attempt with existing email", { email });
        return sendJson(res, 400, { error: "Email already registered" }, origin);
      }
      logInfo("User registration", { email, name });
      const hash = hashPassword(password);
      runSql(`INSERT INTO users (email, name, password_hash, is_admin) VALUES (${q(email)}, ${q(name)}, ${q(hash)}, 0)`);
      const user = runQuery(`SELECT id, email, name, is_admin FROM users WHERE email = ${q(email)} LIMIT 1`)[0];
      const token = createSession(user.id);
      setSessionCookie(res, token);
      logInfo("User registered successfully", { userId: user.id, email });
      return sendJson(res, 200, { user }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await parseBody(req);
      const { email, password } = body || {};
      if (!email || !password) {
        logWarn("Login attempt with missing credentials", { hasEmail: !!email, hasPassword: !!password });
        return sendJson(res, 400, { error: "email and password required" }, origin);
      }
      const user = runQuery(`SELECT id, email, name, is_admin, password_hash FROM users WHERE email = ${q(email)} LIMIT 1`)[0];
      if (!user || !verifyPassword(password, user.password_hash)) {
        logWarn("Failed login attempt", { email });
        return sendJson(res, 401, { error: "Invalid credentials" }, origin);
      }
      const token = createSession(user.id);
      setSessionCookie(res, token);
      delete user.password_hash;
      logInfo("User logged in", { userId: user.id, email, isAdmin: !!user.is_admin });
      return sendJson(res, 200, { user }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const cookies = parseCookies(req);
      if (cookies.session) {
        const session = runQuery(`SELECT user_id FROM sessions WHERE token = ${q(cookies.session)} LIMIT 1`)[0];
        runSql(`DELETE FROM sessions WHERE token = ${q(cookies.session)}`);
        if (session) {
          logInfo("User logged out", { userId: session.user_id });
        }
      }
      const headers = {
        "Set-Cookie": clearSessionCookie(),
        ...getCorsHeaders(origin),
      };
      res.writeHead(204, headers).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      if (!auth.user) {
        logWarn("Unauthorized /api/me request");
        return sendJson(res, 401, { error: "Unauthorized" }, origin);
      }
      return sendJson(res, 200, { user: auth.user }, origin);
    }

    if (req.method === "OPTIONS") {
      const origin = req.headers.origin;
      res.writeHead(204, getCorsHeaders(origin));
      res.end();
      return;
    }

      if (serveStatic(req, res, url.pathname)) return;
      statusCode = 404;
      res.writeHead(404).end("Not found");
    } catch (error) {
      statusCode = 500;
      logError("Request handler error", { 
        method: req.method, 
        url: req.url, 
        error 
      });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(";").reduce((acc, part) => {
    const [k, ...rest] = part.trim().split("=");
    acc[k] = rest.join("=");
    return acc;
  }, {});
}

function getAuth(req) {
  const cookies = parseCookies(req);
  const token = cookies.session;
  if (!token) return { user: null };
  const session = runQuery(`SELECT user_id, expires_at FROM sessions WHERE token = ${q(token)} LIMIT 1`)[0];
  if (!session) return { user: null };
  if (session.expires_at < nowSeconds()) {
    logInfo("Expired session deleted", { userId: session.user_id });
    runSql(`DELETE FROM sessions WHERE token = ${q(token)}`);
    return { user: null };
  }
  const user = runQuery(`SELECT id, email, name, is_admin FROM users WHERE id = ${q(session.user_id)} LIMIT 1`)[0];
  if (!user) {
    logWarn("Session exists but user not found", { userId: session.user_id });
    return { user: null };
  }
  return { user, token };
}

function createSession(userId) {
  const token = randomToken();
  const expires = nowSeconds() + 60 * 60 * 24 * 30; // 30 days
  runSql(`INSERT INTO sessions (token, user_id, expires_at) VALUES (${q(token)}, ${q(userId)}, ${expires})`);
  logInfo("Session created", { userId, expires });
  return token;
}

function setSessionCookie(res, token) {
  const expires = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toUTCString();
  res.setHeader("Set-Cookie", `session=${token}; HttpOnly; Path=/; SameSite=Lax; Expires=${expires}`);
}

function clearSessionCookie() {
  return `session=; HttpOnly; Path=/; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

function writeDeckCsv(deckId, rows, filename) {
  if (!filename) {
    logWarn("Cannot write CSV - no filename", { deckId });
    return;
  }
  try {
    const filePath = path.join(QUESTIONS_DIR, filename);
    const lines = ["Въпрос;Отговор;Изображение;Изображение на отговор"];
    for (const r of rows) {
      lines.push(
        `${escapeCsv(r.question)};${escapeCsv(r.answer)};${escapeCsv(r.image || "")};${escapeCsv(r.answerImage || "")}`
      );
    }
    fs.writeFileSync(filePath, lines.join("\n"), "utf8");
    logInfo("CSV file written", { deckId, filename, rowCount: rows.length });
  } catch (error) {
    logError("Failed to write CSV file", { deckId, filename, error });
  }
}

function escapeCsv(value) {
  const needsQuotes = /[;"\n]/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function saveDataUrl(dataUrl, deckId) {
  ensureDataDirs();
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) {
    logError("Invalid image data URL format", { deckId });
    throw new Error("Invalid image data");
  }
  const mime = match[1];
  const ext = mimeToExt(mime);
  const buffer = Buffer.from(match[2], "base64");
  const filename = `${deckId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  try {
    fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
    logInfo("Image saved from data URL", { deckId, filename, size: buffer.length });
    return filename;
  } catch (error) {
    logError("Failed to save image from data URL", { deckId, filename, error });
    throw error;
  }
}

function mimeToExt(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
}

function processImage(imageData, deckSlug, cache = new Map()) {
  const trimmed = (imageData || "").trim();
  if (!trimmed) return null;
  
  // Check if it's a base64 data URI
  if (trimmed.startsWith("data:image/")) {
    if (cache.has(trimmed)) return cache.get(trimmed);
    try {
      const filename = saveDataUrl(trimmed, deckSlug);
      cache.set(trimmed, filename);
      return filename;
    } catch (error) {
      console.error(`Error saving base64 image: ${error.message}`);
      cache.set(trimmed, null);
      return null;
    }
  }
  
  // Otherwise, treat it as a URL
  return downloadImageFromUrl(trimmed, deckSlug, cache);
}

function downloadImageFromUrl(url, deckSlug, cache = new Map()) {
  const trimmed = (url || "").trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;
  if (cache.has(trimmed)) return cache.get(trimmed);

  ensureDataDirs();
  let ext = "";
  try {
    const parsed = new URL(trimmed);
    ext = path.extname(parsed.pathname).replace(".", "").toLowerCase();
  } catch {
    ext = "";
  }
  const safeExt = ext && ext.length <= 5 ? ext : "jpg";
  const filename = `${deckSlug || "deck"}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`;
  const filePath = path.join(MEDIA_DIR, filename);

  try {
    logInfo("Downloading image from URL", { url: trimmed, filename });
    execSync(`curl -L --silent --show-error ${shellq(trimmed)} -o ${shellq(filePath)}`);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      logWarn("Downloaded image is empty or missing", { url: trimmed, filename });
      cache.set(trimmed, null);
      return null;
    }
    const size = fs.statSync(filePath).size;
    logInfo("Image downloaded successfully", { url: trimmed, filename, size });
    cache.set(trimmed, filename);
    return filename;
  } catch (error) {
    logError("Failed to download image", { url: trimmed, filename, error });
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    cache.set(trimmed, null);
    return null;
  }
}

function cleanupUnusedMedia() {
  try {
    const rows = runQuery("SELECT image, answer_image FROM cards WHERE image IS NOT NULL OR answer_image IS NOT NULL");
    const used = new Set();
    rows.forEach((row) => {
      if (row.image) used.add(row.image);
      if (row.answer_image) used.add(row.answer_image);
    });
    const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
    let deletedCount = 0;
    files.forEach((file) => {
      if (!used.has(file)) {
        const filePath = path.join(MEDIA_DIR, file);
        try {
          fs.unlinkSync(filePath);
          deletedCount++;
        } catch (error) {
          logError("Failed to delete unused media file", { file, error });
        }
      }
    });
    if (deletedCount > 0) {
      logInfo("Cleaned up unused media files", { deletedCount, totalFiles: files.length });
    }
  } catch (error) {
    logError("Failed to cleanup unused media", { error });
  }
}

initDb();

if (require.main === module) {
  const server = createServer();
  const port = process.env.PORT || 3106;
  server.listen(port, () => {
    logInfo("Flashcards server started", { port, nodeEnv: process.env.NODE_ENV || "development" });
  });

  // Log uncaught errors
  process.on("uncaughtException", (error) => {
    logError("Uncaught exception", error);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason, promise) => {
    logError("Unhandled rejection", { reason, promise });
  });
}

module.exports = { createServer };
