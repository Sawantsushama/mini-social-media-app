const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcryptjs");
const session = require("express-session");
const cors = require("cors");

const app = express();
const PORT = 3000;
const db = new sqlite3.Database("./social.db");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(session({
  secret: "mini-social-demo-secret-change-this",
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 }
}));
app.use(express.static("public"));

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    bio TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(post_id) REFERENCES posts(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS likes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    UNIQUE(user_id, post_id),
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(post_id) REFERENCES posts(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS followers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    follower_id INTEGER NOT NULL,
    following_id INTEGER NOT NULL,
    UNIQUE(follower_id, following_id),
    FOREIGN KEY(follower_id) REFERENCES users(id),
    FOREIGN KEY(following_id) REFERENCES users(id)
  )`);
});

function auth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Please login first" });
  next();
}

function all(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows))
  );
}

function get(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row))
  );
}

function run(sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve({ id: this.lastID, changes: this.changes });
    })
  );
}

app.post("/api/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "All fields are required" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    const hash = await bcrypt.hash(password, 10);
    const result = await run(
      "INSERT INTO users (username,email,password) VALUES (?,?,?)",
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    req.session.userId = result.id;
    res.json({ message: "Account created" });
  } catch (e) {
    res.status(400).json({ error: "Username or email already exists" });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await get("SELECT * FROM users WHERE email = ?", [email.trim().toLowerCase()]);
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Invalid email or password" });
    req.session.userId = user.id;
    res.json({ message: "Logged in" });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Logged out" }));
});

app.get("/api/me", auth, async (req, res) => {
  const user = await get(`
    SELECT id, username, email, bio, created_at,
      (SELECT COUNT(*) FROM followers WHERE following_id=users.id) AS followers,
      (SELECT COUNT(*) FROM followers WHERE follower_id=users.id) AS following
    FROM users WHERE id=?`, [req.session.userId]);
  res.json(user);
});

app.put("/api/me", auth, async (req, res) => {
  const bio = (req.body.bio || "").slice(0, 250);
  await run("UPDATE users SET bio=? WHERE id=?", [bio, req.session.userId]);
  res.json({ message: "Profile updated" });
});

app.get("/api/users", auth, async (req, res) => {
  const users = await all(`
    SELECT id, username, bio,
      (SELECT COUNT(*) FROM followers WHERE following_id=users.id) AS followers,
      EXISTS(
        SELECT 1 FROM followers f
        WHERE f.follower_id=? AND f.following_id=users.id
      ) AS is_following
    FROM users
    WHERE id != ?
    ORDER BY username`, [req.session.userId, req.session.userId]);
  res.json(users);
});

app.get("/api/posts", auth, async (req, res) => {
  const posts = await all(`
    SELECT p.id, p.content, p.created_at, u.id AS user_id, u.username,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes,
      EXISTS(
        SELECT 1 FROM likes l WHERE l.post_id=p.id AND l.user_id=?
      ) AS liked
    FROM posts p
    JOIN users u ON u.id=p.user_id
    ORDER BY p.created_at DESC`, [req.session.userId]);

  for (const p of posts) {
    p.comments = await all(`
      SELECT c.id, c.content, c.created_at, u.username
      FROM comments c JOIN users u ON u.id=c.user_id
      WHERE c.post_id=? ORDER BY c.created_at ASC`, [p.id]);
  }
  res.json(posts);
});

app.post("/api/posts", auth, async (req, res) => {
  const content = (req.body.content || "").trim();
  if (!content) return res.status(400).json({ error: "Post cannot be empty" });
  if (content.length > 500) return res.status(400).json({ error: "Post is too long" });
  await run("INSERT INTO posts(user_id,content) VALUES(?,?)", [req.session.userId, content]);
  res.json({ message: "Post created" });
});

app.delete("/api/posts/:id", auth, async (req, res) => {
  await run("DELETE FROM likes WHERE post_id=? AND EXISTS(SELECT 1 FROM posts WHERE id=? AND user_id=?)",
    [req.params.id, req.params.id, req.session.userId]);
  await run("DELETE FROM comments WHERE post_id=? AND EXISTS(SELECT 1 FROM posts WHERE id=? AND user_id=?)",
    [req.params.id, req.params.id, req.session.userId]);
  const result = await run("DELETE FROM posts WHERE id=? AND user_id=?", [req.params.id, req.session.userId]);
  if (!result.changes) return res.status(404).json({ error: "Post not found" });
  res.json({ message: "Post deleted" });
});

app.post("/api/posts/:id/like", auth, async (req, res) => {
  const existing = await get("SELECT id FROM likes WHERE user_id=? AND post_id=?", [req.session.userId, req.params.id]);
  if (existing) {
    await run("DELETE FROM likes WHERE id=?", [existing.id]);
    return res.json({ liked: false });
  }
  await run("INSERT INTO likes(user_id,post_id) VALUES(?,?)", [req.session.userId, req.params.id]);
  res.json({ liked: true });
});

app.post("/api/posts/:id/comments", auth, async (req, res) => {
  const content = (req.body.content || "").trim();
  if (!content) return res.status(400).json({ error: "Comment cannot be empty" });
  await run("INSERT INTO comments(post_id,user_id,content) VALUES(?,?,?)",
    [req.params.id, req.session.userId, content]);
  res.json({ message: "Comment added" });
});

app.post("/api/users/:id/follow", auth, async (req, res) => {
  const target = Number(req.params.id);
  if (target === req.session.userId) return res.status(400).json({ error: "You cannot follow yourself" });

  const existing = await get(
    "SELECT id FROM followers WHERE follower_id=? AND following_id=?",
    [req.session.userId, target]
  );

  if (existing) {
    await run("DELETE FROM followers WHERE id=?", [existing.id]);
    return res.json({ following: false });
  }

  await run("INSERT INTO followers(follower_id,following_id) VALUES(?,?)",
    [req.session.userId, target]);
  res.json({ following: true });
});

app.get("/api/profile/:id", auth, async (req, res) => {
  const id = Number(req.params.id);
  const user = await get(`
    SELECT id, username, bio, created_at,
      (SELECT COUNT(*) FROM followers WHERE following_id=users.id) AS followers,
      (SELECT COUNT(*) FROM followers WHERE follower_id=users.id) AS following,
      EXISTS(
        SELECT 1 FROM followers WHERE follower_id=? AND following_id=users.id
      ) AS is_following
    FROM users WHERE id=?`, [req.session.userId, id]);

  if (!user) return res.status(404).json({ error: "User not found" });

  user.posts = await all(`
    SELECT p.id,p.content,p.created_at,
      (SELECT COUNT(*) FROM likes WHERE post_id=p.id) AS likes
    FROM posts p WHERE p.user_id=? ORDER BY p.created_at DESC`, [id]);

  res.json(user);
});

app.get("*", (req, res) => res.sendFile(__dirname + "/public/index.html"));

app.listen(PORT, () => console.log(`MiniSocial running at http://localhost:${PORT}`));
