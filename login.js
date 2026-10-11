
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const message = document.getElementById("message");

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    message.textContent = "";
    loginButton.disabled = true;
    loginButton.textContent = "Logging in...";

    try {
        const response = await fetch("/api/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            credentials: "same-origin",
            body: JSON.stringify({
                email: emailInput.value.trim(),
                password: passwordInput.value
            })
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || "Login failed.");
        }

        // Load the NFC items owned by this account.
        const tagsResponse = await fetch("/api/owner/tags", {
            credentials: "same-origin"
        });

        const tagsResult = await tagsResponse.json();

        if (!tagsResponse.ok) {
            throw new Error(
                tagsResult.error || "Logged in, but could not load your items."
            );
        }

        if (!tagsResult.tags || tagsResult.tags.length === 0) {
            message.textContent =
                "Login successful, but no registered items were found. Open your NFC tag page to register an item.";
            loginButton.textContent = "Logged in";
            loginButton.disabled = true;
            return;
        }

        // Open the most recently created registered item.
        const tag = tagsResult.tags[0];

        window.location.replace(
            "/" + encodeURIComponent(tag.nfcId)
        );

    } catch (error) {
        message.textContent = error.message;
        loginButton.disabled = false;
        loginButton.textContent = "Log in";
    }
});
