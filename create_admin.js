require("dotenv").config();
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const MONGODB_URI = process.env.MONGODB_URI;
const ADMIN_NAME = process.env.ADMIN_NAME || "Tap N Found Admin";
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const adminSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model("Admin", adminSchema);

async function main() {
  if (!MONGODB_URI || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error("Set MONGODB_URI, ADMIN_EMAIL and ADMIN_PASSWORD in .env before running this script.");
  }
  if (ADMIN_PASSWORD.length < 12 || ADMIN_PASSWORD.length > 72) {
    throw new Error("Use an admin password between 12 and 72 characters.");
  }
  await mongoose.connect(MONGODB_URI);
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  await Admin.findOneAndUpdate(
    { email: ADMIN_EMAIL.trim().toLowerCase() },
    { $set: { name: ADMIN_NAME, passwordHash }, $setOnInsert: { email: ADMIN_EMAIL.trim().toLowerCase() } },
    { upsert: true, new: true, runValidators: true }
  );
  console.log("Admin account created/updated. You can now sign in at /admin.");
  console.log("For safety, remove ADMIN_PASSWORD from .env after this script finishes.");
  await mongoose.disconnect();
}
main().catch(async error => {
  console.error("Could not create admin:", error.message);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(1);
});
