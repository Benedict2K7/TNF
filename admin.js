// =====================================================
// TAP N FOUND - ADMIN DASHBOARD
// =====================================================

const $ = (id) => document.getElementById(id);

const loginShell = $("loginShell");
const appShell = $("appShell");

let currentView = "overview";

// LOCAL BACKEND URL
const API_URL = "";

// =====================================================
// API CONNECTION
// =====================================================
async function api(url, options = {}) {
    let response;

    try {
        response = await fetch(`${API_URL}${url}`, {
            ...options,
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {})
            }
        });
    } catch (error) {
        console.error("API connection failed:", error);
        throw new Error("Could not connect to the backend.");
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error || `Request failed: HTTP ${response.status}`
        );
    }

    return data;
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function safe(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[c]);
}

function date(value) {
    if (!value) return "—";

    const d = new Date(value);

    return Number.isNaN(d.getTime())
        ? "—"
        : d.toLocaleDateString();
}

function showError(message) {
    $("globalNotice").textContent = message || "";
}

function empty(message) {
    return `<div class="empty-state">${safe(message)}</div>`;
}

function table(headers, rows) {
    if (!rows.length) {
        return empty("No records found.");
    }

    return `
        <table>
            <thead>
                <tr>
                    ${headers.map(h => `<th>${safe(h)}</th>`).join("")}
                </tr>
            </thead>
            <tbody>
                ${rows.join("")}
            </tbody>
        </table>
    `;
}

// =====================================================
// OPEN ADMIN DASHBOARD
// =====================================================

async function openApp(admin) {
    loginShell.classList.add("hidden");
    appShell.classList.remove("hidden");

    $("adminName").textContent = admin?.name || "Admin";

    await loadOverview();
}

// =====================================================
// CHECK ADMIN SESSION
// =====================================================

async function checkSession() {
    try {
        const result = await api("/api/admin/me");

        if (result.loggedIn) {
            await openApp(result.admin);
        }
    } catch (error) {
        console.log("No active admin session:", error.message);
    }
}

// =====================================================
// ADMIN LOGIN
// =====================================================

$("adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    $("loginError").textContent = "";

    const button = event.currentTarget.querySelector(
        'button[type="submit"]'
    );

    button.disabled = true;

    try {
        const result = await api("/api/admin/login", {
            method: "POST",
            body: JSON.stringify({
                email: $("adminEmail").value.trim(),
                password: $("adminPassword").value
            })
        });

        $("adminPassword").value = "";

        await openApp(result.admin);

    } catch (error) {
        console.error("Admin login error:", error);

        $("loginError").textContent = error.message;

    } finally {
        button.disabled = false;
    }
});

// =====================================================
// ADMIN LOGOUT
// =====================================================

$("logoutButton").addEventListener("click", async () => {
    try {
        await api("/api/admin/logout", {
            method: "POST",
            body: JSON.stringify({})
        });

    } catch (error) {
        console.error("Logout error:", error);

    } finally {
        appShell.classList.add("hidden");
        loginShell.classList.remove("hidden");
        $("loginError").textContent = "";
        $("adminPassword").value = "";
    }
});

// =====================================================
// NAVIGATION
// =====================================================

$("navigation").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");

    if (button) {
        navigate(button.dataset.view);
    }
});

document.querySelectorAll("[data-goto]").forEach(button => {
    button.addEventListener("click", () => {
        navigate(button.dataset.goto);
    });
});

// =====================================================
// BUTTON EVENTS
// =====================================================

$("refreshButton").addEventListener("click", () => {
    loadView(currentView);
});

$("tagSearchButton").addEventListener("click", () => {
    loadTags();
});

$("ownerSearchButton").addEventListener("click", () => {
    loadOwners();
});

$("tagSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        loadTags();
    }
});

$("ownerSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        loadOwners();
    }
});

// =====================================================
// CHANGE DASHBOARD VIEW
// =====================================================

function navigate(view) {
    const allowedViews = [
        "overview",
        "tags",
        "owners",
        "chats"
    ];

    if (!allowedViews.includes(view)) {
        return;
    }

    currentView = view;

    document.querySelectorAll(".view").forEach(element => {
        element.classList.add("hidden");
    });

    $("view-" + view).classList.remove("hidden");

    document.querySelectorAll(".nav-link").forEach(element => {
        element.classList.toggle(
            "active",
            element.dataset.view === view
        );
    });

    const titles = {
        overview: "Overview",
        tags: "NFC tags",
        owners: "Owners",
        chats: "Conversations"
    };

    $("pageTitle").textContent = titles[view];

    showError("");

    loadView(view);
}

// =====================================================
// LOAD SELECTED VIEW
// =====================================================

async function loadView(view) {
    try {
        if (view === "overview") {
            await loadOverview();
        }

        if (view === "tags") {
            await loadTags();
        }

        if (view === "owners") {
            await loadOwners();
        }

        if (view === "chats") {
            await loadChats();
        }

    } catch (error) {
        console.error("Dashboard loading error:", error);
        showError(error.message);
    }
}

// =====================================================
// OVERVIEW STATISTICS
// =====================================================

async function loadOverview() {
    const [stats, tags] = await Promise.all([
        api("/api/admin/stats"),
        api("/api/admin/tags")
    ]);

    $("statTags").textContent = stats.tags ?? 0;
    $("statOwners").textContent = stats.owners ?? 0;
    $("statChats").textContent = stats.chats ?? 0;
    $("statMessages").textContent = stats.messages ?? 0;
    $("statActive").textContent = stats.activeChats ?? 0;
    $("statDisabled").textContent = stats.disabledTags ?? 0;

    $("recentTags").innerHTML = renderTags(
        (tags.tags || []).slice(0, 5),
        false
    );
}

// =====================================================
// RENDER NFC TAG TABLE
// =====================================================

function renderTags(tags, actions) {
    return table(
        [
            "Tag ID",
            "Item",
            "Owner",
            "Status",
            ...(actions ? ["Action"] : [])
        ],

        tags.map(tag => `
            <tr>
                <td class="tag-id">
                    ${safe(tag.nfcId)}
                </td>

                <td>
                    ${safe(tag.item)}
                </td>

                <td>
                    ${safe(tag.ownerName)}
                    <br>
                    <small>${safe(tag.email)}</small>
                </td>

                <td>
                    <span class="pill ${
                        tag.status === "disabled" ? "disabled" : ""
                    }">
                        ${safe(tag.status || "registered")}
                    </span>
                </td>

                ${
                    actions
                        ? `
                            <td>
                                <button
                                    class="table-action ${
                                        tag.status === "disabled"
                                            ? ""
                                            : "disable"
                                    }"
                                    data-tag="${safe(tag.nfcId)}"
                                    data-status="${
                                        tag.status === "disabled"
                                            ? "registered"
                                            : "disabled"
                                    }"
                                >
                                    ${
                                        tag.status === "disabled"
                                            ? "Reactivate"
                                            : "Disable"
                                    }
                                </button>
                            </td>
                        `
                        : ""
                }
            </tr>
        `)
    );
}

// =====================================================
// LOAD NFC TAGS
// =====================================================

async function loadTags() {
    const q = $("tagSearch").value.trim();

    const result = await api(
        "/api/admin/tags?q=" + encodeURIComponent(q)
    );

    $("tagsTable").innerHTML = renderTags(
        result.tags || [],
        true
    );

    $("tagsTable").querySelectorAll("[data-tag]").forEach(button => {
        button.addEventListener("click", async () => {
            const tagId = button.dataset.tag;
            const newStatus = button.dataset.status;

            const verb = newStatus === "disabled"
                ? "disable"
                : "reactivate";

            if (!confirm(
                `Are you sure you want to ${verb} tag ${tagId}?`
            )) {
                return;
            }

            button.disabled = true;

            try {
                await api(
                    `/api/admin/tags/${encodeURIComponent(tagId)}/status`,
                    {
                        method: "PATCH",
                        body: JSON.stringify({
                            status: newStatus
                        })
                    }
                );

                showError("");

                await loadTags();

            } catch (error) {
                console.error("Tag update error:", error);

                showError(error.message);

                button.disabled = false;
            }
        });
    });
}

// =====================================================
// LOAD OWNER ACCOUNTS
// =====================================================

async function loadOwners() {
    const query = $("ownerSearch").value.trim();

    const result = await api(
        "/api/admin/owners?q=" + encodeURIComponent(query)
    );

    $("ownersTable").innerHTML = table(
        ["Owner", "Email", "Registered"],

        (result.owners || []).map(owner => `
            <tr>
                <td>
                    <b>${safe(owner.name)}</b>
                </td>

                <td>
                    ${safe(owner.email)}
                </td>

                <td>
                    ${date(owner.createdAt)}
                </td>
            </tr>
        `)
    );
}

// =====================================================
// LOAD CONVERSATIONS
// =====================================================

async function loadChats() {
    const result = await api("/api/admin/chats");

    $("chatsTable").innerHTML = table(
        [
            "Tag ID",
            "Finder",
            "Status",
            "Created",
            "Last activity"
        ],

        (result.chats || []).map(chat => `
            <tr>
                <td class="tag-id">
                    ${safe(chat.nfcId)}
                </td>

                <td>
                    ${safe(chat.finderName)}
                </td>

                <td>
                    <span class="pill ${
                        chat.status === "closed" ? "closed" : ""
                    }">
                        ${safe(chat.status)}
                    </span>
                </td>

                <td>
                    ${date(chat.createdAt)}
                </td>

                <td>
                    ${date(chat.lastMessageAt)}
                </td>
            </tr>
        `)
    );
}

// =====================================================
// START APPLICATION
// =====================================================

checkSession();