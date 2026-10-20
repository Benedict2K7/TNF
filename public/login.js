const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const loginButton = document.getElementById("loginButton");
const message = document.getElementById("message");

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    message.textContent = "";
    message.style.color = "#dc2626";
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

        message.style.color = "#16a34a";
        message.textContent = "Login successful! Redirecting...";

        // Redirect to main portal / dashboard
        setTimeout(() => {
            window.location.replace("/");
        }, 500);

    } catch (error) {
        message.textContent = error.message;
        loginButton.disabled = false;
        loginButton.textContent = "Log in";
    }
});
