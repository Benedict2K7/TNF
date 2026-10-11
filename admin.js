const $ = (id) => document.getElementById(id);
const loginShell = $("loginShell");
const appShell = $("appShell");
let currentView = "overview";

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed.");
  return data;
}
function safe(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  })[c]);
}
function date(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString();
}
function showError(message) { $("globalNotice").textContent = message || ""; }
function empty(message) { return `<div class="empty-state">${safe(message)}</div>`; }
function table(headers, rows) {
  if (!rows.length) return empty("No records found.");
  return `<table><thead><tr>${headers.map(h => `<th>${safe(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
async function openApp(admin) {
  loginShell.classList.add("hidden");
  appShell.classList.remove("hidden");
  $("adminName").textContent = admin?.name || "Admin";
  await loadOverview();
}
async function checkSession() {
  try {
    const result = await api("/api/admin/me");
    if (result.loggedIn) await openApp(result.admin);
  } catch (_) { /* show login form */ }
}
$("adminLoginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("loginError").textContent = "";
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const result = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email: $("adminEmail").value, password: $("adminPassword").value })
    });
    $("adminPassword").value = "";
    await openApp(result.admin);
  } catch (error) {
    $("loginError").textContent = error.message;
  } finally { button.disabled = false; }
});
$("logoutButton").addEventListener("click", async () => {
  try { await api("/api/admin/logout", { method: "POST", body: "{}" }); }
  finally { appShell.classList.add("hidden"); loginShell.classList.remove("hidden"); }
});
$("navigation").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) navigate(button.dataset.view);
});
document.querySelectorAll("[data-goto]").forEach(button => button.addEventListener("click", () => navigate(button.dataset.goto)));
$("refreshButton").addEventListener("click", () => loadView(currentView));
$("tagSearchButton").addEventListener("click", () => loadTags());
$("ownerSearchButton").addEventListener("click", () => loadOwners());
$("tagSearch").addEventListener("keydown", e => { if (e.key === "Enter") loadTags(); });
$("ownerSearch").addEventListener("keydown", e => { if (e.key === "Enter") loadOwners(); });

function navigate(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach(el => el.classList.add("hidden"));
  $("view-" + view).classList.remove("hidden");
  document.querySelectorAll(".nav-link").forEach(el => el.classList.toggle("active", el.dataset.view === view));
  $("pageTitle").textContent = ({overview:"Overview",tags:"NFC tags",owners:"Owners",chats:"Conversations"})[view] || "Overview";
  showError("");
  loadView(view);
}
async function loadView(view) {
  try {
    if (view === "overview") await loadOverview();
    if (view === "tags") await loadTags();
    if (view === "owners") await loadOwners();
    if (view === "chats") await loadChats();
  } catch (error) { showError(error.message); }
}
async function loadOverview() {
  const [stats, tags] = await Promise.all([api("/api/admin/stats"), api("/api/admin/tags")]);
  $("statTags").textContent = stats.tags;
  $("statOwners").textContent = stats.owners;
  $("statChats").textContent = stats.chats;
  $("statMessages").textContent = stats.messages;
  $("statActive").textContent = stats.activeChats;
  $("statDisabled").textContent = stats.disabledTags;
  $("recentTags").innerHTML = renderTags(tags.tags.slice(0, 5), false);
}
function renderTags(tags, actions) {
  return table(["Tag ID", "Item", "Owner", "Status", ...(actions ? ["Action"] : [])], tags.map(tag => `
    <tr><td class="tag-id">${safe(tag.nfcId)}</td><td>${safe(tag.item)}</td>
    <td>${safe(tag.ownerName)}<br><small>${safe(tag.email)}</small></td>
    <td><span class="pill ${tag.status === "disabled" ? "disabled" : ""}">${safe(tag.status || "registered")}</span></td>
    ${actions ? `<td><button class="table-action ${tag.status === "disabled" ? "" : "disable"}" data-tag="${safe(tag.nfcId)}" data-status="${tag.status === "disabled" ? "registered" : "disabled"}">${tag.status === "disabled" ? "Reactivate" : "Disable"}</button></td>` : ""}</tr>`));
}
async function loadTags() {
  const q = $("tagSearch").value.trim();
  const result = await api("/api/admin/tags?q=" + encodeURIComponent(q));
  $("tagsTable").innerHTML = renderTags(result.tags, true);
  $("tagsTable").querySelectorAll("[data-tag]").forEach(button => button.addEventListener("click", async () => {
    const verb = button.dataset.status === "disabled" ? "disable" : "reactivate";
    if (!confirm(`Are you sure you want to ${verb} tag ${button.dataset.tag}?`)) return;
    button.disabled = true;
    try {
      await api(`/api/admin/tags/${encodeURIComponent(button.dataset.tag)}/status`, {
        method: "PATCH", body: JSON.stringify({ status: button.dataset.status })
      });
      await loadTags();
      showError("");
    } catch (error) { showError(error.message); button.disabled = false; }
  }));
}
async function loadOwners() {
  const result = await api("/api/admin/owners?q=" + encodeURIComponent($("ownerSearch").value.trim()));
  $("ownersTable").innerHTML = table(["Owner", "Email", "Registered"], result.owners.map(owner => `
    <tr><td><b>${safe(owner.name)}</b></td><td>${safe(owner.email)}</td><td>${date(owner.createdAt)}</td></tr>`));
}
async function loadChats() {
  const result = await api("/api/admin/chats");
  $("chatsTable").innerHTML = table(["Tag ID", "Finder", "Status", "Created", "Last activity"], result.chats.map(chat => `
    <tr><td class="tag-id">${safe(chat.nfcId)}</td><td>${safe(chat.finderName)}</td>
    <td><span class="pill ${chat.status === "closed" ? "closed" : ""}">${safe(chat.status)}</span></td>
    <td>${date(chat.createdAt)}</td><td>${date(chat.lastMessageAt)}</td></tr>`));
}
checkSession();
