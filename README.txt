# Tap N Found Admin Dashboard

## Files
- `server.js`: replacement backend based on the supplied server.js, with protected admin APIs.
- `admin.html`, `admin.css`, `admin.js`: admin login and dashboard UI.
- `create-admin.js`: private setup script to create/update the admin account in MongoDB.

## Setup
1. Back up your current `server.js`.
2. Replace it with this `server.js`.
3. Copy `admin.html`, `admin.css`, `admin.js`, and `create-admin.js` into the same folder as `server.js`.
4. Ensure the existing packages are installed: `express`, `mongoose`, `dotenv`, `express-session`, `connect-mongo`, and `bcryptjs`.
5. Temporarily add these to `.env` (use your own strong password):
   - `ADMIN_NAME=Tap N Found Admin`
   - `ADMIN_EMAIL=your-admin-email@example.com`
   - `ADMIN_PASSWORD=use-a-unique-password-at-least-12-characters`
6. Run `node create-admin.js` once. It stores only a bcrypt password hash in MongoDB.
7. Remove the `ADMIN_PASSWORD` line from `.env` after the script completes. Keep `ADMIN_NAME` and `ADMIN_EMAIL` only if you want; they are not needed for normal login.
8. Restart the server with `node server.js`.
9. Open `http://localhost:5000/admin` and sign in.

## Admin features
- Overview statistics: owners, tags, chats, messages, active chats and disabled tags.
- Search NFC tags by tag ID, owner name or item.
- Disable or reactivate NFC tags. A disabled tag cannot start a new finder chat because the existing chat route checks for `status === "registered"`.
- Search and view owner account details.
- View conversation metadata only. Private message contents are not exposed to admins by these routes.

## Important
- Never add a public admin registration route.
- Do not commit `.env` or share it in screenshots.
- Use HTTPS and a strong unique admin password before deploying publicly.
- The admin UI and API are served by this Express server, so `/admin` is intended to be opened on the backend host.
