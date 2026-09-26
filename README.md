# PulsePoint Wellness

PulsePoint Wellness is an Express.js, EJS, and SQLite fitness-studio class manager with separate organiser and attendee experiences. It has been tested with Node.js 20 and Node.js 24 (minimum Node.js 16 and npm 8).

## Setup

```bash
npm install
npm run build-db
npm run start
```

Open `http://localhost:3000`.

The database is generated at `db/eventflow.db` from `db/db_schema.sql` and must not be included in the submitted ZIP.

## Demonstration accounts

- Organiser: `organiser@example.com` / `EventFlow123!`
- Attendee: `attendee@example.com` / `EventFlow123!`

These credentials are for local coursework demonstration only.

## Tests

```bash
npm test
```

Tests use a separate temporary SQLite database and cover authentication, validation, save-and-publish behaviour, optional photos, booking safety, historical prices, cancellation, and cascade deletion.

## Libraries

- `express`: HTTP server and route middleware
- `ejs`: server-side HTML templates
- `sqlite3`: SQLite database access
- `bcryptjs`: portable password hashing without native build requirements
- `express-session`: session-based authentication
- `qrcode`: booking-confirmation QR images
- `supertest` (development only): automated HTTP endpoint testing

## Main routes

- `GET /`: main home page
- `GET /organiser`: organiser home page
- `POST /organiser/events/create-draft`: create a draft and open its editor
- `GET /organiser/events/:id/edit`: edit an event
- `POST /organiser/events/:id/update`: save event changes
- `POST /organiser/events/:id/publish`: publish a valid draft
- `POST /organiser/events/:id/delete`: delete an event
- `GET /settings`: site settings
- `GET /attendee`: attendee home page
- `GET /attendee/events/:id`: attendee event and booking page
- `POST /attendee/events/:id/book`: create a protected booking
- `POST /attendee/events/:id/wishlist`: save an event to the signed-in attendee's wishlist
- `POST /attendee/events/:id/wishlist/remove`: remove a saved event

## Server-side extensions

- organiser and attendee authentication
- simulated attendee confirmation flow
- transactional inventory and cancellation
- immutable booking price and total snapshots
- scheduled publication with server-side validation
- save-and-publish flow that validates the organiser's current form values
- optional organiser event photos displayed on attendee listings and event pages
- booking references and QR confirmation
- attendee booking dashboard and calendar
- attendee-controlled wishlists shown on event listings and the attendee dashboard
- organiser wishlist-interest counts for class planning (organisers cannot alter attendee wishlists)
- confirmed-occupancy trending classes that exclude events with zero ticket sales
- organiser booking management, revenue analytics, and CSV export
- configurable server-enforced booking deadlines
- duplicate-safe waitlists with transactional automatic promotion after cancellation
- QR/reference attendee check-in with cancelled and duplicate check-in prevention

Payment and account confirmation are simulations for coursework demonstration. No real payment is processed and no email is sent.

`express-session` uses its default in-memory store for simple local assessment. A persistent production session store would be required for a real deployment. Set `SESSION_SECRET` in production; a local fallback is provided so the marker can run the application with the required commands.

## Submission packaging

The final source ZIP must include the source, views, public assets, tests, `package.json`, `package-lock.json`, `db/db_schema.sql`, and `db/build_db.js`.

Do not include `node_modules`, any `.db` file, `__MACOSX`, `.DS_Store`, logs, caches, or temporary files.
