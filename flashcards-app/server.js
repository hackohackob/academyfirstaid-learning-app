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

const CATEGORY_LABELS = ["Again", "Hard", "Good", "Easy"];

function ensureDataDirs() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

function runSql(sql) {
  ensureDataDirs();
  execSync(`sqlite3 ${shellq(DB_FILE)} "${sql.replace(/"/g, '""')}"`);
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
  const out = execSync(`sqlite3 -json ${shellq(DB_FILE)} "${sql.replace(/"/g, '""')}"`, { encoding: "utf8" });
  if (!out.trim()) return [];
  return JSON.parse(out);
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
      rating TEXT NOT NULL CHECK (rating IN ('up','down')),
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

  migrateProgressRatingsToCardIds();
  migrateProgressHistory();
  migrateDeckIdsToInt();
  migrateAnswerImages();
  ensureDefaultAdmin();
  const existingDecks = getDecksFromDb();
  if (existingDecks.length === 0) {
    seedFromCsv();
  } else {
    syncNewCsvDecks(existingDecks);
  }
}

function getDecksFromDb() {
  const rows = runQuery(`SELECT id, title, filename FROM decks ORDER BY id`);
  return rows;
}

function seedFromCsv() {
  if (!fs.existsSync(QUESTIONS_DIR)) return;
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  files.forEach((file) => {
    importCsvDeck(file);
  });
}

function syncNewCsvDecks(existingDecks = []) {
  if (!fs.existsSync(QUESTIONS_DIR)) return;
  const files = fs.readdirSync(QUESTIONS_DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  const knownSlugs = new Set(existingDecks.map((d) => String(d.slug || "").toLowerCase()));
  const knownFilenames = new Set(existingDecks.map((d) => String(d.filename || "").toLowerCase()));

  files.forEach((file) => {
    const slug = path.basename(file, path.extname(file)).toLowerCase();
    if (knownSlugs.has(slug) || knownFilenames.has(file.toLowerCase())) return;
    importCsvDeck(file);
    knownSlugs.add(slug);
    knownFilenames.add(file.toLowerCase());
  });
}

function importCsvDeck(file) {
  const slug = path.basename(file, path.extname(file));
  const title = slug.replace(/[-_]+/g, " ");
  runSql(`INSERT OR IGNORE INTO decks (slug, title, filename) VALUES (${q(slug)}, ${q(title)}, ${q(file)})`);
  const deckRow = runQuery(`SELECT id FROM decks WHERE slug = ${q(slug)} LIMIT 1`)[0];
  if (!deckRow) return;
  const deckDbId = deckRow.id;
  const cards = parseCsvQuestions(path.join(QUESTIONS_DIR, file));
  const imageCache = new Map();
  const values = cards
    .map((c) => {
      const questionImage = c.imageUrl ? downloadImageFromUrl(c.imageUrl, slug, imageCache) : null;
      const answerImage = c.answerImageUrl ? downloadImageFromUrl(c.answerImageUrl, `${slug}-answer`, imageCache) : null;
      return `(${q(deckDbId)}, ${q(c.question)}, ${q(c.answer)}, ${questionImage ? q(questionImage) : "NULL"}, ${
        answerImage ? q(answerImage) : "NULL"
      })`;
    })
    .join(",");
  if (values) {
    runSql(`INSERT OR IGNORE INTO cards (deck_id, question, answer, image, answer_image) VALUES ${values}`);
  }
}

function migrateProgressRatingsToCardIds() {
  const hasCardKeyProgress = tableHasColumn("progress", "card_key");
  const hasCardKeyRatings = tableHasColumn("ratings", "card_key");
  const hasUserProgress = tableHasColumn("progress", "user_id");
  const hasUserRatings = tableHasColumn("ratings", "user_id");
  if (!hasCardKeyProgress && !hasCardKeyRatings && hasUserProgress && hasUserRatings) return;
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
        rating TEXT NOT NULL CHECK (rating IN ('up','down')),
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
        rating TEXT NOT NULL CHECK (rating IN ('up','down')),
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
    return;
  }
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
  if (hasSlug && idIsInt) return;

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
      rating TEXT NOT NULL CHECK (rating IN ('up','down')),
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
  if (tableHasColumn("cards", "answer_image")) return;
  runSql(`ALTER TABLE cards ADD COLUMN answer_image TEXT`);
}

function ensureDefaultAdmin() {
  const existing = runQuery(`SELECT id FROM users WHERE email = ${q("admin@example.com")} LIMIT 1`);
  if (existing[0]) return existing[0].id;
  const hash = hashPassword("admin123");
  runSql(`INSERT INTO users (email, name, password_hash, is_admin) VALUES (${q("admin@example.com")}, ${q("Admin")}, ${q(hash)}, 1)`);
  const inserted = runQuery(`SELECT id FROM users WHERE email = ${q("admin@example.com")} LIMIT 1`);
  return inserted[0]?.id;
}

function listDecks() {
  return getDecksFromDb();
}

function parseCsvQuestions(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const lines = raw.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  
  // Auto-detect delimiter from header row
  const header = lines[0];
  const delimiter = header.includes(";") ? ";" : ",";
  
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = smartSplit(lines[i], delimiter);
    if (cols.length < 2) continue;
    rows.push({
      question: cols[0].trim(),
      answer: cols[1].trim(),
      imageUrl: (cols[2] || "").trim() || null,
      answerImageUrl: (cols[3] || "").trim() || null,
    });
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

  return rows.map((row) => ({
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
  runSqlBatch([
    `DELETE FROM progress WHERE user_id = ${q(userId)}`,
    `DELETE FROM ratings WHERE user_id = ${q(userId)}`,
  ]);
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

function serveStatic(req, res) {
  const publicDir = path.join(__dirname, "public");
  const mediaDir = MEDIA_DIR;
  const urlPath = req.url.split("?")[0].replace(/\/+$/, "") || "/";
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
    const url = new URL(req.url, "http://localhost");
    const pathParts = url.pathname.split("/").filter(Boolean);
    const auth = getAuth(req);
    const origin = req.headers.origin;

    if (req.method === "GET" && url.pathname === "/api/decks") {
      return sendJson(res, 200, { decks: listDecks() }, origin);
    }

    if (req.method === "GET" && url.pathname === "/api/reports/progress") {
      if (!auth.user) return sendJson(res, 401, { error: "Unauthorized" }, origin);
      const report = getProgressReport(auth.user.id);
      return sendJson(res, 200, { decks: report, generatedAt: nowSeconds() }, origin);
    }

    if (req.method === "GET" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2]) {
      if (!auth.user) return sendJson(res, 401, { error: "Unauthorized" }, origin);
      const deck = getDeck(pathParts[2]);
      if (!deck) return sendJson(res, 404, { error: "Deck not found" }, origin);
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
      return sendJson(res, 200, { ...deck, progress, ratings, categories: CATEGORY_LABELS }, origin);
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2] && pathParts[3] === "progress") {
      if (!auth.user) return sendJson(res, 401, { error: "Unauthorized" }, origin);
      const body = await parseBody(req);
      const { cardId, category } = body || {};
      if (cardId === undefined || cardId === null) return sendJson(res, 400, { error: "cardId is required" }, origin);
      if (!CATEGORY_LABELS.includes(category)) return sendJson(res, 400, { error: "Invalid category" }, origin);
      runSql(
        `INSERT INTO progress (user_id, card_id, deck_id, category) VALUES (${q(auth.user.id)}, ${q(cardId)}, ${q(pathParts[2])}, ${q(category)})`
      );
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "admin" && pathParts[2] === "decks" && pathParts[3]) {
      if (!auth.user || !auth.user.is_admin) return sendJson(res, 403, { error: "Admin required" }, origin);
      const deckId = pathParts[3];
      const deck = getDeck(deckId);
      if (!deck) return sendJson(res, 404, { error: "Deck not found" }, origin);
      const body = await parseBody(req);
      if (!body || !Array.isArray(body.cards)) return sendJson(res, 400, { error: "cards array required" }, origin);
      const newTitle = typeof body.title === "string" ? body.title.trim() : deck.title;
      if (!newTitle) return sendJson(res, 400, { error: "title is required" }, origin);

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
      return sendJson(res, 200, { ok: true, title: newTitle }, origin);
    }

    if (
      req.method === "DELETE" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "decks" &&
      pathParts[3]
    ) {
      if (!auth.user || !auth.user.is_admin) return sendJson(res, 403, { error: "Admin required" }, origin);
      const deckId = pathParts[3];
      const deck = runQuery(`SELECT id, filename FROM decks WHERE id = ${q(deckId)} LIMIT 1`)[0];
      if (!deck) return sendJson(res, 404, { error: "Deck not found" }, origin);
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
        if (fs.existsSync(csvPath)) fs.unlinkSync(csvPath);
      }
      cleanupUnusedMedia();
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (
      req.method === "GET" &&
      pathParts[0] === "api" &&
      pathParts[1] === "admin" &&
      pathParts[2] === "users" &&
      pathParts.length === 3
    ) {
      if (!auth.user || !auth.user.is_admin) return sendJson(res, 403, { error: "Admin required" }, origin);
      const users = getAllUsersWithProgress();
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
      if (!auth.user || !auth.user.is_admin) return sendJson(res, 403, { error: "Admin required" }, origin);
      const userId = pathParts[3];
      const exists = runQuery(`SELECT id FROM users WHERE id = ${q(userId)} LIMIT 1`)[0];
      if (!exists) return sendJson(res, 404, { error: "User not found" }, origin);
      resetUserProgress(userId);
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (req.method === "POST" && pathParts[0] === "api" && pathParts[1] === "decks" && pathParts[2] && pathParts[3] === "rating") {
      if (!auth.user) return sendJson(res, 401, { error: "Unauthorized" }, origin);
      const deckId = pathParts[2];
      const body = await parseBody(req);
      const { cardId, rating } = body || {};
      if (cardId === undefined || cardId === null) return sendJson(res, 400, { error: "cardId is required" }, origin);
      if (rating !== "up" && rating !== "down" && rating !== null) return sendJson(res, 400, { error: "rating must be up, down, or null" }, origin);
      if (rating === null) {
        runSql(`DELETE FROM ratings WHERE user_id = ${q(auth.user.id)} AND card_id = ${q(cardId)} AND deck_id = ${q(deckId)}`);
      } else {
        runSql(
          `INSERT OR REPLACE INTO ratings (user_id, card_id, deck_id, rating) VALUES (${q(auth.user.id)}, ${q(cardId)}, ${q(deckId)}, ${q(rating)})`
        );
      }
      return sendJson(res, 200, { ok: true }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      const body = await parseBody(req);
      const { email, name, password } = body || {};
      if (!email || !name || !password) return sendJson(res, 400, { error: "email, name, password required" }, origin);
      const exists = runQuery(`SELECT id FROM users WHERE email = ${q(email)} LIMIT 1`);
      if (exists[0]) return sendJson(res, 400, { error: "Email already registered" }, origin);
      const hash = hashPassword(password);
      runSql(`INSERT INTO users (email, name, password_hash, is_admin) VALUES (${q(email)}, ${q(name)}, ${q(hash)}, 0)`);
      const user = runQuery(`SELECT id, email, name, is_admin FROM users WHERE email = ${q(email)} LIMIT 1`)[0];
      const token = createSession(user.id);
      setSessionCookie(res, token);
      return sendJson(res, 200, { user }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await parseBody(req);
      const { email, password } = body || {};
      if (!email || !password) return sendJson(res, 400, { error: "email and password required" }, origin);
      const user = runQuery(`SELECT id, email, name, is_admin, password_hash FROM users WHERE email = ${q(email)} LIMIT 1`)[0];
      if (!user || !verifyPassword(password, user.password_hash)) return sendJson(res, 401, { error: "Invalid credentials" }, origin);
      const token = createSession(user.id);
      setSessionCookie(res, token);
      delete user.password_hash;
      return sendJson(res, 200, { user }, origin);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      const cookies = parseCookies(req);
      if (cookies.session) runSql(`DELETE FROM sessions WHERE token = ${q(cookies.session)}`);
      const headers = {
        "Set-Cookie": clearSessionCookie(),
        ...getCorsHeaders(origin),
      };
      res.writeHead(204, headers).end();
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/me") {
      if (!auth.user) return sendJson(res, 401, { error: "Unauthorized" }, origin);
      return sendJson(res, 200, { user: auth.user }, origin);
    }

    if (req.method === "OPTIONS") {
      const origin = req.headers.origin;
      res.writeHead(204, getCorsHeaders(origin));
      res.end();
      return;
    }

    if (serveStatic(req, res)) return;
    res.writeHead(404).end("Not found");
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
    runSql(`DELETE FROM sessions WHERE token = ${q(token)}`);
    return { user: null };
  }
  const user = runQuery(`SELECT id, email, name, is_admin FROM users WHERE id = ${q(session.user_id)} LIMIT 1`)[0];
  if (!user) return { user: null };
  return { user, token };
}

function createSession(userId) {
  const token = randomToken();
  const expires = nowSeconds() + 60 * 60 * 24 * 30; // 30 days
  runSql(`INSERT INTO sessions (token, user_id, expires_at) VALUES (${q(token)}, ${q(userId)}, ${expires})`);
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
  if (!filename) return;
  const filePath = path.join(QUESTIONS_DIR, filename);
  const lines = ["Въпрос;Отговор;Изображение;Изображение на отговор"];
  for (const r of rows) {
    lines.push(
      `${escapeCsv(r.question)};${escapeCsv(r.answer)};${escapeCsv(r.image || "")};${escapeCsv(r.answerImage || "")}`
    );
  }
  fs.writeFileSync(filePath, lines.join("\n"), "utf8");
}

function escapeCsv(value) {
  const needsQuotes = /[;"\n]/.test(value);
  if (!needsQuotes) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function saveDataUrl(dataUrl, deckId) {
  const match = /^data:([a-zA-Z0-9/+.-]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid image data");
  const mime = match[1];
  const ext = mimeToExt(mime);
  const buffer = Buffer.from(match[2], "base64");
  const filename = `${deckId}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, filename), buffer);
  return filename;
}

function mimeToExt(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/webp") return "webp";
  return "bin";
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
    execSync(`curl -L --silent --show-error ${shellq(trimmed)} -o ${shellq(filePath)}`);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      cache.set(trimmed, null);
      return null;
    }
    cache.set(trimmed, filename);
    return filename;
  } catch {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    cache.set(trimmed, null);
    return null;
  }
}

function cleanupUnusedMedia() {
  const rows = runQuery("SELECT image, answer_image FROM cards WHERE image IS NOT NULL OR answer_image IS NOT NULL");
  const used = new Set();
  rows.forEach((row) => {
    if (row.image) used.add(row.image);
    if (row.answer_image) used.add(row.answer_image);
  });
  const files = fs.existsSync(MEDIA_DIR) ? fs.readdirSync(MEDIA_DIR) : [];
  files.forEach((file) => {
    if (!used.has(file)) {
      const filePath = path.join(MEDIA_DIR, file);
      fs.unlinkSync(filePath);
    }
  });
}

initDb();

if (require.main === module) {
  const server = createServer();
  const port = process.env.PORT || 3000;
  server.listen(port, () => {
    console.log(`Flashcards server running on http://localhost:${port}`);
  });
}

module.exports = { createServer };
