// ==================================================
// TAP N FOUND — APPLICATION CORE JAVASCRIPT
// ==================================================

const $ = (id) => document.getElementById(id);

let currentNfcId = "";
let currentRole = "";
let currentChatId = "";
let finderToken = "";
let pollTimer = null;
let currentUser = null;
let ownerTagsList = [];

const finderStorageKey = (id) => `tnf_finder_chat_${id}`;
const finderTokenKey = (id) => `tnf_finder_token_${id}`;

// --------------------------------------------------
// NOTIFICATIONS & BANNER
// --------------------------------------------------

function showNotice(message, isError = false) {
    const banner = $("notice");
    if (!banner) return;

    if (!message) {
        banner.hidden = true;
        banner.textContent = "";
        return;
    }

    banner.textContent = message;
    banner.className = `notice-banner ${isError ? "error" : "success"}`;
    banner.hidden = false;

    // Auto-hide success notices after 6s
    if (!isError) {
        setTimeout(() => {
            if (banner.textContent === message) {
                banner.hidden = true;
            }
        }, 6000);
    }
}

// --------------------------------------------------
// SECTION VISIBILITY CONTROLLER
// --------------------------------------------------

function showMainSection(sectionId) {
    const sections = [
        "landingSection",
        "tagHeaderPanel",
        "finderSection",
        "ownerSection",
        "registerTagSection",
        "authSection",
        "errorSection"
    ];

    sections.forEach((id) => {
        const el = $(id);
        if (el) el.hidden = true;
    });

    if (sectionId === "landing") {
        $("landingSection").hidden = false;
    } else if (sectionId === "finder") {
        $("tagHeaderPanel").hidden = false;
        $("finderSection").hidden = false;
    } else if (sectionId === "owner") {
        $("ownerSection").hidden = false;
    } else if (sectionId === "registerTag") {
        $("tagHeaderPanel").hidden = false;
        $("registerTagSection").hidden = false;
    } else if (sectionId === "auth") {
        $("authSection").hidden = false;
    } else if (sectionId === "error") {
        $("errorSection").hidden = false;
    }
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function showError(message) {
    stopPolling();
    showMainSection("error");
    const errorText = $("errorText");
    if (errorText) errorText.textContent = message;
}

// --------------------------------------------------
// API REQUEST HELPER
// --------------------------------------------------

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(data.error || `Request failed with status ${response.status}`);
    }

    return data;
}

function formatTime(dateString) {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return "";

    const now = new Date();
    const isToday = now.toDateString() === date.toDateString();

    if (isToday) {
        return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function getCategoryIcon(cat) {
    const map = {
        keys: "🔑",
        bag: "🎒",
        wallet: "👛",
        laptop: "💻",
        phone: "📱",
        pet: "🐕",
        luggage: "🧳",
        general: "📦"
    };
    return map[cat] || "📦";
}

// --------------------------------------------------
// AUTHENTICATION & SESSION MANAGEMENT
// --------------------------------------------------

async function checkSession() {
    try {
        const data = await api("/api/auth/me");
        if (data.loggedIn && data.owner) {
            currentUser = data.owner;
            updateAuthUI(true);
        } else {
            currentUser = null;
            updateAuthUI(false);
        }
    } catch (_) {
        currentUser = null;
        updateAuthUI(false);
    }
}

function updateAuthUI(isLoggedIn) {
    const authBadge = $("userAuthBadge");
    if (!authBadge) return;

    if (isLoggedIn && currentUser) {
        authBadge.innerHTML = `
            <span class="muted" style="font-size:13px; font-weight:600;">Hi, ${escapeHtml(currentUser.name)}</span>
            <button class="btn btn-outline-light btn-sm" id="topLogoutBtn">Log out</button>
        `;
        const logoutBtn = $("topLogoutBtn");
        if (logoutBtn) logoutBtn.addEventListener("click", logoutUser);
    } else {
        authBadge.innerHTML = `
            <a href="/login" class="btn btn-outline-light btn-sm">Log in</a>
            <button class="btn btn-primary btn-sm" id="navRegisterBtn">Create Account</button>
        `;
        const regBtn = $("navRegisterBtn");
        if (regBtn) regBtn.addEventListener("click", () => showAuthTab("signup"));
    }
}

async function logoutUser() {
    try {
        await api("/api/auth/logout", { method: "POST" });
        currentUser = null;
        updateAuthUI(false);
        showNotice("Logged out successfully.");
        window.location.href = "/";
    } catch (err) {
        showNotice(err.message, true);
    }
}

// --------------------------------------------------
// AUTH FORMS (SIGNUP & INLINE LOGIN)
// --------------------------------------------------

function showAuthTab(tab) {
    showMainSection("auth");
    const signupBtn = $("authTabSignup");
    const loginBtn = $("authTabLogin");
    const signupForm = $("signupForm");
    const loginForm = $("inlineLoginForm");

    if (tab === "signup") {
        signupBtn.classList.add("active");
        loginBtn.classList.remove("active");
        signupForm.hidden = false;
        loginForm.hidden = true;
    } else {
        loginBtn.classList.add("active");
        signupBtn.classList.remove("active");
        loginForm.hidden = false;
        signupForm.hidden = true;
    }
}

$("authTabSignup")?.addEventListener("click", () => showAuthTab("signup"));
$("authTabLogin")?.addEventListener("click", () => showAuthTab("login"));

$("signupForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = $("signupName").value.trim();
    const email = $("signupEmail").value.trim();
    const password = $("signupPassword").value;
    const submitBtn = e.target.querySelector("button[type='submit']");

    submitBtn.disabled = true;
    submitBtn.textContent = "Creating Account...";

    try {
        const res = await api("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ name, email, password })
        });

        currentUser = res.owner;
        updateAuthUI(true);
        showNotice("Account created successfully!");

        if (currentNfcId) {
            await loadTag(currentNfcId);
        } else {
            openOwnerDashboard();
        }
    } catch (err) {
        showNotice(err.message, true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Create Free Account";
    }
});

$("inlineLoginForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("inlineLoginEmail").value.trim();
    const password = $("inlineLoginPassword").value;
    const submitBtn = e.target.querySelector("button[type='submit']");

    submitBtn.disabled = true;
    submitBtn.textContent = "Signing In...";

    try {
        const res = await api("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password })
        });

        currentUser = res.owner;
        updateAuthUI(true);
        showNotice("Welcome back, " + currentUser.name + "!");

        if (currentNfcId) {
            await loadTag(currentNfcId);
        } else {
            openOwnerDashboard();
        }
    } catch (err) {
        showNotice(err.message, true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Sign In";
    }
});

// --------------------------------------------------
// NFC TAG LOOKUP & RESOLUTION
// --------------------------------------------------

async function loadTag(tagId) {
    if (!tagId) {
        showMainSection("landing");
        return;
    }

    currentNfcId = tagId.trim();
    showMainSection("tagHeaderPanel");

    $("tagIdBadge").textContent = `TAG #${currentNfcId}`;
    $("tagStatusBadge").textContent = "Checking...";
    $("tagStatusBadge").className = "badge";
    $("pageTitle").textContent = `Tag #${currentNfcId}`;
    $("tagInfo").textContent = "Looking up tag in Tap N Found network...";

    try {
        const data = await api(`/api/nfc/${encodeURIComponent(currentNfcId)}`);

        if (!data.registered) {
            // Unregistered tag
            $("tagStatusBadge").textContent = "Unregistered";
            $("tagStatusBadge").className = "badge badge-tag";
            $("pageTitle").textContent = `Tag #${currentNfcId} Available`;
            $("tagInfo").textContent = "This NFC tag has not been linked to an item yet.";

            if (currentUser) {
                showMainSection("registerTag");
            } else {
                showNotice("This tag is not registered yet. Sign in or create an account to claim it.");
                showAuthTab("signup");
            }
            return;
        }

        // Tag is registered!
        const tag = data.nfc;
        currentRole = data.role;

        $("tagStatusBadge").textContent = tag.status === "lost" ? "Reported Lost" : "Protected";
        $("tagStatusBadge").className = `badge ${tag.status === "lost" ? "badge-lost" : "badge-safe"}`;
        $("pageTitle").textContent = `${getCategoryIcon(tag.itemCategory)} ${tag.item}`;
        $("tagInfo").textContent = `Registered to ${tag.ownerName} · Tap N Found Protected`;

        if (currentRole === "owner") {
            openOwnerDashboard();
        } else {
            setupFinderView(tag);
        }

    } catch (err) {
        showError(err.message || "Could not check this NFC tag.");
    }
}

// --------------------------------------------------
// FINDER VIEW & LOCATION SHARING
// --------------------------------------------------

function setupFinderView(tag) {
    showMainSection("finder");

    $("finderItemInfo").textContent = `You found ${tag.ownerName}'s ${tag.item}.`;
    $("finderOwnerName").textContent = tag.ownerName;
    $("finderItemCategory").textContent = `${getCategoryIcon(tag.itemCategory)} ${tag.item}`;

    // Lost alert banner
    const lostAlert = $("itemLostAlert");
    if (lostAlert) {
        lostAlert.hidden = tag.status !== "lost";
    }

    // WhatsApp Action Button
    const whatsAppBtn = $("finderWhatsAppBtn");
    if (whatsAppBtn) {
        if (tag.allowWhatsApp && tag.phone) {
            const cleanPhone = tag.phone.replace(/[^0-9]/g, "");
            const text = encodeURIComponent(`Hi ${tag.ownerName}! I found your ${tag.item} (Tap N Found Tag #${tag.nfcId}). Let me know how I can return it!`);
            whatsAppBtn.href = `https://wa.me/${cleanPhone}?text=${text}`;
            whatsAppBtn.hidden = false;
        } else {
            whatsAppBtn.hidden = true;
        }
    }

    // Check for existing conversation stored in localStorage
    const savedChatId = localStorage.getItem(finderStorageKey(tag.nfcId));
    const savedToken = localStorage.getItem(finderTokenKey(tag.nfcId));

    if (savedChatId && savedToken) {
        currentChatId = savedChatId;
        finderToken = savedToken;
        openFinderChat();
    } else {
        $("finderStartArea").hidden = false;
        $("finderChatArea").hidden = true;
    }
}

// Finder starts conversation
$("finderStartForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = $("finderNameInput");
    const finderName = nameInput.value.trim();
    if (!finderName) return;

    const submitBtn = e.target.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Connecting...";

    try {
        const res = await api(`/api/nfc/${encodeURIComponent(currentNfcId)}/chats`, {
            method: "POST",
            body: JSON.stringify({ finderName })
        });

        currentChatId = res.chat.id;
        finderToken = res.finderToken;

        // Persist session for this finder
        localStorage.setItem(finderStorageKey(currentNfcId), currentChatId);
        localStorage.setItem(finderTokenKey(currentNfcId), finderToken);

        openFinderChat();
    } catch (err) {
        showNotice(err.message, true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Start Chat";
    }
});

function openFinderChat() {
    $("finderStartArea").hidden = true;
    $("finderChatArea").hidden = false;
    loadMessages("finder");
    startPolling("finder");
}

// 1-Click GPS Location Sharing
$("finderShareLocationBtn")?.addEventListener("click", () => {
    if (!navigator.geolocation) {
        showNotice("Geolocation is not supported by your browser.", true);
        return;
    }

    const statusCard = $("locationStatus");
    const statusText = $("locationStatusText");
    const locBtn = $("finderShareLocationBtn");

    statusCard.hidden = false;
    locBtn.disabled = true;
    statusText.textContent = "Pinning your location via GPS...";

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude.toFixed(6);
            const lon = position.coords.longitude.toFixed(6);
            const accuracy = Math.round(position.coords.accuracy);

            statusText.textContent = `Location acquired (accurate to ~${accuracy}m). Sending to owner...`;

            const mapsUrl = `https://www.google.com/maps?q=${lat},${lon}`;
            const message = `📍 Found Item Location: ${mapsUrl} (Accuracy: ~${accuracy}m)`;

            // If chat is not started yet, auto-create one with "Helpful Finder"
            if (!currentChatId) {
                try {
                    const res = await api(`/api/nfc/${encodeURIComponent(currentNfcId)}/chats`, {
                        method: "POST",
                        body: JSON.stringify({ finderName: "Helpful Finder" })
                    });
                    currentChatId = res.chat.id;
                    finderToken = res.finderToken;
                    localStorage.setItem(finderStorageKey(currentNfcId), currentChatId);
                    localStorage.setItem(finderTokenKey(currentNfcId), finderToken);
                    openFinderChat();
                } catch (err) {
                    showNotice(err.message, true);
                    statusCard.hidden = true;
                    locBtn.disabled = false;
                    return;
                }
            }

            // Send location message
            try {
                await api(`/api/chats/${currentChatId}/messages`, {
                    method: "POST",
                    headers: { "x-finder-token": finderToken },
                    body: JSON.stringify({ text: message })
                });

                statusCard.hidden = true;
                locBtn.disabled = false;
                showNotice("📍 Your location was shared with the owner!");
                loadMessages("finder");
            } catch (err) {
                showNotice(err.message, true);
                statusCard.hidden = true;
                locBtn.disabled = false;
            }
        },
        (err) => {
            statusCard.hidden = true;
            locBtn.disabled = false;
            showNotice("Could not access location. Please check browser permissions.", true);
        },
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
});

// Quick Replies
document.querySelectorAll(".quick-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
        const input = $("finderMessageInput");
        if (input) {
            input.value = chip.textContent;
            $("finderMessageForm").dispatchEvent(new Event("submit"));
        }
    });
});

// --------------------------------------------------
// CHAT MESSAGING & LOCATION CARD RENDERING
// --------------------------------------------------

function parseMessageText(text) {
    const mapsRegex = /(https?:\/\/(?:www\.)?(?:google\.com\/maps[^\s]+|maps\.google\.com[^\s]+))/g;
    const isMapLocation = mapsRegex.test(text);

    if (isMapLocation) {
        const cleanUrl = text.match(mapsRegex)[0];
        return `
            <div>${escapeHtml(text.replace(cleanUrl, ""))}</div>
            <div class="map-location-card">
                <div class="map-location-info">
                    <span class="map-icon">📍</span>
                    <div>
                        <strong>Item Location Pinned</strong>
                        <small>Google Maps Coordinates</small>
                    </div>
                </div>
                <a href="${cleanUrl}" target="_blank" rel="noopener noreferrer" class="map-open-btn">View Map ↗</a>
            </div>
        `;
    }

    return escapeHtml(text);
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadMessages(role) {
    if (!currentChatId) return;

    try {
        const headers = role === "finder" ? { "x-finder-token": finderToken } : {};
        const data = await api(`/api/chats/${currentChatId}/messages`, { headers });

        const container = role === "owner" ? $("ownerMessages") : $("finderMessages");
        if (!container) return;

        const messages = Array.isArray(data.messages) ? data.messages : [];

        if (messages.length === 0) {
            container.innerHTML = `<p class="muted" style="text-align:center; padding: 20px;">No messages yet. Send a message to start.</p>`;
            return;
        }

        container.innerHTML = messages.map((m) => `
            <div class="message-bubble sender-${m.sender}">
                <div class="message-content">${parseMessageText(m.text)}</div>
                <div class="message-meta">
                    <span>${m.sender === "owner" ? "Owner" : "Finder"}</span>
                    <span>·</span>
                    <span>${formatTime(m.createdAt)}</span>
                </div>
            </div>
        `).join("");

        container.scrollTop = container.scrollHeight;
    } catch (err) {
        console.error("Load messages error:", err.message);
    }
}

async function sendMessage(role, inputId, formId) {
    const input = $(inputId);
    const form = $(formId);
    const text = input?.value.trim();

    if (!text || !currentChatId) return;

    const submitBtn = form.querySelector("button[type='submit']");
    if (submitBtn) submitBtn.disabled = true;

    try {
        const headers = role === "finder" ? { "x-finder-token": finderToken } : {};
        await api(`/api/chats/${currentChatId}/messages`, {
            method: "POST",
            headers,
            body: JSON.stringify({ text })
        });

        input.value = "";
        await loadMessages(role);
    } catch (err) {
        showNotice(err.message, true);
    } finally {
        if (submitBtn) submitBtn.disabled = false;
        input.focus();
    }
}

$("finderMessageForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage("finder", "finderMessageInput", "finderMessageForm");
});

$("ownerMessageForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    sendMessage("owner", "ownerMessageInput", "ownerMessageForm");
});

function startPolling(role) {
    stopPolling();
    pollTimer = setInterval(async () => {
        try {
            if (role === "owner" && currentChatId) {
                await loadMessages("owner");
            } else if (role === "finder") {
                await loadMessages("finder");
            }
        } catch (_) {}
    }, 3500);
}

// --------------------------------------------------
// OWNER DASHBOARD & TABS
// --------------------------------------------------

function openOwnerDashboard() {
    showMainSection("owner");
    $("ownerGreeting").textContent = currentUser ? `Welcome back, ${currentUser.name}` : "Owner Dashboard";
    loadOwnerItems();
    loadOwnerChats();
}

function switchOwnerTab(tabName) {
    const tabs = ["items", "chats", "register"];
    tabs.forEach((t) => {
        const btn = $(`tab${capitalize(t)}Btn`);
        const content = $(`ownerTab${capitalize(t)}`);
        if (btn) btn.classList.toggle("active", t === tabName);
        if (content) content.hidden = t !== tabName;
    });
}

function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

$("tabItemsBtn")?.addEventListener("click", () => switchOwnerTab("items"));
$("tabChatsBtn")?.addEventListener("click", () => switchOwnerTab("chats"));
$("tabRegisterBtn")?.addEventListener("click", () => switchOwnerTab("register"));
$("ownerLogoutBtn")?.addEventListener("click", logoutUser);

async function loadOwnerItems() {
    try {
        const data = await api("/api/owner/tags");
        ownerTagsList = Array.isArray(data.tags) ? data.tags : [];

        const countBadge = $("itemsCountBadge");
        if (countBadge) countBadge.textContent = ownerTagsList.length;

        const listContainer = $("ownerItemsList");
        if (!listContainer) return;

        if (ownerTagsList.length === 0) {
            listContainer.innerHTML = `
                <div class="empty-state" style="grid-column: 1 / -1; text-align: center; padding: 40px;">
                    <span style="font-size: 38px;">📦</span>
                    <h4 style="margin: 10px 0 6px;">No registered items yet</h4>
                    <p class="muted">Click "Register New Tag" above to protect your first valuable!</p>
                </div>
            `;
            return;
        }

        listContainer.innerHTML = ownerTagsList.map((tag) => {
            const isLost = tag.status === "lost";
            return `
                <div class="item-card" data-tag="${escapeHtml(tag.nfcId)}">
                    <div class="item-card-top">
                        <span class="item-category-icon">${getCategoryIcon(tag.itemCategory)}</span>
                        <span class="badge ${isLost ? "badge-lost" : "badge-safe"}">
                            ${isLost ? "Reported Lost" : "Protected"}
                        </span>
                    </div>

                    <div class="item-card-details">
                        <h4>${escapeHtml(tag.item)}</h4>
                        <span class="item-id-pill">TAG #${escapeHtml(tag.nfcId)}</span>
                        ${tag.allowWhatsApp && tag.phone ? `<p class="muted" style="font-size:12px; margin-top:6px;">💬 WhatsApp Enabled (${escapeHtml(tag.phone)})</p>` : ""}
                    </div>

                    <div class="item-card-actions">
                        <button class="btn btn-sm btn-outline open-qr-btn" data-tag="${escapeHtml(tag.nfcId)}" data-item="${escapeHtml(tag.item)}">
                            📱 QR Sticker
                        </button>
                        <button class="btn btn-sm ${isLost ? "btn-primary" : "btn-outline"} toggle-lost-btn" data-tag="${escapeHtml(tag.nfcId)}" data-status="${tag.status}">
                            ${isLost ? "✓ Mark Safe" : "🚨 Report Lost"}
                        </button>
                    </div>
                </div>
            `;
        }).join("");

        // Attach action handlers
        listContainer.querySelectorAll(".open-qr-btn").forEach((btn) => {
            btn.addEventListener("click", () => openQrModal(btn.dataset.tag, btn.dataset.item));
        });

        listContainer.querySelectorAll(".toggle-lost-btn").forEach((btn) => {
            btn.addEventListener("click", () => toggleItemLostStatus(btn.dataset.tag, btn.dataset.status));
        });

    } catch (err) {
        console.error("Load owner items error:", err.message);
    }
}

async function toggleItemLostStatus(tagId, currentStatus) {
    const newStatus = currentStatus === "lost" ? "registered" : "lost";
    try {
        await api(`/api/owner/tags/${encodeURIComponent(tagId)}`, {
            method: "PATCH",
            body: JSON.stringify({ status: newStatus })
        });
        showNotice(`Item status updated to: ${newStatus === "lost" ? "Reported Lost" : "Protected"}`);
        await loadOwnerItems();
    } catch (err) {
        showNotice(err.message, true);
    }
}

async function loadOwnerChats() {
    if (!currentNfcId && ownerTagsList.length > 0) {
        currentNfcId = ownerTagsList[0].nfcId;
    }

    if (!currentNfcId) return;

    try {
        const data = await api(`/api/nfc/${encodeURIComponent(currentNfcId)}/chats`);
        const chats = Array.isArray(data.chats) ? data.chats : [];

        const countBadge = $("chatsCountBadge");
        if (countBadge) countBadge.textContent = chats.length;

        const chatListEl = $("chatList");
        if (!chatListEl) return;

        if (chats.length === 0) {
            chatListEl.innerHTML = `<p class="muted empty-chats">No conversations for Tag #${currentNfcId} yet.</p>`;
            return;
        }

        chatListEl.innerHTML = chats.map((c) => `
            <button class="chat-item-btn ${c._id === currentChatId ? "active" : ""}" data-chat-id="${c._id}" data-finder="${escapeHtml(c.finderName)}">
                <div class="chat-item-top">
                    <span class="chat-item-name">👤 ${escapeHtml(c.finderName)}</span>
                    <span class="chat-item-time">${formatTime(c.lastMessageAt)}</span>
                </div>
                <small class="muted" style="font-size:11px;">Tap to chat</small>
            </button>
        `).join("");

        chatListEl.querySelectorAll(".chat-item-btn").forEach((btn) => {
            btn.addEventListener("click", () => {
                currentChatId = btn.dataset.chatId;
                $("ownerChatTitle").textContent = `Chat with ${btn.dataset.finder}`;
                $("ownerChatPlaceholder").hidden = true;
                $("ownerChatArea").hidden = false;
                loadMessages("owner");
                startPolling("owner");
                loadOwnerChats();
            });
        });

    } catch (err) {
        console.error("Load owner chats error:", err.message);
    }
}

// Owner registers new tag
$("ownerRegisterForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const tagId = $("regTagId").value.trim();
    const item = $("regItemName").value.trim();
    const itemCategory = $("regItemCategory").value;
    const phone = $("regPhone").value.trim();
    const allowWhatsApp = $("regAllowWhatsApp").checked;

    const submitBtn = e.target.querySelector("button[type='submit']");
    submitBtn.disabled = true;
    submitBtn.textContent = "Registering...";

    try {
        await api(`/api/nfc/${encodeURIComponent(tagId)}/register`, {
            method: "POST",
            body: JSON.stringify({ item, itemCategory, phone, allowWhatsApp })
        });

        showNotice(`Tag #${tagId} (${item}) registered successfully!`);
        e.target.reset();
        await loadOwnerItems();
        switchOwnerTab("items");
        openQrModal(tagId, item);
    } catch (err) {
        showNotice(err.message, true);
    } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = "Complete Tag Registration";
    }
});

// Quick tag registration when scanning an unregistered tag
$("registerTagForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const item = $("itemName").value.trim();
    const itemCategory = $("itemCategorySelect").value;
    const phone = $("quickPhone").value.trim();

    const submitBtn = e.target.querySelector("button[type='submit']");
    submitBtn.disabled = true;

    try {
        await api(`/api/nfc/${encodeURIComponent(currentNfcId)}/register`, {
            method: "POST",
            body: JSON.stringify({
                item,
                itemCategory,
                phone,
                allowWhatsApp: Boolean(phone)
            })
        });

        showNotice(`Tag #${currentNfcId} registered successfully!`);
        await loadTag(currentNfcId);
    } catch (err) {
        showNotice(err.message, true);
    } finally {
        submitBtn.disabled = false;
    }
});

// --------------------------------------------------
// QR CODE GENERATOR & MODAL
// --------------------------------------------------

let currentQrDataUrl = "";

async function openQrModal(tagId, itemName) {
    const modal = $("qrModal");
    if (!modal) return;

    modal.hidden = false;
    $("qrModalTitle").textContent = itemName || "Protected Item";
    $("qrModalSubtitle").textContent = `Tap N Found Tag #${tagId}`;
    $("qrItemNameDisplay").textContent = itemName || "Valuable Item";
    $("qrTagIdDisplay").textContent = `NFC TAG #${tagId}`;

    const link = `${window.location.origin}/${encodeURIComponent(tagId)}`;
    $("qrLinkInput").value = link;

    const qrBox = $("qrCodeTarget");
    qrBox.innerHTML = `<p class="muted">Generating QR code...</p>`;

    try {
        const res = await api(`/api/nfc/${encodeURIComponent(tagId)}/qr?format=json`);
        currentQrDataUrl = res.dataUrl;
        qrBox.innerHTML = `<img src="${res.dataUrl}" alt="QR code for Tag #${tagId}" />`;
    } catch (err) {
        qrBox.innerHTML = `<p class="error">Could not generate QR code.</p>`;
    }
}

$("closeQrModalBtn")?.addEventListener("click", () => {
    $("qrModal").hidden = true;
});

$("copyQrLinkBtn")?.addEventListener("click", () => {
    const input = $("qrLinkInput");
    input.select();
    navigator.clipboard.writeText(input.value);
    showNotice("Link copied to clipboard!");
});

$("downloadQrBtn")?.addEventListener("click", () => {
    if (!currentQrDataUrl) return;
    const a = document.createElement("a");
    a.href = currentQrDataUrl;
    a.download = `TapNFound-Tag-${currentNfcId || "sticker"}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showNotice("Printable QR Sticker downloaded!");
});

$("printQrBtn")?.addEventListener("click", () => {
    window.print();
});

// --------------------------------------------------
// LANDING PAGE & SEARCH
// --------------------------------------------------

$("lookupButton")?.addEventListener("click", () => {
    const input = $("lookupInput");
    const id = input?.value.trim();
    if (id) {
        window.history.pushState(null, "", "/" + encodeURIComponent(id));
        loadTag(id);
    }
});

$("lookupInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        $("lookupButton").click();
    }
});

document.querySelectorAll(".tag-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
        const tag = chip.dataset.tag;
        $("lookupInput").value = tag;
        window.history.pushState(null, "", "/" + encodeURIComponent(tag));
        loadTag(tag);
    });
});

$("navHomeBtn")?.addEventListener("click", () => {
    currentNfcId = "";
    stopPolling();
    window.history.pushState(null, "", "/");
    showMainSection("landing");
});

$("navOwnerBtn")?.addEventListener("click", () => {
    if (currentUser) {
        openOwnerDashboard();
    } else {
        showAuthTab("login");
    }
});

$("backToHomeBtn")?.addEventListener("click", () => {
    currentNfcId = "";
    stopPolling();
    window.history.pushState(null, "", "/");
    showMainSection("landing");
});

$("errorRetryButton")?.addEventListener("click", () => {
    if (currentNfcId) {
        loadTag(currentNfcId);
    } else {
        window.location.href = "/";
    }
});

// --------------------------------------------------
// INITIALIZATION
// --------------------------------------------------

async function initializeApp() {
    await checkSession();

    // Parse URL for Tag ID (e.g. /101 or ?tag=101)
    const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
    const urlParams = new URLSearchParams(window.location.search);
    const queryTag = urlParams.get("tag");

    let initialTag = "";
    if (path && path !== "home" && path !== "login" && path !== "admin") {
        initialTag = path;
    } else if (queryTag) {
        initialTag = queryTag;
    }

    if (initialTag) {
        await loadTag(initialTag);
    } else {
        showMainSection("landing");
    }
}

window.addEventListener("popstate", () => {
    const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
    if (path && path !== "home" && path !== "login" && path !== "admin") {
        loadTag(path);
    } else {
        showMainSection("landing");
    }
});

initializeApp();
