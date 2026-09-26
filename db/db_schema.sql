PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS site_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'PulsePoint Wellness' CHECK(length(trim(name)) > 0),
    description TEXT NOT NULL DEFAULT 'Flexible event management for organizers and attendees' CHECK(length(trim(description)) > 0),
    display_font_family TEXT NOT NULL DEFAULT 'Barlow Condensed',
    description_italic INTEGER NOT NULL DEFAULT 0 CHECK(description_italic IN (0, 1)),
    last_modified_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours'))
);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL DEFAULT 'New Event' CHECK(length(trim(title)) > 0),
    description TEXT NOT NULL DEFAULT '' CHECK(length(trim(description)) > 0 OR status = 'draft'),
    event_date TEXT,
    event_time TEXT,
    duration_minutes INTEGER NOT NULL DEFAULT 0 CHECK(duration_minutes >= 0),
    location TEXT DEFAULT '',
    image_data TEXT,
    full_price_tickets INTEGER NOT NULL DEFAULT 0 CHECK(full_price_tickets >= 0),
    full_price_cost REAL NOT NULL DEFAULT 0.00 CHECK(full_price_cost >= 0),
    concession_tickets INTEGER NOT NULL DEFAULT 0 CHECK(concession_tickets >= 0),
    concession_cost REAL NOT NULL DEFAULT 0.00 CHECK(concession_cost >= 0),
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published')),
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    last_modified_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    published_at TEXT,
    scheduled_publish_at TEXT,
    booking_deadline TEXT,
    CHECK((status = 'draft') OR (event_date IS NOT NULL AND event_date <> ''))
);

CREATE TABLE IF NOT EXISTS organisers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Event Admin' CHECK(length(trim(name)) > 0),
    email TEXT NOT NULL UNIQUE CHECK(email LIKE '%@%'),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_login TEXT
);

CREATE TABLE IF NOT EXISTS attendees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT 'Guest Attendee' CHECK(length(trim(name)) > 0),
    email TEXT NOT NULL UNIQUE CHECK(email LIKE '%@%'),
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    last_login TEXT,
    confirmed INTEGER NOT NULL DEFAULT 0 CHECK(confirmed IN (0, 1)),
    confirmation_token TEXT
);

CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    attendee_id INTEGER,
    attendee_name TEXT NOT NULL CHECK(length(trim(attendee_name)) > 0),
    full_price_qty INTEGER NOT NULL DEFAULT 0 CHECK(full_price_qty >= 0),
    concession_qty INTEGER NOT NULL DEFAULT 0 CHECK(concession_qty >= 0),
    full_price_price_snapshot REAL NOT NULL DEFAULT 0.00 CHECK(full_price_price_snapshot >= 0),
    concession_price_snapshot REAL NOT NULL DEFAULT 0.00 CHECK(concession_price_snapshot >= 0),
    full_price_qty_snapshot INTEGER NOT NULL DEFAULT 0 CHECK(full_price_qty_snapshot >= 0),
    concession_qty_snapshot INTEGER NOT NULL DEFAULT 0 CHECK(concession_qty_snapshot >= 0),
    total_amount_paid REAL NOT NULL DEFAULT 0.00 CHECK(total_amount_paid >= 0),
    total_amount REAL NOT NULL DEFAULT 0.00 CHECK(total_amount >= 0),
    status TEXT NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed', 'cancelled')),
    booked_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    booking_reference TEXT,
    payment_name TEXT,
    payment_email TEXT,
    payment_method TEXT,
    payment_last4 TEXT,
    payment_brand TEXT,
    checked_in_at TEXT,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (attendee_id) REFERENCES attendees(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS waitlist_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id INTEGER NOT NULL,
    attendee_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting', 'promoted', 'cancelled')),
    joined_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    promoted_at TEXT,
    booking_id INTEGER,
    UNIQUE(event_id, attendee_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (attendee_id) REFERENCES attendees(id) ON DELETE CASCADE,
    FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attendee_id INTEGER NOT NULL,
    event_id INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
    UNIQUE(attendee_id, event_id),
    FOREIGN KEY (attendee_id) REFERENCES attendees(id) ON DELETE CASCADE,
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_events_status_date ON events(status, event_date);
CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_bookings_attendee_id ON bookings(attendee_id);
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_favorites_event_id ON favorites(event_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_event_status ON waitlist_entries(event_id, status, joined_at);
CREATE INDEX IF NOT EXISTS idx_waitlist_attendee ON waitlist_entries(attendee_id, status);

INSERT INTO site_settings (name, description, display_font_family, description_italic, last_modified_at)
SELECT 'PulsePoint Wellness', 'Strength, movement and recovery — built for every body.', 'Barlow Condensed', 0, datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM site_settings);

-- Demo class schedule: future-dated, published sessions for a ready-to-use studio.
INSERT INTO events (title, description, event_date, event_time, duration_minutes, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, published_at)
SELECT 'Power Circuit 45', 'A coach-led strength circuit combining compound lifts, sled work and athletic conditioning. All levels are welcome.', date('now', '+2 days'), '18:30', 45, 'Strength Lab', 18, 28.00, 6, 22.00, 'published', datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Power Circuit 45');
INSERT INTO events (title, description, event_date, event_time, duration_minutes, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, published_at)
SELECT 'Sunrise Yoga Flow', 'An energising morning vinyasa class that builds mobility, balance and calm focus before the day begins.', date('now', '+3 days'), '07:30', 60, 'Mind & Body Studio', 20, 24.00, 8, 18.00, 'published', datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Sunrise Yoga Flow');
INSERT INTO events (title, description, event_date, event_time, duration_minutes, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, published_at)
SELECT 'Ride & Rhythm', 'High-energy indoor cycling powered by interval training, immersive lighting and a motivating playlist.', date('now', '+5 days'), '19:00', 45, 'Cycle Theatre', 16, 30.00, 6, 24.00, 'published', datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Ride & Rhythm');
INSERT INTO events (title, description, event_date, event_time, duration_minutes, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, published_at)
SELECT 'HIIT Ignite', 'Short, powerful intervals blend bodyweight drills and functional equipment for a complete conditioning session.', date('now', '+7 days'), '18:00', 50, 'Performance Zone', 14, 32.00, 6, 25.00, 'published', datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'HIIT Ignite');
INSERT INTO events (title, description, event_date, event_time, duration_minutes, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, published_at)
SELECT 'Mobility Reset', 'Guided mobility, breathwork and active recovery to release tension and restore comfortable movement.', date('now', '+10 days'), '10:00', 60, 'Recovery Loft', 22, 22.00, 10, 17.00, 'published', datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Mobility Reset');
INSERT INTO events (title, description, event_date, event_time, duration_minutes, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, published_at)
SELECT 'Strength Foundations', 'Learn safe lifting technique and build confidence with squat, hinge, push and pull movement patterns.', date('now', '+14 days'), '17:30', 60, 'Strength Lab', 16, 34.00, 6, 27.00, 'published', datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Strength Foundations');
INSERT INTO events (title, description, event_date, event_time, duration_minutes, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, published_at)
SELECT 'Weekend Bootcamp', 'A team-based outdoor workout mixing speed, strength and conditioning challenges.', date('now', '+4 days'), '09:00', 75, 'Outdoor Training Deck', 0, 36.00, 0, 29.00, 'published', datetime('now', '+8 hours')
WHERE NOT EXISTS (SELECT 1 FROM events WHERE title = 'Weekend Bootcamp');
