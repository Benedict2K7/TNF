
require("dotenv").config();

const express = require("express");
const mongoose = require("mongoose");
const session = require("express-session");
const MongoStore = require("connect-mongo").default;
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const path = require("path");
const nodemailer = require("nodemailer");

const app = express();

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;
const isProduction = process.env.NODE_ENV === "production";

if (!MONGODB_URI || !SESSION_SECRET) {
    console.error("Missing MONGODB_URI or SESSION_SECRET.");
    process.exit(1);
}

// ==================================================
// EMAIL CONFIGURATION
// ==================================================

const emailConfigured = Boolean(
    process.env.SMTP_USER && process.env.SMTP_PASS
);

const emailTransporter = emailConfigured
    ? nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    })
    : null;

// ==================================================
// MIDDLEWARE
// ==================================================

app.disable("x-powered-by");

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
    name: "tnf_owner_session",
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: MONGODB_URI,
        collectionName: "sessions",
        ttl: 7 * 24 * 60 * 60
    }),
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

const Owner = mongoose.model("Owner", ownerSchema);

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

const Admin = mongoose.model("Admin", adminSchema);

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
    item: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        default: "registered",
        enum: ["registered", "disabled"]
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

const NFC = mongoose.model("NFC", nfcSchema);

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

const Chat = mongoose.model("Chat", chatSchema);

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

const Message = mongoose.model("Message", messageSchema);

// ==================================================
// HELPERS
// ==================================================

function validNfcId(id) {
    return /^\d{3}$/.test(id);
}

function getOwnerId(req) {
    return req.session.ownerId || null;
}

function getAdminId(req) {
    return req.session.adminId || null;
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
        ownerAssigned: Boolean(tag.ownerId)
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

// ==================================================
// OWNER REGISTRATION
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

        // Start a fresh session after account creation.
        req.session.regenerate((error) => {
            if (error) {
                console.error("Session creation:", error.message);
                return res.status(500).json({
                    error: "Account created, but login session could not start. Please log in."
                });
            }

            req.session.ownerId = owner._id.toString();

            req.session.save((saveError) => {
                if (saveError) {
                    return res.status(500).json({
                        error: "Account created, but login session could not be saved. Please log in."
                    });
                }

                return res.status(201).json({
                    message: "Owner account created successfully.",
                    owner: {
                        id: owner._id,
                        name: owner.name
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

// ==================================================
// OWNER LOGIN
// ==================================================

app.post("/api/auth/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                error: "Enter your email and password."
            });
        }

        const owner = await Owner.findOne({
            email: email.trim().toLowerCase()
        });

        if (
            !owner ||
            !(await bcrypt.compare(password, owner.passwordHash))
        ) {
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
                        name: owner.name
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

// ==================================================
// CURRENT OWNER, LOGOUT AND OWNER TAGS
// ==================================================

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
                name: owner.name
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

// Used by login.js to find the owner's registered items.
app.get("/api/owner/tags", requireOwner, async (req, res) => {
    try {
        const tags = await NFC.find({
            ownerId: getOwnerId(req),
            status: "registered"
        })
            .select("nfcId ownerName item status createdAt")
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

// ==================================================
// SECURE ADMIN API
// ==================================================

app.post("/api/admin/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (
            typeof email !== "string" ||
            typeof password !== "string"
        ) {
            return res.status(400).json({
                error: "Enter admin email and password."
            });
        }

        const admin = await Admin.findOne({
            email: email.trim().toLowerCase()
        });

        if (
            !admin ||
            !(await bcrypt.compare(password, admin.passwordHash))
        ) {
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
            .select("nfcId ownerName email item status ownerId createdAt")
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
            error: "Could not load owners."
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
// NFC REGISTRATION
// ==================================================

app.post("/api/nfc/:id/register", requireOwner, async (req, res) => {
    try {
        const { id } = req.params;
        const { item } = req.body;

        if (!validNfcId(id)) {
            return res.status(400).json({
                error: "Use a three-digit NFC ID such as 001."
            });
        }

        if (
            typeof item !== "string" ||
            !item.trim() ||
            item.trim().length > 100
        ) {
            return res.status(400).json({
                error: "Enter a valid item name."
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
// PUBLIC NFC LOOKUP
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

        if (!tag || tag.status !== "registered") {
            return res.json({
                registered: false,
                nfcId: id
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

// ==================================================
// OWNER: LIST CONVERSATIONS FOR AN NFC TAG
// ==================================================

app.get("/api/nfc/:id/chats", requireOwner, async (req, res) => {
    try {
        const tag = await findOwnedTag(req, res);
        if (!tag) return;

        const chats = await Chat.find({ nfcId: tag.nfcId })
            .select("-finderTokenHash")
            .sort({ lastMessageAt: -1 })
            .lean();

        return res.json({ chats });
    } catch (error) {
        console.error("List chats:", error.message);
        return res.status(500).json({
            error: "Could not load conversations."
        });
    }
});

// ==================================================
// FINDER: CREATE A PRIVATE CONVERSATION
// ==================================================

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
                error: "Enter a nickname of up to 50 characters."
            });
        }

        const tag = await NFC.findOne({
            nfcId: id,
            status: "registered"
        });

        if (!tag) {
            return res.status(404).json({
                error: "This tag is not registered."
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

        // The finder token is shown only to the finder at creation.
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

// ==================================================
// SHARED CHAT AUTHORIZATION
// ==================================================

async function authorizeChat(req, res, chatId) {
    if (!mongoose.isValidObjectId(chatId)) {
        res.status(400).json({ error: "Invalid chat ID." });
        return null;
    }

    const chat = await Chat.findById(chatId)
        .select("+finderTokenHash");

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
        return { chat, sender: "owner" };
    }

    const token = req.get("x-finder-token");

    if (
        typeof token === "string" &&
        /^[a-f0-9]{64}$/.test(token) &&
        hashToken(token) === chat.finderTokenHash
    ) {
        return { chat, sender: "finder" };
    }

    res.status(403).json({
        error: "You are not authorized to access this conversation."
    });

    return null;
}

// ==================================================
// LOAD CHAT MESSAGES
// ==================================================

app.get("/api/chats/:chatId/messages", async (req, res) => {
    try {
        const access = await authorizeChat(
            req,
            res,
            req.params.chatId
        );

        if (!access) return;

        const messages = await Message.find({
            chatId: access.chat._id
        })
            .sort({ createdAt: 1 })
            .limit(200)
            .select("sender text createdAt")
            .lean();

        return res.json({
            chatId: access.chat._id,
            role: access.sender,
            status: access.chat.status,
            messages
        });
    } catch (error) {
        console.error("Load messages:", error.message);
        return res.status(500).json({
            error: "Could not load messages."
        });
    }
});

// ==================================================
// SEND MESSAGE + EMAIL NOTIFICATION
// ==================================================

app.post("/api/chats/:chatId/messages", async (req, res) => {
    try {
        const access = await authorizeChat(
            req,
            res,
            req.params.chatId
        );

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

        // Notify the owner when the finder sends the first message.
        if (access.sender === "finder" && emailTransporter) {
            try {
                const tag = await NFC.findOne({
                    nfcId: access.chat.nfcId,
                    ownerId: { $ne: null }
                });

                if (tag && tag.email) {
                    // Claim the notification so parallel messages
                    // do not send duplicate emails for this chat.
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
                        try {
                            await emailTransporter.sendMail({
                                from: process.env.SMTP_USER,
                                to: tag.email,
                                subject: "Your item was found!",
                                text:
`Hello ${tag.ownerName},

Someone has started a conversation about your registered item on Tap N Found.

Item: ${tag.item}
Finder name: ${access.chat.finderName}

Please log in to Tap N Found and open your item's chat dashboard to view the message and reply.

Login to Tap N Found:
https://tnf-n44q.onrender.com/

Thank you,
Tap N Found Team`,


                            });

                            console.log(
                                `Owner notification sent for NFC ${tag.nfcId}`
                            );
                        } catch (emailError) {
                            // Reset so a later finder message can retry.
                            await Chat.updateOne(
                                {
                                    _id: access.chat._id,
                                    foundEmailSentAt: { $ne: null }
                                },
                                {
                                    $set: {
                                        foundEmailSentAt: null
                                    }
                                }
                            );

                            console.error(
                                "Email sending failed:",
                                emailError.message
                            );
                        }
                    }
                }
            } catch (emailError) {
                // Email problems must not prevent chat from working.
                console.error(
                    "Owner email notification error:",
                    emailError.message
                );
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
// HEALTH CHECK
// ==================================================

app.get("/api/health", (req, res) => {
    res.json({
        status: "ok",
        message: "Tap N Found server is running."
    });
});

// ==================================================
// PAGE ROUTES
// ==================================================

// Serve assets without automatically serving index.html at "/".
app.use(express.static(__dirname, { index: false }));

// Main website opens the login page directly.
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

// Keep the existing owner/finder interface available.
app.get("/home", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// Keep the admin page.
app.get("/admin", (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

// Three-digit NFC IDs open the existing NFC interface.
app.get("/:id", (req, res, next) => {
    if (!validNfcId(req.params.id)) {
        return next();
    }

    return res.sendFile(path.join(__dirname, "index.html"));
});

// Unknown pages and endpoints.
app.use((req, res) => {
    res.status(404).json({
        error: "Page or API endpoint not found."
    });
});

// ==================================================
// START SERVER
// ==================================================

async function startServer() {
    await mongoose.connect(MONGODB_URI);

    console.log("MongoDB connected successfully.");

    if (!emailConfigured) {
        console.warn(
            "Email notifications are disabled: SMTP_USER or SMTP_PASS is missing."
        );
    }

    app.listen(PORT, () => {
        console.log(`Tap N Found server running on port ${PORT}`);
    });
}

startServer().catch((error) => {
    console.error("Server startup failed:", error.message);
    process.exit(1);
});
