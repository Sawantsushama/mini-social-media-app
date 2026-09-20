let me = null;

const $ = id => document.getElementById(id);

function msg(text, error=false) {
  $("message").innerHTML = `<div class="notice ${error ? "error" : ""}">${escapeHtml(text)}</div>`;
  setTimeout(() => $("message").innerHTML = "", 2500);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#039;"
  }[c]));
}

async function api(url, options={}) {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

async function checkAuth() {
  try {
    me = await api("/api/me");
    $("loginPage").classList.add("hidden");
    $("registerPage").classList.add("hidden");
    $("app").classList.remove("hidden");
    await loadFeed();
  } catch {
    $("loginPage").classList.remove("hidden");
    $("registerPage").classList.add("hidden");
    $("app").classList.add("hidden");
    document.querySelector(".topbar").style.display = "none";
  }
}

$("showRegister").onclick = e => {
  e.preventDefault();
  $("loginPage").classList.add("hidden");
  $("registerPage").classList.remove("hidden");
};
$("showLogin").onclick = e => {
  e.preventDefault();
  $("registerPage").classList.add("hidden");
  $("loginPage").classList.remove("hidden");
};

$("loginForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/api/login", {
      method: "POST",
      body: JSON.stringify({
        email: $("loginEmail").value,
        password: $("loginPassword").value
      })
    });
    location.reload();
  } catch (e) { msg(e.message, true); }
};

$("registerForm").onsubmit = async e => {
  e.preventDefault();
  try {
    await api("/api/register", {
      method: "POST",
      body: JSON.stringify({
        username: $("regUsername").value,
        email: $("regEmail").value,
        password: $("regPassword").value
      })
    });
    location.reload();
  } catch (e) { msg(e.message, true); }
};

$("logoutBtn").onclick = async () => {
  await api("/api/logout", { method: "POST" });
  location.reload();
};

document.querySelectorAll(".nav-btn[data-page]").forEach(btn => {
  btn.onclick = () => showPage(btn.dataset.page);
});

function showPage(page) {
  document.querySelectorAll("#app > section").forEach(s => s.classList.add("hidden"));
  $(`${page}Page`).classList.remove("hidden");
  document.querySelectorAll(".nav-btn[data-page]").forEach(b =>
    b.classList.toggle("active", b.dataset.page === page)
  );
  if (page === "profile") loadProfile();
  if (page === "people") loadPeople();
}

$("postContent").oninput = () => {
  $("charCount").textContent = $("postContent").value.length;
};

$("postBtn").onclick = async () => {
  try {
    await api("/api/posts", {
      method: "POST",
      body: JSON.stringify({ content: $("postContent").value })
    });
    $("postContent").value = "";
    $("charCount").textContent = "0";
    msg("Post published!");
    loadFeed();
  } catch (e) { msg(e.message, true); }
};

async function loadFeed() {
  const posts = await api("/api/posts");
  const feed = $("feed");
  feed.innerHTML = posts.length ? "" : `<div class="card muted">No posts yet. Be the first to post!</div>`;

  posts.forEach(p => {
    const comments = p.comments.map(c => `
      <div class="comment">
        <b>@${escapeHtml(c.username)}</b> ${escapeHtml(c.content)}
      </div>`).join("");

    const div = document.createElement("div");
    div.className = "card";
    div.innerHTML = `
      <div class="post-head">
        <span class="user" data-user="${p.user_id}">@${escapeHtml(p.username)}</span>
        ${p.user_id === me.id ? `<button class="delete" data-delete="${p.id}">Delete</button>` : ""}
      </div>
      <p class="post-content">${escapeHtml(p.content)}</p>
      <small class="muted">${new Date(p.created_at).toLocaleString()}</small>
      <div class="actions">
        <button class="action ${p.liked ? "liked" : ""}" data-like="${p.id}">
          ${p.liked ? "❤️" : "♡"} ${p.likes}
        </button>
        <span class="action">💬 ${p.comments.length}</span>
      </div>
      <div>${comments}</div>
      <div class="comment-form">
        <input id="comment-${p.id}" placeholder="Write a comment...">
        <button class="primary" data-comment="${p.id}">Comment</button>
      </div>
    `;
    feed.appendChild(div);
  });

  document.querySelectorAll("[data-like]").forEach(b => b.onclick = async () => {
    await api(`/api/posts/${b.dataset.like}/like`, { method: "POST" });
    loadFeed();
  });

  document.querySelectorAll("[data-comment]").forEach(b => b.onclick = async () => {
    const id = b.dataset.comment;
    const input = $(`comment-${id}`);
    try {
      await api(`/api/posts/${id}/comments`, {
        method: "POST", body: JSON.stringify({ content: input.value })
      });
      loadFeed();
    } catch (e) { msg(e.message, true); }
  });

  document.querySelectorAll("[data-delete]").forEach(b => b.onclick = async () => {
    if (!confirm("Delete this post?")) return;
    await api(`/api/posts/${b.dataset.delete}`, { method: "DELETE" });
    loadFeed();
  });

  document.querySelectorAll("[data-user]").forEach(el => el.onclick = () => {
    window.open(`?profile=${el.dataset.user}`, "_self");
  });
}

async function loadProfile() {
  me = await api("/api/me");
  $("myProfile").innerHTML = `
    <div class="card">
      <div class="profile-cover"></div>
      <div class="profile-info">
        <div class="avatar">${escapeHtml(me.username[0].toUpperCase())}</div>
        <h2>@${escapeHtml(me.username)}</h2>
        <p class="muted">${escapeHtml(me.email)}</p>
        <div class="stats">
          <span><b>${me.followers}</b> Followers</span>
          <span><b>${me.following}</b> Following</span>
        </div>
        <textarea id="bio">${escapeHtml(me.bio || "")}</textarea>
        <button class="primary" id="saveBio">Save Bio</button>
      </div>
    </div>
  `;
  $("saveBio").onclick = async () => {
    await api("/api/me", {
      method: "PUT",
      body: JSON.stringify({ bio: $("bio").value })
    });
    msg("Profile updated!");
  };
}

async function loadPeople() {
  const users = await api("/api/users");
  $("people").innerHTML = users.length ? users.map(u => `
    <div class="person">
      <div>
        <b>@${escapeHtml(u.username)}</b>
        <div class="muted">${escapeHtml(u.bio || "No bio")}</div>
        <small>${u.followers} followers</small>
      </div>
      <button class="primary" data-follow="${u.id}">
        ${u.is_following ? "Unfollow" : "Follow"}
      </button>
    </div>
  `).join("") : `<p class="muted">No other users yet.</p>`;

  document.querySelectorAll("[data-follow]").forEach(b => b.onclick = async () => {
    await api(`/api/users/${b.dataset.follow}/follow`, { method: "POST" });
    loadPeople();
  });
}

checkAuth();