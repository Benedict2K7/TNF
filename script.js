// ==================================================
// TAP N FOUND — NFC REGISTRATION AND CHAT
// Login UI removed; account creation retained.
// ==================================================

const $ = (id) => document.getElementById(id);

let currentNfcId = "";
let currentRole = "";
let currentChatId = "";
let finderToken = "";
let pollTimer = null;
let selectedOwnerChat = "";

const finderStorageKey = (id) => `tnf_finder_chat_${id}`;

// --------------------------------------------------
// NOTIFICATIONS AND PAGE SECTIONS
// --------------------------------------------------

function notice(message, isError = false) {
    const element = $("notice");
    if (!element) return;

    element.textContent = message || "";
    element.style.color = isError ? "#c62828" : "#167342";
}

function showOnly(sectionId) {
    [
        "authSection",
        "registerTagSection",
        "ownerSection",
        "finderSection",
        "errorSection"
    ].forEach((id) => {
        const section = $(id);
        if (section) {
            section.hidden = id !== sectionId;
        }
    });
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

function showError(message) {
    stopPolling();
    showOnly("errorSection");

    const errorText = $("errorText");
    if (errorText) errorText.textContent = message;
}

// --------------------------------------------------
// API HELPERS
// --------------------------------------------------

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body
                ? { "Content-Type": "application/json" }
                : {}),
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(
            data.error || `Request failed (${response.status})`
        );
    }

    return data;
}

function jsonBody(value) {
    return {
        body: JSON.stringify(value)
    };
}

function formatTime(dateString) {
    if (!dateString) return "";

    const date = new Date(dateString);

    if (Number.isNaN(date.getTime())) return "";

    return date.toLocaleString([], {
        dateStyle: "short",
        timeStyle: "short"
    });
}

// --------------------------------------------------
// OWNER ACCOUNT CREATION
// No login form or login-button handlers.
// --------------------------------------------------

const signupForm = $("signupForm");

if (signupForm) {
    signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = signupForm.querySelector(
            'button[type="submit"]'
        );

        if (button) button.disabled = true;
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

            signupForm.reset();

            notice("Account created successfully.");

            // Refresh page state after account creation.
            await initializePage();
        } catch (error) {
            notice(error.message, true);
        } finally {
            if (button) button.disabled = false;
        }
    });
}

// --------------------------------------------------
// INITIAL PAGE AND ROLE DETECTION
// --------------------------------------------------

async function initializePage() {
    stopPolling();

    currentChatId = "";
    finderToken = "";
    selectedOwnerChat = "";
    currentRole = "";

    const match = window.location.pathname.match(
        /^\/(\d{3})\/?$/
    );

    if (!match) {
        currentNfcId = "";

        if ($("pageTitle")) {
            $("pageTitle").textContent = "Tap N Found";
        }

        if ($("tagInfo")) {
            $("tagInfo").textContent =
                "Open a valid NFC URL such as /001.";
        }

        showError(
            "No valid three-digit NFC ID was found in this URL."
        );

        return;
    }

    currentNfcId = match[1];

    $("tagInfo").textContent = `NFC Tag ID: ${currentNfcId}`;
    $("pageTitle").textContent = "Checking your tag...";
    notice("");

    try {
        // First retrieve the NFC tag.
        const tagData = await api(
            `/api/nfc/${currentNfcId}`
        );

        // A visitor without a session should still be able to
        // access the public finder interface.
        let sessionData = {
            loggedIn: false,
            owner: null
        };

        try {
            sessionData = await api("/api/auth/me");
        } catch (error) {
            console.info("No active owner session.");
        }

        // Unregistered tag.
        if (!tagData.registered) {
            $("pageTitle").textContent = "Register your item";

            if (sessionData.loggedIn) {
                showOnly("registerTagSection");
                return;
            }

            // Login UI has been removed.
            // Display account creation instead.
            showOnly("authSection");

            notice(
                "Create an owner account to continue registering this tag."
            );

            return;
        }

        if (!tagData.nfc) {
            throw new Error(
                "The server did not return NFC tag details."
            );
        }

        $("pageTitle").textContent =
            tagData.nfc.item || "Registered item";

        $("tagInfo").textContent =
            `Tag ${currentNfcId} · ${tagData.nfc.status || "registered"}`;

        // Registered tag opened by its owner.
        if (
            sessionData.loggedIn &&
            tagData.role === "owner"
        ) {
            currentRole = "owner";

            $("ownerGreeting").textContent =
                `Welcome, ${sessionData.owner?.name || "Owner"}.`;

            showOnly("ownerSection");

            await loadOwnerChats();
            return;
        }

        // Registered tag opened by a finder.
        currentRole = "finder";

        $("finderItemInfo").textContent =
            `Item: ${tagData.nfc.item || "Registered item"}. ` +
            "Start a private conversation with its owner.";

        showOnly("finderSection");

        await restoreFinderChat();

    } catch (error) {
        showError(error.message);
    }
}

// --------------------------------------------------
// REGISTER AN UNUSED NFC TAG
// --------------------------------------------------

const registerTagForm = $("registerTagForm");

if (registerTagForm) {
    registerTagForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = registerTagForm.querySelector(
            'button[type="submit"]'
        );

        if (button) button.disabled = true;
        notice("");

        try {
            await api(
                `/api/nfc/${currentNfcId}/register`,
                {
                    method: "POST",
                    ...jsonBody({
                        item: $("itemName").value.trim()
                    })
                }
            );

            registerTagForm.reset();

            notice("NFC tag registered successfully.");

            await initializePage();

        } catch (error) {
            notice(error.message, true);
        } finally {
            if (button) button.disabled = false;
        }
    });
}

// --------------------------------------------------
// OWNER: LOAD CONVERSATIONS
// --------------------------------------------------

async function loadOwnerChats() {
    const data = await api(
        `/api/nfc/${currentNfcId}/chats`
    );

    const chats = Array.isArray(data.chats)
        ? data.chats
        : [];

    const list = $("chatList");
    list.replaceChildren();

    if (chats.length === 0) {
        const empty = document.createElement("p");

        empty.className = "muted";
        empty.textContent = "No finder messages yet.";

        list.appendChild(empty);

        $("ownerChatArea").hidden = true;
        stopPolling();

        return;
    }

    for (const chat of chats) {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "chat-item";
        button.dataset.chatId = chat._id;

        if (chat._id === selectedOwnerChat) {
            button.classList.add("selected");
        }

        const name = document.createElement("span");
        name.textContent = chat.finderName || "Finder";

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
                `Chat with ${chat.finderName || "Finder"}`;

            $("ownerChatArea").hidden = false;

            try {
                await loadMessages("owner");
                startPolling("owner");
            } catch (error) {
                notice(error.message, true);
            }
        });

        list.appendChild(button);
    }

    const chosen =
        chats.find((chat) => chat._id === selectedOwnerChat) ||
        chats[0];

    selectedOwnerChat = chosen._id;
    currentChatId = chosen._id;

    $("ownerChatTitle").textContent =
        `Chat with ${chosen.finderName || "Finder"}`;

    $("ownerChatArea").hidden = false;

    await loadMessages("owner");
    startPolling("owner");
}

// --------------------------------------------------
// FINDER: RESTORE AN EXISTING CHAT
// --------------------------------------------------

async function restoreFinderChat() {
    const saved = localStorage.getItem(
        finderStorageKey(currentNfcId)
    );

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

        await api(
            `/api/chats/${currentChatId}/messages`,
            {
                headers: {
                    "x-finder-token": finderToken
                }
            }
        );

        $("finderStartForm").hidden = true;
        $("finderChatArea").hidden = false;

        await loadMessages("finder");
        startPolling("finder");

    } catch (error) {
        localStorage.removeItem(
            finderStorageKey(currentNfcId)
        );

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

// --------------------------------------------------
// FINDER: START A NEW CHAT
// --------------------------------------------------

const finderStartForm = $("finderStartForm");

if (finderStartForm) {
    finderStartForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const button = finderStartForm.querySelector(
            'button[type="submit"]'
        );

        if (button) button.disabled = true;
        notice("");

        try {
            const data = await api(
                `/api/nfc/${currentNfcId}/chats`,
                {
                    method: "POST",
                    ...jsonBody({
                        finderName: $("finderName").value.trim()
                    })
                }
            );

            if (!data.chat?.id || !data.finderToken) {
                throw new Error(
                    "The server did not return the chat details."
                );
            }

            currentChatId = data.chat.id;
            finderToken = data.finderToken;

            // Store the finder chat access token locally.
            localStorage.setItem(
                finderStorageKey(currentNfcId),
                JSON.stringify({
                    chatId: currentChatId,
                    token: finderToken
                })
            );

            finderStartForm.hidden = true;
            $("finderChatArea").hidden = false;

            await loadMessages("finder");
            startPolling("finder");

        } catch (error) {
            notice(error.message, true);
        } finally {
            if (button) button.disabled = false;
        }
    });
}

// --------------------------------------------------
// LOAD AND DISPLAY MESSAGES
// --------------------------------------------------

function renderMessages(containerId, messages, role) {
    const container = $(containerId);

    const wasAtBottom =
        container.scrollHeight -
        container.scrollTop -
        container.clientHeight < 50;

    container.replaceChildren();

    if (!Array.isArray(messages) || messages.length === 0) {
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
        text.textContent = message.text || "";

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
        options.headers = {
            "x-finder-token": finderToken
        };
    }

    const data = await api(
        `/api/chats/${currentChatId}/messages`,
        options
    );

    if (role === "owner") {
        renderMessages(
            "ownerMessages",
            data.messages,
            role
        );
    } else {
        renderMessages(
            "finderMessages",
            data.messages,
            role
        );
    }
}

// --------------------------------------------------
// SEND MESSAGES
// --------------------------------------------------

async function sendMessage(role, inputId, formId) {
    const form = $(formId);
    const input = $(inputId);
    const button = form.querySelector(
        'button[type="submit"]'
    );

    const text = input.value.trim();

    if (!text || !currentChatId) return;

    if (button) button.disabled = true;

    try {
        const options = {
            method: "POST",
            ...jsonBody({ text })
        };

        if (role === "finder") {
            options.headers = {
                "x-finder-token": finderToken
            };
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
        if (button) button.disabled = false;
        input.focus();
    }
}

const ownerMessageForm = $("ownerMessageForm");

if (ownerMessageForm) {
    ownerMessageForm.addEventListener("submit", (event) => {
        event.preventDefault();

        sendMessage(
            "owner",
            "ownerMessageInput",
            "ownerMessageForm"
        );
    });
}

const finderMessageForm = $("finderMessageForm");

if (finderMessageForm) {
    finderMessageForm.addEventListener("submit", (event) => {
        event.preventDefault();

        sendMessage(
            "finder",
            "finderMessageInput",
            "finderMessageForm"
        );
    });
}

// --------------------------------------------------
// CHAT POLLING
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
            console.error(
                "Chat refresh failed:",
                error.message
            );
        }
    }, 4000);
}

// --------------------------------------------------
// REFRESH OWNER CHAT TIMESTAMPS
// --------------------------------------------------

async function refreshOwnerChatList() {
    const data = await api(
        `/api/nfc/${currentNfcId}/chats`
    );

    const chats = Array.isArray(data.chats)
        ? data.chats
        : [];

    const buttons = [...$("chatList").children];

    for (const chat of chats) {
        const button = buttons.find(
            (element) => element.dataset.chatId === chat._id
        );

        if (button) {
            const date = button.querySelector("small");

            if (date) {
                date.textContent = formatTime(chat.lastMessageAt);
            }
        }
    }
}

// --------------------------------------------------
// START THE APPLICATION
// --------------------------------------------------

initializePage();