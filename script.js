
const $ = (id) => document.getElementById(id);

let currentNfcId = "";
let currentRole = "";
let currentChatId = "";
let finderToken = "";
let pollTimer = null;
let selectedOwnerChat = "";

const finderStorageKey = (id) => `tnf_finder_chat_${id}`;

function notice(message, isError = false) {
    $("notice").textContent = message || "";
    $("notice").style.color = isError ? "#c62828" : "#167342";
}

function showOnly(sectionId) {
    [
        "authSection",
        "registerTagSection",
        "ownerSection",
        "finderSection",
        "errorSection"
    ].forEach((id) => {
        $(id).hidden = id !== sectionId;
    });
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

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
        throw new Error(data.error || `Request failed (${response.status})`);
    }

    return data;
}

function jsonBody(value) {
    return { body: JSON.stringify(value) };
}

function formatTime(dateString) {
    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString([], {
        dateStyle: "short",
        timeStyle: "short"
    });
}

function showError(message) {
    stopPolling();
    showOnly("errorSection");
    $("errorText").textContent = message;
}

function showLoginForm() {
    $("loginForm").hidden = false;
    $("signupForm").hidden = true;
    $("showLogin").classList.add("active");
    $("showSignup").classList.remove("active");
}

function showSignupForm() {
    $("loginForm").hidden = true;
    $("signupForm").hidden = false;
    $("showLogin").classList.remove("active");
    $("showSignup").classList.add("active");
}

$("showLogin").addEventListener("click", showLoginForm);
$("showSignup").addEventListener("click", showSignupForm);

// --------------------------------------------------
// OWNER SIGNUP AND LOGIN
// --------------------------------------------------

$("signupForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("signupForm").querySelector("button[type=submit]");
    button.disabled = true;
    notice("");

    try {
        await api("/api/auth/register", {
            method: "POST",
            ...jsonBody({
                name: $("signupName").value.trim(),
                email: $("signupEmail").value.trim(),
                password: $("signupPassword").value
            })
        });

        $("signupForm").reset();
        await initializePage();
        notice("Account created successfully.");
    } catch (error) {
        notice(error.message, true);
    } finally {
        button.disabled = false;
    }
});

$("loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("loginForm").querySelector("button[type=submit]");
    button.disabled = true;
    notice("");

    try {
        await api("/api/auth/login", {
            method: "POST",
            ...jsonBody({
                email: $("loginEmail").value.trim(),
                password: $("loginPassword").value
            })
        });

        $("loginForm").reset();
        await initializePage();
        notice("Login successful.");
    } catch (error) {
        notice(error.message, true);
    } finally {
        button.disabled = false;
    }
});

$("logoutButton").addEventListener("click", async () => {
    try {
        stopPolling();

        await api("/api/auth/logout", {
            method: "POST"
        });

        await initializePage();
        notice("You have logged out.");
    } catch (error) {
        notice(error.message, true);
    }
});

// --------------------------------------------------
// INITIAL PAGE AND ROLE DETECTION
// --------------------------------------------------


async function initializePage() {
    stopPolling();

    currentChatId = "";
    finderToken = "";
    selectedOwnerChat = "";
    currentRole = "";

    const match = window.location.pathname.match(/^\/(\d{3})\/?$/);

    if (!match) {
        currentNfcId = "";
        $("pageTitle").textContent = "Tap N Found";
        $("tagInfo").textContent = "Open a valid NFC URL such as /001.";
        showError("No valid three-digit NFC ID was found in this URL.");
        return;
    }

    currentNfcId = match[1];
    $("tagInfo").textContent = `NFC Tag ID: ${currentNfcId}`;
    $("pageTitle").textContent = "Checking your tag...";
    notice("");

    try {
        const [tagData, sessionData] = await Promise.all([
            api(`/api/nfc/${currentNfcId}`),
            api("/api/auth/me")
        ]);

        if (!tagData.registered) {
            $("pageTitle").textContent = "Register your item";

            if (sessionData.loggedIn) {
                showOnly("registerTagSection");
                return;
            }

            showOnly("authSection");
            showLoginForm();
            notice("Log in or create an owner account to register this tag.");
            return;
        }

        $("pageTitle").textContent = tagData.nfc.item;
        $("tagInfo").textContent =
            `Tag ${currentNfcId} · ${tagData.nfc.status}`;

        if (sessionData.loggedIn && tagData.role === "owner") {
            currentRole = "owner";

            $("ownerGreeting").textContent =
                `Welcome, ${sessionData.owner.name}.`;

            showOnly("ownerSection");
            await loadOwnerChats();
            return;
        }

        // Public visitors can continue to use the finder interface.
        currentRole = "finder";

        $("finderItemInfo").textContent =
            `Item: ${tagData.nfc.item}. Start a private conversation with its owner.`;

        showOnly("finderSection");
        await restoreFinderChat();

    } catch (error) {
        showError(error.message);
    }
}


// --------------------------------------------------
// REGISTER AN UNUSED NFC TAG
// --------------------------------------------------

$("registerTagForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("registerTagForm").querySelector("button[type=submit]");
    button.disabled = true;
    notice("");

    try {
        await api(`/api/nfc/${currentNfcId}/register`, {
            method: "POST",
            ...jsonBody({
                item: $("itemName").value.trim()
            })
        });

        $("registerTagForm").reset();
        await initializePage();
        notice("NFC tag registered successfully.");
    } catch (error) {
        notice(error.message, true);
    } finally {
        button.disabled = false;
    }
});

// --------------------------------------------------
// OWNER: LOAD CONVERSATIONS
// --------------------------------------------------

async function loadOwnerChats() {
    const data = await api(`/api/nfc/${currentNfcId}/chats`);

    const list = $("chatList");
    list.replaceChildren();

    if (!data.chats.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No finder messages yet.";
        list.appendChild(empty);

        $("ownerChatArea").hidden = true;
        stopPolling();
        return;
    }

    for (const chat of data.chats) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "chat-item";

        if (chat._id === selectedOwnerChat) {
            button.classList.add("selected");
        }

        const name = document.createElement("span");
        name.textContent = chat.finderName;

        const date = document.createElement("small");
        date.textContent = formatTime(chat.lastMessageAt);

        button.append(name, date);

        button.addEventListener("click", async () => {
            selectedOwnerChat = chat._id;
            currentChatId = chat._id;

            [...list.children].forEach((child) => {
                child.classList.remove("selected");
            });

            button.classList.add("selected");
            $("ownerChatTitle").textContent =
                `Chat with ${chat.finderName}`;

            $("ownerChatArea").hidden = false;

            await loadMessages("owner");
            startPolling("owner");
        });

        list.appendChild(button);
    }

    const chosen = data.chats.find(
        (chat) => chat._id === selectedOwnerChat
    ) || data.chats[0];

    selectedOwnerChat = chosen._id;
    currentChatId = chosen._id;
    $("ownerChatTitle").textContent = `Chat with ${chosen.finderName}`;
    $("ownerChatArea").hidden = false;

    await loadMessages("owner");
    startPolling("owner");
}

// --------------------------------------------------
// FINDER: CREATE OR RESTORE A CHAT
// --------------------------------------------------

async function restoreFinderChat() {
    const saved = localStorage.getItem(finderStorageKey(currentNfcId));

    if (!saved) {
        $("finderStartForm").hidden = false;
        $("finderChatArea").hidden = true;
        return;
    }

    try {
        const parsed = JSON.parse(saved);

        if (
            typeof parsed.chatId !== "string" ||
            typeof parsed.token !== "string"
        ) {
            throw new Error("Saved chat details are invalid.");
        }

        currentChatId = parsed.chatId;
        finderToken = parsed.token;

        await api(`/api/chats/${currentChatId}/messages`, {
            headers: { "x-finder-token": finderToken }
        });

        $("finderStartForm").hidden = true;
        $("finderChatArea").hidden = false;

        await loadMessages("finder");
        startPolling("finder");
    } catch (error) {
        localStorage.removeItem(finderStorageKey(currentNfcId));
        currentChatId = "";
        finderToken = "";
        $("finderStartForm").hidden = false;
        $("finderChatArea").hidden = true;
        notice(
            "Your previous chat could not be restored. You can start a new chat.",
            true
        );
    }
}

$("finderStartForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const button = $("finderStartForm").querySelector("button[type=submit]");
    button.disabled = true;
    notice("");

    try {
        const data = await api(`/api/nfc/${currentNfcId}/chats`, {
            method: "POST",
            ...jsonBody({
                finderName: $("finderName").value.trim()
            })
        });

        currentChatId = data.chat.id;
        finderToken = data.finderToken;

        // The token is a secret granting access to this finder chat.
        localStorage.setItem(
            finderStorageKey(currentNfcId),
            JSON.stringify({
                chatId: currentChatId,
                token: finderToken
            })
        );

        $("finderStartForm").hidden = true;
        $("finderChatArea").hidden = false;

        await loadMessages("finder");
        startPolling("finder");
    } catch (error) {
        notice(error.message, true);
    } finally {
        button.disabled = false;
    }
});

// --------------------------------------------------
// LOAD AND DISPLAY CHAT MESSAGES
// --------------------------------------------------

function renderMessages(containerId, messages, role) {
    const container = $(containerId);
    const wasAtBottom =
        container.scrollHeight - container.scrollTop - container.clientHeight < 50;

    container.replaceChildren();

    if (!messages.length) {
        const empty = document.createElement("p");
        empty.className = "muted";
        empty.textContent = "No messages yet. Say hello!";
        container.appendChild(empty);
        return;
    }

    for (const message of messages) {
        const bubble = document.createElement("div");
        bubble.className = "message";

        if (message.sender === role) {
            bubble.classList.add("mine");
        }

        const sender = document.createElement("span");
        sender.className = "message-sender";
        sender.textContent =
            message.sender === "owner" ? "Owner" : "Finder";

        const text = document.createElement("div");
        text.className = "message-text";
        text.textContent = message.text;

        const time = document.createElement("span");
        time.className = "message-time";
        time.textContent = formatTime(message.createdAt);

        bubble.append(sender, text, time);
        container.appendChild(bubble);
    }

    if (wasAtBottom) {
        container.scrollTop = container.scrollHeight;
    }
}

async function loadMessages(role) {
    if (!currentChatId) return;

    const options = {};

    if (role === "finder") {
        options.headers = { "x-finder-token": finderToken };
    }

    const data = await api(
        `/api/chats/${currentChatId}/messages`,
        options
    );

    if (role === "owner") {
        renderMessages("ownerMessages", data.messages, role);
    } else {
        renderMessages("finderMessages", data.messages, role);
    }
}

// --------------------------------------------------
// SEND MESSAGES
// --------------------------------------------------

async function sendMessage(role, inputId, formId) {
    const form = $(formId);
    const input = $(inputId);
    const button = form.querySelector("button[type=submit]");
    const text = input.value.trim();

    if (!text || !currentChatId) return;

    button.disabled = true;

    try {
        const options = {
            method: "POST",
            ...jsonBody({ text })
        };

        if (role === "finder") {
            options.headers = { "x-finder-token": finderToken };
        }

        await api(
            `/api/chats/${currentChatId}/messages`,
            options
        );

        input.value = "";
        await loadMessages(role);

        if (role === "owner") {
            await refreshOwnerChatList();
        }
    } catch (error) {
        notice(error.message, true);
    } finally {
        button.disabled = false;
        input.focus();
    }
}

$("ownerMessageForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage("owner", "ownerMessageInput", "ownerMessageForm");
});

$("finderMessageForm").addEventListener("submit", (event) => {
    event.preventDefault();
    sendMessage("finder", "finderMessageInput", "finderMessageForm");
});

// --------------------------------------------------
// REFRESH MESSAGES WHILE CHAT IS OPEN
// --------------------------------------------------

function startPolling(role) {
    stopPolling();

    pollTimer = setInterval(async () => {
        try {
            if (role === "owner") {
                await loadMessages("owner");
                await refreshOwnerChatList();
            } else {
                await loadMessages("finder");
            }
        } catch (error) {
            console.error("Chat refresh failed:", error.message);
        }
    }, 4000);
}

async function refreshOwnerChatList() {
    const data = await api(`/api/nfc/${currentNfcId}/chats`);

    // Refresh timestamps without rebuilding the buttons,
    // so the current chat selection stays stable.
    for (const chat of data.chats) {
        const button = [...$("chatList").children].find(
            (element) => element.querySelector("span")?.textContent === chat.finderName
        );

        if (button) {
            const date = button.querySelector("small");

            if (date) {
                date.textContent = formatTime(chat.lastMessageAt);
            }
        }
    }
}

// Start the page.
initializePage();
