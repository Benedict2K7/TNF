require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStoreModule = require("connect-mongo");
const MongoStore = MongoStoreModule.default || MongoStoreModule;
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const nodemailer = require("nodemailer");
const QRCode = require("qrcode");

const app = express();

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || "tnf_secret_session_key_2024";
const isProduction = process.env.NODE_ENV === "production";
const ROOT_DIR = path.resolve(__dirname);

if (!MONGODB_URI) {
    console.warn("WARNING: MONGODB_URI is not set. Database operations will fail until configured.");
}

// ==================================================
// DATABASE CONNECTION CACHE (Serverless-safe)
// ==================================================

let cachedMongoosePromise = null;

async function connectToDatabase() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (!MONGODB_URI) {
        throw new Error("MONGODB_URI is not configured in environment variables.");
    }

    if (!cachedMongoosePromise) {
        mongoose.set("strictQuery", false);
        cachedMongoosePromise = mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
            maxPoolSize: 10
        }).then((m) => {
            console.log("MongoDB connected successfully.");
            return m;
        }).catch((err) => {
            cachedMongoosePromise = null;
            console.error("MongoDB connection failed:", err.message);
            throw err;
        });
    }

    return cachedMongoosePromise;
}

// ==================================================
// EMAIL CONFIGURATION
// ==================================================

const smtpConfigured = Boolean(
    process.env.SMTP_USER && process.env.SMTP_PASS
);

const resendConfigured = Boolean(
    process.env.RESEND_API_KEY && process.env.EMAIL_FROM
);

const emailConfigured = smtpConfigured || resendConfigured;

const transporter = smtpConfigured
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    })
    : null;

if (resendConfigured) {
    console.log("Resend email configuration detected.");
} else if (smtpConfigured) {
    console.log("Gmail SMTP email configuration detected.");
} else {
    console.warn("Email notifications are not configured.");
}

async function sendNotification(to, subject, text) {
    if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
        const response = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: process.env.EMAIL_FROM,
                to: [to],
                subject,
                text
            })
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            console.error("Resend API error:", response.status, result);
            throw new Error(result.message || "The email provider could not send the email.");
        }

        console.log("Email accepted by Resend:", result.id);
        return result;
    }

    if (transporter) {
        const result = await transporter.sendMail({
            from: process.env.SMTP_USER,
            to,
            subject,
            text
        });

        console.log("Email accepted by Gmail SMTP:", result.messageId);
        return result;
    }

    throw new Error("Email is not configured. Set RESEND_API_KEY or SMTP_USER/SMTP_PASS.");
}

// ==================================================
// MIDDLEWARE
// ==================================================

app.disable("x-powered-by");
app.use(express.json({ limit: "50kb" }));
app.use(express.urlencoded({ extended: true }));

// Database connection assurance for incoming requests
app.use(async (req, res, next) => {
    // Skip db connection for static assets and health check
    if (req.path.startsWith("/api/health") || req.path.includes(".")) {
        return next();
    }
    try {
        await connectToDatabase();
        next();
    } catch (err) {
        console.error("DB connection error on route:", req.path, err.message);
        return res.status(503).json({
            error: "Database service unavailable. Please check configuration."
        });
    }
});

// Session configuration
const sessionStore = MONGODB_URI
    ? MongoStore.create({
        mongoUrl: MONGODB_URI,
        collectionName: "sessions",
        ttl: 7 * 24 * 60 * 60,
        autoRemove: "native"
    })
    : undefined;

app.use(session({
    name: "tnf_owner_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax",
        maxAge: 7 * 24 * 60 * 60 * 1000
    }
}));

// ==================================================
// DATABASE MODELS
// ==================================================

const ownerSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Owner = mongoose.models.Owner || mongoose.model("Owner", ownerSchema);

const adminSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },
    passwordHash: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Admin = mongoose.models.Admin || mongoose.model("Admin", adminSchema);

async function ensureAdminAccount() {
    try {
        const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
        const password = process.env.ADMIN_PASSWORD;
        const name = process.env.ADMIN_NAME?.trim() || "Tap N Found Admin";

        if (!email || !password) {
            // Admin variables not present, skip auto-creation safely
            return;
        }

        const existingAdmin = await Admin.findOne({ email });
        if (existingAdmin) {
            return;
        }

        const passwordHash = await bcrypt.hash(password, 12);
        await Admin.create({
            name,
            email,
            passwordHash
        });

        console.log("Initial admin account created successfully.");
    } catch (err) {
        console.warn("Admin auto-creation skipped:", err.message);
    }
}

const nfcSchema = new mongoose.Schema({
    nfcId: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    ownerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Owner",
        default: null
    },
    ownerName: {
        type: String,
        required: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },
    phone: {
        type: String,
        default: "",
        trim: true
    },
    allowWhatsApp: {
        type: Boolean,
        default: false
    },
    itemCategory: {
        type: String,
        default: "general",
        trim: true
    },
    item: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        default: "registered",
        enum: ["registered", "disabled", "lost", "found"]
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const NFC = mongoose.models.NFC || mongoose.model("NFC", nfcSchema);

const chatSchema = new mongoose.Schema({
    nfcId: {
        type: String,
        required: true,
        index: true
    },
    finderName: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
    },
    finderTokenHash: {
        type: String,
        required: true,
        select: false
    },
    status: {
        type: String,
        enum: ["active", "closed"],
        default: "active"
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    lastMessageAt: {
        type: Date,
        default: Date.now
    },
    foundEmailSentAt: {
        type: Date,
        default: null
    }
});

const Chat = mongoose.models.Chat || mongoose.model("Chat", chatSchema);

const messageSchema = new mongoose.Schema({
    chatId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Chat",
        required: true,
        index: true
    },
    sender: {
        type: String,
        enum: ["owner", "finder"],
        required: true
    },
    text: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const Message = mongoose.models.Message || mongoose.model("Message", messageSchema);

// ==================================================
// HELPERS
// ==================================================

function validNfcId(id) {
    return typeof id === "string" && /^[a-zA-Z0-9_-]{3,24}$/.test(id.trim());
}

function getOwnerId(req) {
    return req.session?.ownerId || null;
}

function getAdminId(req) {
    return req.session?.adminId || null;
}

function requireOwner(req, res, next) {
    if (!getOwnerId(req)) {
        return res.status(401).json({
            error: "Please log in as the owner first."
        });
    }
    next();
}

function requireAdmin(req, res, next) {
    if (!getAdminId(req)) {
        return res.status(401).json({
            error: "Admin login required."
        });
    }
    next();
}

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

function safeNfc(tag) {
    return {
        nfcId: tag.nfcId,
        ownerName: tag.ownerName,
        item: tag.item,
        status: tag.status,
        itemCategory: tag.itemCategory || "general",
        phone: tag.allowWhatsApp && tag.phone ? tag.phone : "",
        allowWhatsApp: Boolean(tag.allowWhatsApp && tag.phone),
        ownerAssigned: Boolean(tag.ownerId),
        createdAt: tag.createdAt
    };
}

function clearSessionCookie(res) {
    res.clearCookie("tnf_owner_session", {
        httpOnly: true,
        secure: isProduction,
        sameSite: "lax"
    });
}

async function findOwnedTag(req, res) {
    const tag = await NFC.findOne({
        nfcId: req.params.id,
        ownerId: getOwnerId(req)
    });

    if (!tag) {
        res.status(404).json({
            error: "This tag is not assigned to your account."
        });
        return null;
    }

    return tag;
}

function getBaseUrl(req) {
    if (process.env.APP_URL) {
        return process.env.APP_URL.replace(/\/+$/, "");
    }
    const host = req.get("x-forwarded-host") || req.get("host");
    const protocol = req.get("x-forwarded-proto") || req.protocol;
    return `${protocol}://${host}`;
}

// ==================================================
// OWNER AUTHENTICATION
// ==================================================

app.post("/api/auth/register", async (req, res) => {
    try {
        const { name, email, password } = req.body;

        if (
            typeof name !== "string" ||
            typeof email !== "string" ||
            typeof password !== "string" ||
            !name.trim() ||
            name.trim().length > 100 ||
            !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
            password.length < 8 ||
            password.length > 72
        ) {
            return res.status(400).json({
                error: "Enter a valid name and email. Password must be 8–72 characters."
            });
        }

        const normalizedEmail = email.trim().toLowerCase();

        if (await Owner.findOne({ email: normalizedEmail })) {
            return res.status(409).json({
                error: "An account with this email already exists."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const owner = await Owner.create({
            name: name.trim(),
            email: normalizedEmail,
            passwordHash
        });

        req.session.regenerate((error) => {
            if (error) {
                console.error("Session creation error:", error.message);
                return res.status(500).json({
                    error: "Account created, but login session could not start. Please log in."
                });
            }

            req.session.ownerId = owner._id.toString();

            req.session.save((saveError) => {
                if (saveError) {
                    return res.status(500).json({
                        error: "Account created, but session could not be saved. Please log in."
                    });
                }

                return res.status(201).json({
                    message: "Owner account created successfully.",
                    owner: {
                        id: owner._id,
                        name: owner.name,
                        email: owner.email
                    }
                });
            });
        });
    } catch (error) {
        console.error("Owner registration:", error.message);
        if (error.code === 11000) {
            return res.status(409).json({
                error: "An account with this email already exists."
            });
        }
        return res.status(500).json({
            error: "Could not create your account."
        });
    }
});

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({
                error: "Enter your email and password."
            });
        }

        const owner = await Owner.findOne({
            email: email.trim().toLowerCase()
        });

        if (!owner || !(await bcrypt.compare(password, owner.passwordHash))) {
            return res.status(401).json({
                error: "Incorrect email or password."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                return res.status(500).json({
                    error: "Could not start your session."
                });
            }

            req.session.ownerId = owner._id.toString();

            req.session.save((saveError) => {
                if (saveError) {
                    return res.status(500).json({
                        error: "Could not save your session."
                    });
                }

                return res.json({
                    message: "Login successful.",
                    owner: {
                        id: owner._id,
                        name: owner.name,
                        email: owner.email
                    }
                });
            });
        });
    } catch (error) {
        console.error("Owner login:", error.message);
        return res.status(500).json({
            error: "Login failed. Please try again."
        });
    }
});

app.get("/api/auth/me", async (req, res) => {
    try {
        if (!getOwnerId(req)) {
            return res.json({ loggedIn: false });
        }

        const owner = await Owner.findById(getOwnerId(req))
            .select("name email");

        if (!owner) {
            return req.session.destroy(() => {
                clearSessionCookie(res);
                res.json({ loggedIn: false });
            });
        }

        return res.json({
            loggedIn: true,
            owner: {
                id: owner._id,
                name: owner.name,
                email: owner.email
            }
        });
    } catch (error) {
        console.error("Check owner login:", error.message);
        return res.status(500).json({
            error: "Could not check your login."
        });
    }
});

app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                error: "Logout failed."
            });
        }
        clearSessionCookie(res);
        return res.json({ message: "Logged out successfully." });
    });
});

// ==================================================
// OWNER ITEM MANAGEMENT
// ==================================================

app.get("/api/owner/tags", requireOwner, async (req, res) => {
    try {
        const tags = await NFC.find({
            ownerId: getOwnerId(req)
        })
            .select("nfcId ownerName item status itemCategory phone allowWhatsApp createdAt")
            .sort({ createdAt: -1 })
            .lean();

        return res.json({ tags });
    } catch (error) {
        console.error("Load owner tags:", error.message);
        return res.status(500).json({
            error: "Could not load your registered items."
        });
    }
});

app.patch("/api/owner/tags/:id", requireOwner, async (req, res) => {
    try {
        const tag = await findOwnedTag(req, res);
        if (!tag) return;

        const { item, status, phone, allowWhatsApp, itemCategory } = req.body;

        if (typeof item === "string" && item.trim()) {
            tag.item = item.trim().slice(0, 100);
        }

        if (["registered", "lost", "found"].includes(status)) {
            tag.status = status;
        }

        if (typeof phone === "string") {
            tag.phone = phone.trim().slice(0, 25);
        }

        if (typeof allowWhatsApp === "boolean") {
            tag.allowWhatsApp = allowWhatsApp;
        }

        if (typeof itemCategory === "string" && itemCategory.trim()) {
            tag.itemCategory = itemCategory.trim().slice(0, 30);
        }

        await tag.save();

        return res.json({
            message: "Item updated successfully.",
            nfc: safeNfc(tag)
        });
    } catch (error) {
        console.error("Update owner tag:", error.message);
        return res.status(500).json({
            error: "Could not update item."
        });
    }
});

// ==================================================
// QR CODE GENERATION
// ==================================================

app.get("/api/nfc/:id/qr", async (req, res) => {
    try {
        const { id } = req.params;
        if (!validNfcId(id)) {
            return res.status(400).json({ error: "Invalid NFC ID format." });
        }

        const baseUrl = getBaseUrl(req);
        const targetUrl = `${baseUrl}/${encodeURIComponent(id)}`;
        const format = (req.query.format || "png").toLowerCase();

        if (format === "json") {
            const dataUrl = await QRCode.toDataURL(targetUrl, {
                width: 360,
                margin: 2,
                color: {
                    dark: "#0a192f",
                    light: "#ffffff"
                }
            });
            return res.json({
                targetUrl,
                dataUrl,
                nfcId: id
            });
        }

        if (format === "svg") {
            const svg = await QRCode.toString(targetUrl, {
                type: "svg",
                margin: 2,
                color: {
                    dark: "#0a192f",
                    light: "#ffffff"
                }
            });
            res.type("image/svg+xml").send(svg);
            return;
        }

        const buffer = await QRCode.toBuffer(targetUrl, {
            width: 400,
            margin: 2,
            color: {
                dark: "#0a192f",
                light: "#ffffff"
            }
        });

        res.type("image/png").send(buffer);
    } catch (error) {
        console.error("QR Code generation error:", error.message);
        res.status(500).json({ error: "Could not generate QR code." });
    }
});

// ==================================================
// NFC TAG LOOKUP & REGISTRATION
// ==================================================

app.get("/api/nfc/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!validNfcId(id)) {
            return res.status(400).json({
                error: "Invalid NFC ID."
            });
        }

        const tag = await NFC.findOne({ nfcId: id });

        if (!tag || tag.status === "disabled") {
            return res.json({
                registered: false,
                nfcId: id,
                disabled: tag?.status === "disabled"
            });
        }

        const isOwner =
            Boolean(getOwnerId(req)) &&
            tag.ownerId &&
            tag.ownerId.toString() === getOwnerId(req);

        return res.json({
            registered: true,
            role: isOwner ? "owner" : "finder",
            nfc: safeNfc(tag)
        });
    } catch (error) {
        console.error("NFC lookup:", error.message);
        return res.status(500).json({
            error: "Could not check this NFC tag."
        });
    }
});

app.post("/api/nfc/:id/register", requireOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { item, phone, allowWhatsApp, itemCategory } = req.body;

        if (!validNfcId(id)) {
            return res.status(400).json({
                error: "Use an NFC ID between 3 and 24 characters (letters, numbers, dashes)."
            });
        }

        if (
            typeof item !== "string" ||
            !item.trim() ||
            item.trim().length > 100
        ) {
            return res.status(400).json({
                error: "Enter a valid item name (1-100 characters)."
            });
        }

        if (await NFC.findOne({ nfcId: id })) {
            return res.status(409).json({
                error: "This NFC ID is already registered."
            });
        }

        const owner = await Owner.findById(getOwnerId(req));

        if (!owner) {
            return res.status(401).json({
                error: "Please log in again."
            });
        }

        const tag = await NFC.create({
            nfcId: id,
            ownerId: owner._id,
            ownerName: owner.name,
            email: owner.email,
            phone: typeof phone === "string" ? phone.trim().slice(0, 25) : "",
            allowWhatsApp: Boolean(allowWhatsApp),
            itemCategory: typeof itemCategory === "string" && itemCategory.trim() ? itemCategory.trim().slice(0, 30) : "general",
            item: item.trim(),
            status: "registered"
        });

        return res.status(201).json({
            message: "NFC tag registered successfully.",
            nfc: safeNfc(tag)
        });
    } catch (error) {
        console.error("NFC registration:", error.message);

        if (error.code === 11000) {
            return res.status(409).json({
                error: "This NFC ID is already registered."
            });
        }

        return res.status(500).json({
            error: "NFC registration failed."
        });
    }
});

// ==================================================
// CONVERSATIONS & CHAT
// ==================================================

app.get("/api/nfc/:id/chats", requireOwner, async (req, res) => {
    try {
        const tag = await findOwnedTag(req, res);
        if (!tag) return;

        const chats = await Chat.find({ nfcId: req.params.id })
            .select("nfcId finderName status createdAt lastMessageAt")
            .sort({ lastMessageAt: -1 })
            .lean();

        return res.json({ chats });
    } catch (error) {
        console.error("Load chats:", error.message);
        return res.status(500).json({
            error: "Could not load conversations."
        });
    }
});

app.post("/api/nfc/:id/chats", async (req, res) => {
    try {
        const { id } = req.params;
        const { finderName } = req.body;

        if (!validNfcId(id)) {
            return res.status(400).json({
                error: "Invalid NFC ID."
            });
        }

        if (
            typeof finderName !== "string" ||
            !finderName.trim() ||
            finderName.trim().length > 50
        ) {
            return res.status(400).json({
                error: "Enter a name or nickname of up to 50 characters."
            });
        }

        const tag = await NFC.findOne({
            nfcId: id,
            status: { $in: ["registered", "lost"] }
        });

        if (!tag) {
            return res.status(404).json({
                error: "This tag is not registered or currently active."
            });
        }

        if (!tag.ownerId) {
            return res.status(409).json({
                error: "This tag must be assigned to an owner before chat can be used."
            });
        }

        if (getOwnerId(req) === tag.ownerId.toString()) {
            return res.status(400).json({
                error: "You are the owner. Open your owner chat dashboard."
            });
        }

        const finderToken = crypto.randomBytes(32).toString("hex");

        const chat = await Chat.create({
            nfcId: id,
            finderName: finderName.trim(),
            finderTokenHash: hashToken(finderToken)
        });

        return res.status(201).json({
            message: "Chat created.",
            chat: {
                id: chat._id,
                nfcId: chat.nfcId,
                finderName: chat.finderName,
                status: chat.status
            },
            finderToken
        });
    } catch (error) {
        console.error("Create chat:", error.message);
        return res.status(500).json({
            error: "Could not start a conversation."
        });
    }
});

async function authorizeChat(req, res, chatId) {
    if (!mongoose.isValidObjectId(chatId)) {
        res.status(400).json({ error: "Invalid chat ID." });
        return null;
    }

    const chat = await Chat.findById(chatId).select("+finderTokenHash");

    if (!chat) {
        res.status(404).json({
            error: "Conversation not found."
        });
        return null;
    }

    const tag = await NFC.findOne({ nfcId: chat.nfcId });

    if (!tag || !tag.ownerId) {
        res.status(404).json({
            error: "Tag or owner not found."
        });
        return null;
    }

    if (getOwnerId(req) === tag.ownerId.toString()) {
        return { chat, sender: "owner", tag };
    }

    const token = req.get("x-finder-token");

    if (
        typeof token === "string" &&
        /^[a-f0-9]{64}$/.test(token) &&
        hashToken(token) === chat.finderTokenHash
    ) {
        return { chat, sender: "finder", tag };
    }

    res.status(403).json({
        error: "You are not authorized to access this conversation."
    });

    return null;
}

app.get("/api/chats/:chatId/messages", async (req, res) => {
    try {
        const access = await authorizeChat(req, res, req.params.chatId);
        if (!access) return;

        const messages = await Message.find({ chatId: access.chat._id })
            .select("sender text createdAt")
            .sort({ createdAt: 1 })
            .lean();

        return res.json({
            messages,
            chatStatus: access.chat.status
        });
    } catch (error) {
        console.error("Load messages:", error.message);
        return res.status(500).json({
            error: "Could not load messages."
        });
    }
});

app.post("/api/chats/:chatId/messages", async (req, res) => {
    try {
        const access = await authorizeChat(req, res, req.params.chatId);
        if (!access) return;

        if (access.chat.status !== "active") {
            return res.status(403).json({
                error: "This conversation is closed."
            });
        }

        const { text: messageText } = req.body;

        if (
            typeof messageText !== "string" ||
            !messageText.trim() ||
            messageText.trim().length > 1000
        ) {
            return res.status(400).json({
                error: "Messages must contain 1–1000 characters."
            });
        }

        const message = await Message.create({
            chatId: access.chat._id,
            sender: access.sender,
            text: messageText.trim()
        });

        access.chat.lastMessageAt = new Date();
        await access.chat.save();

        // Notify the owner when the finder starts or replies
        if (access.sender === "finder") {
            try {
                const tag = access.tag || await NFC.findOne({ nfcId: access.chat.nfcId });
                if (tag && tag.email) {
                    const claim = await Chat.updateOne(
                        {
                            _id: access.chat._id,
                            foundEmailSentAt: null
                        },
                        {
                            $set: {
                                foundEmailSentAt: new Date()
                            }
                        }
                    );

                    if (claim.modifiedCount === 1) {
                        const baseUrl = getBaseUrl(req);
                        sendNotification(
                            tag.email,
                            `[Tap N Found] Someone found your ${tag.item}!`,
                            `Hello ${tag.ownerName},

A finder named "${access.chat.finderName}" just sent you a message about your registered item (${tag.item}) on Tap N Found!

Message:
"${messageText.trim()}"

Log in to reply securely:
${baseUrl}/

Best regards,
The Tap N Found Team`
                        ).catch((err) => {
                            console.error("Email notification delivery error:", err.message);
                        });
                    }
                }
            } catch (err) {
                console.error("Notification process error:", err.message);
            }
        }

        return res.status(201).json({
            message: {
                id: message._id,
                sender: message.sender,
                text: message.text,
                createdAt: message.createdAt
            }
        });
    } catch (error) {
        console.error("Send message:", error.message);
        return res.status(500).json({
            error: "Could not send message."
        });
    }
});

// ==================================================
// ADMIN CONSOLE APIS
// ==================================================

app.post("/api/admin/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (typeof email !== "string" || typeof password !== "string") {
            return res.status(400).json({
                error: "Enter admin email and password."
            });
        }

        const admin = await Admin.findOne({
            email: email.trim().toLowerCase()
        });

        if (!admin || !(await bcrypt.compare(password, admin.passwordHash))) {
            return res.status(401).json({
                error: "Incorrect admin email or password."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                return res.status(500).json({
                    error: "Could not start admin session."
                });
            }

            req.session.adminId = admin._id.toString();

            req.session.save((saveError) => {
                if (saveError) {
                    return res.status(500).json({
                        error: "Could not save admin session."
                    });
                }

                return res.json({
                    loggedIn: true,
                    admin: {
                        id: admin._id,
                        name: admin.name,
                        email: admin.email
                    }
                });
            });
        });
    } catch (error) {
        console.error("Admin login:", error.message);
        return res.status(500).json({
            error: "Admin login failed."
        });
    }
});

app.get("/api/admin/me", async (req, res) => {
    try {
        if (!getAdminId(req)) {
            return res.json({ loggedIn: false });
        }

        const admin = await Admin.findById(getAdminId(req))
            .select("name email");

        if (!admin) {
            return req.session.destroy(() => {
                clearSessionCookie(res);
                res.json({ loggedIn: false });
            });
        }

        return res.json({ loggedIn: true, admin });
    } catch (error) {
        console.error("Check admin session:", error.message);
        return res.status(500).json({
            error: "Could not check admin session."
        });
    }
});

app.post("/api/admin/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            return res.status(500).json({
                error: "Admin logout failed."
            });
        }
        clearSessionCookie(res);
        return res.json({ message: "Admin logged out." });
    });
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
        const [
            owners,
            tags,
            chats,
            messages,
            activeChats,
            disabledTags
        ] = await Promise.all([
            Owner.countDocuments(),
            NFC.countDocuments(),
            Chat.countDocuments(),
            Message.countDocuments(),
            Chat.countDocuments({ status: "active" }),
            NFC.countDocuments({ status: "disabled" })
        ]);

        return res.json({
            owners,
            tags,
            chats,
            messages,
            activeChats,
            disabledTags
        });
    } catch (error) {
        console.error("Admin stats:", error.message);
        return res.status(500).json({
            error: "Could not load dashboard statistics."
        });
    }
});

app.get("/api/admin/tags", requireAdmin, async (req, res) => {
    try {
        const q = typeof req.query.q === "string"
            ? req.query.q.trim().slice(0, 100)
            : "";

        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const filter = q ? {
            $or: [
                { nfcId: { $regex: escaped, $options: "i" } },
                { ownerName: { $regex: escaped, $options: "i" } },
                { item: { $regex: escaped, $options: "i" } }
            ]
        } : {};

        const tags = await NFC.find(filter)
            .select("nfcId ownerName email item status ownerId createdAt phone allowWhatsApp")
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        return res.json({ tags });
    } catch (error) {
        console.error("Admin tags:", error.message);
        return res.status(500).json({
            error: "Could not load NFC tags."
        });
    }
});

app.patch("/api/admin/tags/:id/status", requireAdmin, async (req, res) => {
    try {
        const { status } = req.body;

        if (!["registered", "disabled"].includes(status)) {
            return res.status(400).json({
                error: "Status must be registered or disabled."
            });
        }

        const tag = await NFC.findOneAndUpdate(
            { nfcId: req.params.id },
            { $set: { status } },
            { new: true }
        ).select("nfcId ownerName item status");

        if (!tag) {
            return res.status(404).json({
                error: "NFC tag not found."
            });
        }

        return res.json({
            message: `Tag ${status}.`,
            tag
        });
    } catch (error) {
        console.error("Admin update tag:", error.message);
        return res.status(500).json({
            error: "Could not update tag status."
        });
    }
});

app.get("/api/admin/owners", requireAdmin, async (req, res) => {
    try {
        const q = typeof req.query.q === "string"
            ? req.query.q.trim().slice(0, 100)
            : "";

        const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

        const filter = q ? {
            $or: [
                { name: { $regex: escaped, $options: "i" } },
                { email: { $regex: escaped, $options: "i" } }
            ]
        } : {};

        const owners = await Owner.find(filter)
            .select("name email createdAt")
            .sort({ createdAt: -1 })
            .limit(200)
            .lean();

        return res.json({ owners });
    } catch (error) {
        console.error("Admin owners:", error.message);
        return res.status(500).json({
            error: "Could not load owner accounts."
        });
    }
});

app.get("/api/admin/chats", requireAdmin, async (req, res) => {
    try {
        const chats = await Chat.find()
            .select("nfcId finderName status createdAt lastMessageAt")
            .sort({ lastMessageAt: -1 })
            .limit(200)
            .lean();

        return res.json({ chats });
    } catch (error) {
        console.error("Admin chats:", error.message);
        return res.status(500).json({
            error: "Could not load conversations."
        });
    }
});

// ==================================================
// HEALTH CHECK
// ==================================================

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        service: "Tap N Found API",
        time: new Date().toISOString(),
        database: mongoose.connection.readyState === 1 ? "connected" : "connecting",
        email: emailConfigured ? "configured" : "not configured"
    });
});

// ==================================================
// STATIC ASSETS & FRONTEND ROUTES
// ==================================================

app.use(express.static(ROOT_DIR, { index: false }));

app.get("/", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/home", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.get("/login", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "login.html"));
});

app.get("/admin", (req, res) => {
    res.sendFile(path.join(ROOT_DIR, "admin.html"));
});

// Specific Tag ID routing (e.g., /101, /keys-1)
app.get("/:id", (req, res, next) => {
    if (!validNfcId(req.params.id)) {
        return next();
    }
    return res.sendFile(path.join(ROOT_DIR, "index.html"));
});

app.use((req, res) => {
    res.status(404).json({
        error: "Page or API endpoint not found."
    });
});

// ==================================================
// SERVER INITIALIZATION
// ==================================================

async function startServer() {
    try {
        await connectToDatabase();
        await ensureAdminAccount();

        app.listen(PORT, () => {
            console.log(`Tap N Found running on http://localhost:${PORT}`);
        });
    } catch (error) {
        console.error("Server startup error:", error.message);
    }
}

// Export for Vercel serverless runtime
module.exports = app;

// Run standalone server when executed directly with node
if (require.main === module && !process.env.VERCEL) {
    startServer();
}
