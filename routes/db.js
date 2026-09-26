const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Uses immutable booking snapshots for new rows and current event prices only for legacy rows
// that predate the snapshot columns.
const bookingAmountSql = `CASE
    WHEN b.full_price_qty_snapshot = b.full_price_qty
     AND b.concession_qty_snapshot = b.concession_qty
    THEN b.total_amount_paid
    ELSE (b.full_price_qty * e.full_price_cost + b.concession_qty * e.concession_cost)
END`;

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'db', 'eventflow.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Could not connect to database:', err.message);
        return;
    }

    console.log('Connected to SQLite database.');
    enableForeignKeys((pragmaErr) => {
        if (pragmaErr) {
            console.error('Could not enable foreign key enforcement:', pragmaErr.message);
        }
    });

    ensureBookingStatusColumn();
    ensureOrganiserLastLoginColumn();
    ensureEventDurationColumn();
    ensureEventImageColumn();
    ensureEventSchedulePublishColumn();
    ensureEventBookingDeadlineColumn();
    ensureSiteSettingsColumns();
    ensureAttendeesTable();
    ensureAttendeeColumns();
    ensureBookingAttendeeColumn();
    ensureBookingDetailsColumns();
    ensureFavoritesTable();
    ensureBookingSnapshotColumns();
    ensureBookingCheckInColumn();
    ensureWaitlistTable();
});

// Purpose: Enables referential-integrity checks for this SQLite connection.
// Inputs: Completion callback. Outputs: Reports whether the PRAGMA succeeded.
function enableForeignKeys(callback) {
    db.run('PRAGMA foreign_keys = ON', callback);
}

// Purpose: Migrates legacy databases to include booking status.
// Inputs: None. Outputs: Adds the column when missing and logs the outcome.
function ensureBookingStatusColumn() {
    db.all('PRAGMA table_info(bookings)', [], (err, rows) => {
        if (err || !rows) return;
        const hasStatus = rows.some((column) => column.name === 'status');
        if (!hasStatus) {
            db.run(
                "ALTER TABLE bookings ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'",
                (alterErr) => {
                    if (alterErr) {
                        console.error('Could not add bookings.status column:', alterErr.message);
                    } else {
                        console.log('Added missing bookings.status column.');
                    }
                }
            );
        }
    });
}

// Purpose: Adds organiser last-login tracking to legacy databases.
// Inputs: None. Outputs: Adds the column when missing.
function ensureOrganiserLastLoginColumn() {
    db.all('PRAGMA table_info(organisers)', [], (err, rows) => {
        if (err || !rows) return;
        const hasLastLogin = rows.some((column) => column.name === 'last_login');
        if (!hasLastLogin) {
            db.run(
                "ALTER TABLE organisers ADD COLUMN last_login TEXT",
                (alterErr) => {
                    if (alterErr) {
                        console.error('Could not add organisers.last_login column:', alterErr.message);
                    } else {
                        console.log('Added missing organisers.last_login column.');
                    }
                }
            );
        }
    });
}

// Purpose: Adds event duration to legacy databases.
// Inputs: None. Outputs: Adds the non-negative duration column when missing.
function ensureEventDurationColumn() {
    db.all('PRAGMA table_info(events)', [], (err, rows) => {
        if (err || !rows) return;
        const hasDuration = rows.some((column) => column.name === 'duration_minutes');
        if (!hasDuration) {
            db.run(
                "ALTER TABLE events ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0",
                (alterErr) => {
                    if (alterErr) {
                        console.error('Could not add events.duration_minutes column:', alterErr.message);
                    } else {
                        console.log('Added missing events.duration_minutes column.');
                    }
                }
            );
        }
    });
}

// Purpose: Adds optional event-photo storage to databases created before the photo extension.
// Inputs: None. Outputs: Adds events.image_data when it is missing.
function ensureEventImageColumn() {
    db.all('PRAGMA table_info(events)', [], (err, rows) => {
        if (err || !rows) return;
        if (!rows.some((column) => column.name === 'image_data')) {
            db.run('ALTER TABLE events ADD COLUMN image_data TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add events.image_data column:', alterErr.message);
                else console.log('Added missing events.image_data column.');
            });
        }
    });
}

// Purpose: Adds scheduled publication support to legacy databases.
// Inputs: None. Outputs: Adds the schedule timestamp column when missing.
function ensureEventSchedulePublishColumn() {
    db.all('PRAGMA table_info(events)', [], (err, rows) => {
        if (err || !rows) return;
        const hasSchedule = rows.some((column) => column.name === 'scheduled_publish_at');
        if (!hasSchedule) {
            db.run(
                "ALTER TABLE events ADD COLUMN scheduled_publish_at TEXT",
                (alterErr) => {
                    if (alterErr) {
                        console.error('Could not add events.scheduled_publish_at column:', alterErr.message);
                    } else {
                        console.log('Added missing events.scheduled_publish_at column.');
                    }
                }
            );
        }
    });
}

// Purpose: Adds a booking cut-off timestamp to legacy event databases.
// Inputs: None. Outputs: Adds events.booking_deadline when it is missing.
function ensureEventBookingDeadlineColumn() {
    db.all('PRAGMA table_info(events)', [], (err, rows) => {
        if (err || !rows) return;
        if (!rows.some((column) => column.name === 'booking_deadline')) {
            db.run('ALTER TABLE events ADD COLUMN booking_deadline TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add events.booking_deadline column:', alterErr.message);
                else console.log('Added missing events.booking_deadline column.');
            });
        }
    });
}

// Purpose: Creates the attendee-account table for legacy databases.
// Inputs: None. Outputs: Creates the table only when it is absent.
function ensureAttendeesTable() {
    db.all('SELECT name FROM sqlite_master WHERE type = "table" AND name = "attendees"', [], (err, rows) => {
        if (err || rows.length) return;
        db.run(
            `CREATE TABLE attendees (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL DEFAULT 'Guest Attendee',
                email TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
                last_login TEXT,
                confirmed INTEGER NOT NULL DEFAULT 0,
                confirmation_token TEXT
            )`,
            (createErr) => {
                if (createErr) {
                    console.error('Could not create attendees table:', createErr.message);
                } else {
                    console.log('Created attendees table.');
                }
            }
        );
    });
}

// Purpose: Adds confirmation fields to legacy attendee tables.
// Inputs: None. Outputs: Adds missing confirmation columns.
function ensureAttendeeColumns() {
    db.all('PRAGMA table_info(attendees)', [], (err, rows) => {
        if (err || !rows) return;
        const hasConfirmed = rows.some((c) => c.name === 'confirmed');
        const hasToken = rows.some((c) => c.name === 'confirmation_token');
        if (!hasConfirmed) {
            db.run('ALTER TABLE attendees ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0', (alterErr) => {
                if (alterErr) console.error('Could not add attendees.confirmed column:', alterErr.message);
                else console.log('Added attendees.confirmed column.');
            });
        }
        if (!hasToken) {
            db.run('ALTER TABLE attendees ADD COLUMN confirmation_token TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add attendees.confirmation_token column:', alterErr.message);
                else console.log('Added attendees.confirmation_token column.');
            });
        }
    });
}

// Purpose: Links legacy bookings to attendee accounts.
// Inputs: None. Outputs: Adds the optional attendee foreign-key column.
function ensureBookingAttendeeColumn() {
    db.all('PRAGMA table_info(bookings)', [], (err, rows) => {
        if (err || !rows) return;
        const hasAttendeeId = rows.some((column) => column.name === 'attendee_id');
        if (!hasAttendeeId) {
            db.run(
                'ALTER TABLE bookings ADD COLUMN attendee_id INTEGER REFERENCES attendees(id) ON DELETE SET NULL',
                (alterErr) => {
                    if (alterErr) {
                        console.error('Could not add bookings.attendee_id column:', alterErr.message);
                    } else {
                        console.log('Added missing bookings.attendee_id column.');
                    }
                }
            );
        }
    });
}

// Purpose: Adds booking reference and simulated-payment metadata to legacy databases.
// Inputs: None. Outputs: Adds each missing booking detail column.
function ensureBookingDetailsColumns() {
    db.all('PRAGMA table_info(bookings)', [], (err, rows) => {
        if (err || !rows) return;

        const hasBookingReference = rows.some((column) => column.name === 'booking_reference');
        const hasPaymentName = rows.some((column) => column.name === 'payment_name');
        const hasPaymentEmail = rows.some((column) => column.name === 'payment_email');
        const hasPaymentMethod = rows.some((column) => column.name === 'payment_method');
        const hasPaymentLast4 = rows.some((column) => column.name === 'payment_last4');
        const hasPaymentBrand = rows.some((column) => column.name === 'payment_brand');

        if (!hasBookingReference) {
            db.run('ALTER TABLE bookings ADD COLUMN booking_reference TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add bookings.booking_reference column:', alterErr.message);
                else console.log('Added missing bookings.booking_reference column.');
            });
        }

        if (!hasPaymentName) {
            db.run('ALTER TABLE bookings ADD COLUMN payment_name TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add bookings.payment_name column:', alterErr.message);
                else console.log('Added missing bookings.payment_name column.');
            });
        }

        if (!hasPaymentEmail) {
            db.run('ALTER TABLE bookings ADD COLUMN payment_email TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add bookings.payment_email column:', alterErr.message);
                else console.log('Added missing bookings.payment_email column.');
            });
        }

        if (!hasPaymentMethod) {
            db.run('ALTER TABLE bookings ADD COLUMN payment_method TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add bookings.payment_method column:', alterErr.message);
                else console.log('Added missing bookings.payment_method column.');
            });
        }

        if (!hasPaymentLast4) {
            db.run('ALTER TABLE bookings ADD COLUMN payment_last4 TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add bookings.payment_last4 column:', alterErr.message);
                else console.log('Added missing bookings.payment_last4 column.');
            });
        }

        if (!hasPaymentBrand) {
            db.run('ALTER TABLE bookings ADD COLUMN payment_brand TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add bookings.payment_brand column:', alterErr.message);
                else console.log('Added missing bookings.payment_brand column.');
            });
        }
    });
}

// Purpose: Creates attendee favourites storage for legacy databases.
// Inputs: None. Outputs: Creates the related table when absent.
function ensureFavoritesTable() {
    db.all('SELECT name FROM sqlite_master WHERE type = "table" AND name = "favorites"', [], (err, rows) => {
        if (err || rows.length) return;
        db.run(
            `CREATE TABLE favorites (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                attendee_id INTEGER NOT NULL,
                event_id INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now', '+8 hours')),
                UNIQUE(attendee_id, event_id),
                FOREIGN KEY (attendee_id) REFERENCES attendees(id) ON DELETE CASCADE,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE
            )`,
            (createErr) => {
                if (createErr) {
                    console.error('Could not create favorites table:', createErr.message);
                } else {
                    console.log('Created favorites table.');
                }
            }
        );
    });
}

// Purpose: Adds immutable quantity, price, and total snapshots to legacy bookings.
// Inputs: None. Outputs: Adds each missing snapshot column.
function ensureBookingSnapshotColumns() {
    db.all('PRAGMA table_info(bookings)', [], (err, rows) => {
        if (err || !rows) return;

        const columns = new Set(rows.map((column) => column.name));
        // Purpose: Queues one missing historical booking snapshot column for migration.
        // Inputs: Column name and SQLite definition. Outputs: Updates the pending migration count.
        const addColumn = (name, definition) => {
            if (!columns.has(name)) {
                db.run(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`, (alterErr) => {
                    if (alterErr) {
                        console.error(`Could not add bookings.${name} column:`, alterErr.message);
                    } else {
                        console.log(`Added missing bookings.${name} column.`);
                    }
                });
            }
        };

        addColumn('full_price_price_snapshot', 'REAL NOT NULL DEFAULT 0.00');
        addColumn('concession_price_snapshot', 'REAL NOT NULL DEFAULT 0.00');
        addColumn('full_price_qty_snapshot', 'INTEGER NOT NULL DEFAULT 0');
        addColumn('concession_qty_snapshot', 'INTEGER NOT NULL DEFAULT 0');
        addColumn('total_amount_paid', 'REAL NOT NULL DEFAULT 0.00');
    });
}

// Purpose: Adds one-time organiser check-in tracking to legacy bookings.
// Inputs: None. Outputs: Adds bookings.checked_in_at when it is missing.
function ensureBookingCheckInColumn() {
    db.all('PRAGMA table_info(bookings)', [], (err, rows) => {
        if (err || !rows) return;
        if (!rows.some((column) => column.name === 'checked_in_at')) {
            db.run('ALTER TABLE bookings ADD COLUMN checked_in_at TEXT', (alterErr) => {
                if (alterErr) console.error('Could not add bookings.checked_in_at column:', alterErr.message);
                else console.log('Added missing bookings.checked_in_at column.');
            });
        }
    });
}

// Purpose: Creates duplicate-safe waitlist storage for legacy databases.
// Inputs: None. Outputs: Creates the waitlist table and indexes when absent.
function ensureWaitlistTable() {
    db.run(
        `CREATE TABLE IF NOT EXISTS waitlist_entries (
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
        )`,
        (createErr) => {
            if (createErr) return console.error('Could not create waitlist_entries table:', createErr.message);
            db.run('CREATE INDEX IF NOT EXISTS idx_waitlist_event_status ON waitlist_entries(event_id, status, joined_at)');
            db.run('CREATE INDEX IF NOT EXISTS idx_waitlist_attendee ON waitlist_entries(attendee_id, status)');
        }
    );
}

// Purpose: Adds branding preferences and modification tracking to legacy settings.
// Inputs: None. Outputs: Adds and backfills missing settings columns.
function ensureSiteSettingsColumns() {
    db.all('PRAGMA table_info(site_settings)', [], (err, rows) => {
        if (err || !rows) return;

        const hasLastModifiedAt = rows.some((column) => column.name === 'last_modified_at');
        const hasFontFamily = rows.some((column) => column.name === 'display_font_family');
        const hasDescriptionItalic = rows.some((column) => column.name === 'description_italic');

        if (!hasLastModifiedAt) {
            db.run(
                'ALTER TABLE site_settings ADD COLUMN last_modified_at TEXT',
                (alterErr) => {
                    if (alterErr) console.error('Could not add site_settings.last_modified_at column:', alterErr.message);
                    else console.log('Added missing site_settings.last_modified_at column.');

                    if (!alterErr) {
                        db.run(
                            "UPDATE site_settings SET last_modified_at = datetime('now', '+8 hours') WHERE last_modified_at IS NULL",
                            (updateErr) => {
                                if (updateErr) console.error('Could not backfill site_settings.last_modified_at column:', updateErr.message);
                            }
                        );
                    }
                }
            );
        }

        if (!hasFontFamily) {
            db.run(
                "ALTER TABLE site_settings ADD COLUMN display_font_family TEXT NOT NULL DEFAULT 'Barlow Condensed'",
                (alterErr) => {
                    if (alterErr) console.error('Could not add site_settings.display_font_family column:', alterErr.message);
                    else console.log('Added missing site_settings.display_font_family column.');
                }
            );
        }

        if (!hasDescriptionItalic) {
            db.run(
                'ALTER TABLE site_settings ADD COLUMN description_italic INTEGER NOT NULL DEFAULT 0',
                (alterErr) => {
                    if (alterErr) console.error('Could not add site_settings.description_italic column:', alterErr.message);
                    else console.log('Added missing site_settings.description_italic column.');
                }
            );
        }
    });
}

// Purpose: Retrieves the current site settings row from SQLite.
// Inputs: A callback function.
// Outputs: Returns the single site settings record used by the app.
function getSiteSettings(callback) {
    db.get('SELECT * FROM site_settings WHERE id = 1', [], callback);
}

// Purpose: Records the organiser's latest successful login.
// Inputs: Organiser ID and callback. Outputs: Updates one organiser row.
function updateOrganiserLastLogin(organiserId, callback) {
    db.run(
        `UPDATE organisers SET last_login = datetime('now', '+8 hours') WHERE id = ?`,
        [organiserId],
        callback
    );
}

// Purpose: Updates the site-wide branding and description values.
// Inputs: An object with name, description, display font, and italic preference.
// Outputs: Saves the updated settings to SQLite.
function updateSiteSettings(data, callback) {
    db.run(
        `UPDATE site_settings SET
            name = ?,
            description = ?,
            display_font_family = ?,
            description_italic = ?,
            last_modified_at = datetime('now', '+8 hours')
         WHERE id = 1`,
        [
            data.name,
            data.description,
            data.display_font_family,
            data.description_italic ? 1 : 0
        ],
        callback
    );
}

// --- Events ---
// Purpose: Retrieves every draft and published event for organiser management.
// Inputs: Callback. Outputs: Events ordered by creation time, newest first.
function getAllEvents(callback) {
    db.all(
        `SELECT e.*,
            (SELECT COUNT(*) FROM favorites f WHERE f.event_id = e.id) AS wishlist_count
         FROM events e
         ORDER BY datetime(e.created_at) DESC`,
        [],
        callback
    );
}

// Purpose: Retrieves future scheduled draft events.
// Inputs: Callback. Outputs: Scheduled drafts ordered by publication time.
function getScheduledEvents(callback) {
    db.all(`SELECT * FROM events WHERE status = 'draft' AND scheduled_publish_at IS NOT NULL AND datetime(scheduled_publish_at) > datetime('now', '+8 hours') ORDER BY datetime(scheduled_publish_at) ASC`, [], callback);
}

// Purpose: Publishes due scheduled events only when their required data is valid.
// Inputs: Callback. Outputs: Number published; invalid due events remain drafts and are logged.
function processScheduledEvents(callback) {
    const dueCondition = `status = 'draft'
        AND scheduled_publish_at IS NOT NULL
        AND datetime(scheduled_publish_at) <= datetime('now', '+8 hours')`;
    const validCondition = `length(trim(title)) > 0
        AND length(trim(description)) > 0
        AND event_date IS NOT NULL
        AND event_date <> ''
        AND date(event_date) IS NOT NULL
        AND duration_minutes >= 0
        AND full_price_tickets >= 0
        AND concession_tickets >= 0
        AND full_price_cost >= 0
        AND concession_cost >= 0
        AND (booking_deadline IS NULL OR (
            datetime(booking_deadline) > datetime('now', '+8 hours')
            AND datetime(booking_deadline) < datetime(event_date || ' ' || COALESCE(NULLIF(event_time, ''), '23:59') || ':00')
        ))`;

    db.all(
        `SELECT id, title FROM events WHERE ${dueCondition} AND NOT (${validCondition})`,
        [],
        (invalidErr, invalidEvents) => {
            if (invalidErr) return callback(invalidErr);
            (invalidEvents || []).forEach((event) => {
                console.warn(`Scheduled event ${event.id} (${event.title || 'Untitled'}) was not published because its details are incomplete or invalid.`);
            });

            db.run(
                `UPDATE events SET
                    status = 'published',
                    published_at = datetime('now', '+8 hours'),
                    scheduled_publish_at = NULL,
                    last_modified_at = datetime('now', '+8 hours')
                 WHERE ${dueCondition} AND ${validCondition}`,
                function (err) {
                    if (err) return callback(err);
                    callback(null, this.changes);
                }
            );
        }
    );
}

// Purpose: Retrieves attendee-visible events.
// Inputs: Callback. Outputs: Published events ordered by event date.
function getPublishedEvents(callback) {
    db.all(
        `SELECT e.*,
            (SELECT COUNT(*) FROM favorites f WHERE f.event_id = e.id) AS wishlist_count
         FROM events e
         WHERE e.status = 'published'
         ORDER BY e.event_date ASC`,
        [],
        callback
    );
}

// Purpose: Retrieves one event for display, editing, or booking validation.
// Inputs: Event ID and callback. Outputs: Matching event row or undefined.
function getEventById(id, callback) {
    db.get('SELECT * FROM events WHERE id = ?', [id], callback);
}

// Purpose: Inserts a new blank draft event into SQLite.
// Inputs: A callback function.
// Outputs: Returns the new event ID for editing or publishing.
function createEvent(callback) {
    db.run(
        `INSERT INTO events (title, description, event_date, event_time, location, full_price_tickets, full_price_cost, concession_tickets, concession_cost, status, created_at, last_modified_at)
         VALUES ('New Event', '', NULL, NULL, '', 0, 0.00, 0, 0.00, 'draft', datetime('now', '+8 hours'), datetime('now', '+8 hours'))`,
        function (err) {
            if (err) return callback(err);
            callback(null, this.lastID);
        }
    );
}

// Purpose: Saves the organiser's edits for an existing event.
// Inputs: Event ID and an object with edited event values.
// Outputs: Updates the event row and refreshes the last-modified timestamp.
function updateEvent(id, data, callback) {
    db.run(
        `UPDATE events SET
            title = ?,
            description = ?,
            event_date = ?,
            event_time = ?,
            location = ?,
            image_data = CASE WHEN ? = 1 THEN ? ELSE image_data END,
            duration_minutes = ?,
            full_price_tickets = ?,
            full_price_cost = ?,
            concession_tickets = ?,
            concession_cost = ?,
            scheduled_publish_at = ?,
            booking_deadline = ?,
            last_modified_at = datetime('now', '+8 hours')
         WHERE id = ?`,
        [
            data.title,
            data.description,
            data.event_date,
            data.event_time,
            data.location,
            data.image_update_requested ? 1 : 0,
            data.image_data || null,
            data.duration_minutes,
            data.full_price_tickets,
            data.full_price_cost,
            data.concession_tickets,
            data.concession_cost,
            data.scheduled_publish_at || null,
            data.booking_deadline || null,
            id
        ],
        callback
    );
}

// Purpose: Publishes a draft event so attendees can view it.
// Inputs: Event ID.
// Outputs: Sets the event status to published and records the publication timestamp.
function publishEvent(id, callback) {
    db.get('SELECT * FROM events WHERE id = ?', [id], (selectErr, event) => {
        if (selectErr) return callback(selectErr);
        if (!event) return callback(new Error('Event not found.'));
        if (event.status === 'published') return callback(new Error('This event is already published.'));
        if (!event.title || !String(event.title).trim()) return callback(new Error('A meaningful title is required before publishing.'));
        if (!event.description || !String(event.description).trim()) return callback(new Error('A description is required before publishing.'));
        if (!event.event_date) return callback(new Error('An event date is required before publishing.'));
        if (Number.isNaN(new Date(`${event.event_date}T00:00:00`).getTime())) return callback(new Error('The event date must be valid.'));
        if (event.event_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(event.event_time))) return callback(new Error('The event time must be valid.'));
        if (Number(event.duration_minutes || 0) < 0) return callback(new Error('Duration cannot be negative.'));
        if (!Number.isInteger(Number(event.full_price_tickets || 0)) || !Number.isInteger(Number(event.concession_tickets || 0))) return callback(new Error('Ticket quantities must be whole numbers.'));
        if (Number(event.full_price_tickets || 0) < 0 || Number(event.concession_tickets || 0) < 0) return callback(new Error('Ticket quantities cannot be negative.'));
        if (Number(event.full_price_cost || 0) < 0 || Number(event.concession_cost || 0) < 0) return callback(new Error('Ticket prices cannot be negative.'));
        if (event.booking_deadline) {
            const deadline = new Date(String(event.booking_deadline).replace(' ', 'T'));
            const sessionStart = new Date(`${event.event_date}T${event.event_time || '23:59'}:00`);
            if (Number.isNaN(deadline.getTime())) return callback(new Error('The booking deadline must be valid.'));
            if (deadline >= sessionStart) return callback(new Error('The booking deadline must be before the session starts.'));
            if (deadline <= new Date()) return callback(new Error('The booking deadline must be in the future.'));
        }

        db.run(
            `UPDATE events SET status = 'published', published_at = datetime('now', '+8 hours'), last_modified_at = datetime('now', '+8 hours') WHERE id = ?`,
            [id],
            callback
        );
    });
}

// Purpose: Removes an event and its associated bookings.
// Inputs: Event ID.
// Outputs: Deletes the event row from SQLite.
function deleteEvent(id, callback) {
    db.run('DELETE FROM events WHERE id = ?', [id], callback);
}

// --- Bookings ---
// Purpose: Creates a booking transaction while protecting ticket inventory from double-booking.
// Inputs: Event ID, attendee details, ticket quantities, and payment details from the booking request.
// Outputs: Inserts a confirmed booking row and reduces the relevant ticket inventory in SQLite.
function createBooking(data, callback) {
    const fullPriceQty = Number(data.full_price_qty || 0);
    const concessionQty = Number(data.concession_qty || 0);

    db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return callback(beginErr);

        db.get(
            `SELECT id, status, event_date, event_time, booking_deadline, full_price_tickets, concession_tickets, full_price_cost, concession_cost, published_at
             FROM events
             WHERE id = ?
             AND status = 'published'`,
            [data.event_id],
            (eventErr, event) => {
                if (eventErr) {
                    return db.run('ROLLBACK', () => callback(eventErr));
                }
                if (!event) {
                    return db.run('ROLLBACK', () => callback(new Error('The selected event is not available for booking.')));
                }
                const sessionStart = event.event_date ? new Date(`${event.event_date}T${event.event_time || '23:59'}:00`) : null;
                if (sessionStart && sessionStart <= new Date()) {
                    return db.run('ROLLBACK', () => callback(new Error('The event has already passed.')));
                }
                if (event.booking_deadline && new Date(String(event.booking_deadline).replace(' ', 'T')) <= new Date()) {
                    return db.run('ROLLBACK', () => callback(new Error('The booking deadline has passed.')));
                }

                const availableFull = Number(event.full_price_tickets || 0);
                const availableConcession = Number(event.concession_tickets || 0);
                if (!Number.isFinite(fullPriceQty) || !Number.isFinite(concessionQty) || fullPriceQty < 0 || concessionQty < 0 || !Number.isInteger(fullPriceQty) || !Number.isInteger(concessionQty)) {
                    return db.run('ROLLBACK', () => callback(new Error('Ticket quantities must be whole numbers.')));
                }
                if (fullPriceQty === 0 && concessionQty === 0) {
                    return db.run('ROLLBACK', () => callback(new Error('Please select at least one ticket.')));
                }
                if (fullPriceQty > availableFull || concessionQty > availableConcession) {
                    return db.run('ROLLBACK', () => callback(new Error(`Only ${availableFull} full-price and ${availableConcession} concession tickets remain.`)));
                }

                const totalAmount = (
                    fullPriceQty * Number(event.full_price_cost || 0)
                    + concessionQty * Number(event.concession_cost || 0)
                );

                db.run(
                    `UPDATE events
                     SET full_price_tickets = full_price_tickets - ?,
                         concession_tickets = concession_tickets - ?
                     WHERE id = ?
                     AND full_price_tickets >= ?
                     AND concession_tickets >= ?
                     AND status = 'published'`,
                    [fullPriceQty, concessionQty, data.event_id, fullPriceQty, concessionQty],
                    function (inventoryErr) {
                        if (inventoryErr) {
                            return db.run('ROLLBACK', () => callback(inventoryErr));
                        }
                        if (this.changes !== 1) {
                            return db.run('ROLLBACK', () => callback(new Error('Not enough tickets available.')));
                        }

                        db.run(
                            `INSERT INTO bookings (
                                event_id,
                                attendee_id,
                                attendee_name,
                                full_price_qty,
                                concession_qty,
                                full_price_price_snapshot,
                                concession_price_snapshot,
                                full_price_qty_snapshot,
                                concession_qty_snapshot,
                                total_amount_paid,
                                total_amount,
                                status,
                                booked_at,
                                booking_reference,
                                payment_name,
                                payment_email,
                                payment_method,
                                payment_last4,
                                payment_brand
                            )
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now', '+8 hours'), NULL, ?, ?, ?, ?, ?)`,
                            [
                                data.event_id,
                                data.attendee_id || null,
                                data.attendee_name,
                                fullPriceQty,
                                concessionQty,
                                Number(event.full_price_cost || 0),
                                Number(event.concession_cost || 0),
                                fullPriceQty,
                                concessionQty,
                                totalAmount,
                                totalAmount,
                                data.payment_name || null,
                                data.payment_email || null,
                                data.payment_method || null,
                                data.payment_last4 || null,
                                data.payment_brand || null
                            ],
                            function (insertErr) {
                                if (insertErr) {
                                    return db.run('ROLLBACK', () => callback(insertErr));
                                }

                                const newBookingId = this.lastID;
                                const bookingReference = `BK-${String(newBookingId).padStart(6, '0')}`;
                                db.run(
                                    'UPDATE bookings SET booking_reference = ? WHERE id = ?',
                                    [bookingReference, newBookingId],
                                    function (referenceErr) {
                                        if (referenceErr) {
                                            return db.run('ROLLBACK', () => callback(referenceErr));
                                        }
                                        db.run('COMMIT', (commitErr) => {
                                            if (commitErr) {
                                                return db.run('ROLLBACK', () => callback(commitErr));
                                            }
                                            callback(null, newBookingId);
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
}

// Purpose: Adds one authenticated attendee to a sold-out event waitlist.
// Inputs: Event ID and attendee ID. Outputs: Waitlist entry ID and queue position.
function joinWaitlist(eventId, attendeeId, callback) {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return callback(beginErr);
        db.get(
            'SELECT id, status, event_date, event_time, booking_deadline, full_price_tickets, concession_tickets FROM events WHERE id = ?',
            [eventId],
            (eventErr, event) => {
                if (eventErr) return db.run('ROLLBACK', () => callback(eventErr));
                if (!event || event.status !== 'published') {
                    return db.run('ROLLBACK', () => callback(new Error('This event is not available.')));
                }
                const sessionStart = new Date(event.event_date + 'T' + (event.event_time || '23:59') + ':00');
                if (sessionStart <= new Date()) {
                    return db.run('ROLLBACK', () => callback(new Error('This session has already started.')));
                }
                if (event.booking_deadline && new Date(String(event.booking_deadline).replace(' ', 'T')) <= new Date()) {
                    return db.run('ROLLBACK', () => callback(new Error('The booking deadline has passed.')));
                }
                if (Number(event.full_price_tickets || 0) > 0 || Number(event.concession_tickets || 0) > 0) {
                    return db.run('ROLLBACK', () => callback(new Error('Tickets are currently available; please book normally.')));
                }
                db.get(
                    "SELECT COUNT(*) AS count FROM bookings WHERE event_id = ? AND attendee_id = ? AND status = 'confirmed'",
                    [eventId, attendeeId],
                    (bookingErr, existingBooking) => {
                        if (bookingErr) return db.run('ROLLBACK', () => callback(bookingErr));
                        if (Number(existingBooking && existingBooking.count || 0) > 0) {
                            return db.run('ROLLBACK', () => callback(new Error('You already have a confirmed booking for this event.')));
                        }
                        db.run(
                            "INSERT INTO waitlist_entries (event_id, attendee_id, status, joined_at) VALUES (?, ?, 'waiting', datetime('now', '+8 hours'))",
                            [eventId, attendeeId],
                            function (insertErr) {
                                if (insertErr) {
                                    const duplicate = String(insertErr.message || '').includes('UNIQUE');
                                    return db.run('ROLLBACK', () => callback(new Error(duplicate
                                        ? 'You are already on the waitlist for this event.'
                                        : insertErr.message)));
                                }
                                const entryId = this.lastID;
                                db.get(
                                    "SELECT COUNT(*) AS position FROM waitlist_entries WHERE event_id = ? AND status = 'waiting' AND id <= ?",
                                    [eventId, entryId],
                                    (positionErr, row) => {
                                        if (positionErr) return db.run('ROLLBACK', () => callback(positionErr));
                                        db.run('COMMIT', (commitErr) => {
                                            if (commitErr) return db.run('ROLLBACK', () => callback(commitErr));
                                            callback(null, { id: entryId, position: Number(row && row.position || 1) });
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    });
}

// Purpose: Retrieves one attendee's waitlist state and live queue position.
// Inputs: Event ID and attendee ID. Outputs: Matching waitlist entry or undefined.
function getWaitlistEntry(eventId, attendeeId, callback) {
    db.get(
        "SELECT w.*, e.title AS event_title, CASE WHEN w.status = 'waiting' THEN (SELECT COUNT(*) FROM waitlist_entries ahead WHERE ahead.event_id = w.event_id AND ahead.status = 'waiting' AND (datetime(ahead.joined_at) < datetime(w.joined_at) OR (ahead.joined_at = w.joined_at AND ahead.id <= w.id))) ELSE NULL END AS position FROM waitlist_entries w JOIN events e ON e.id = w.event_id WHERE w.event_id = ? AND w.attendee_id = ?",
        [eventId, attendeeId],
        callback
    );
}

// Purpose: Retrieves all waitlist entries belonging to one attendee.
// Inputs: Attendee ID. Outputs: Waitlist entries with event and promotion details.
function getWaitlistForAttendee(attendeeId, callback) {
    db.all(
        "SELECT w.*, e.title AS event_title, e.event_date, e.event_time, b.booking_reference, CASE WHEN w.status = 'waiting' THEN (SELECT COUNT(*) FROM waitlist_entries ahead WHERE ahead.event_id = w.event_id AND ahead.status = 'waiting' AND (datetime(ahead.joined_at) < datetime(w.joined_at) OR (ahead.joined_at = w.joined_at AND ahead.id <= w.id))) ELSE NULL END AS position FROM waitlist_entries w JOIN events e ON e.id = w.event_id LEFT JOIN bookings b ON b.id = w.booking_id WHERE w.attendee_id = ? ORDER BY datetime(w.joined_at) DESC",
        [attendeeId],
        callback
    );
}

// Purpose: Promotes waiting attendees into confirmed bookings while restored inventory remains.
// Inputs: Event ID inside an open transaction. Outputs: Number of promoted entries.
function promoteWaitlistEntries(eventId, callback, promotedCount = 0) {
    db.get(
        "SELECT id, event_date, event_time, booking_deadline, full_price_tickets, concession_tickets, full_price_cost, concession_cost FROM events WHERE id = ? AND status = 'published'",
        [eventId],
        (eventErr, event) => {
            if (eventErr) return callback(eventErr);
            if (!event) return callback(null, promotedCount);
            const sessionStart = new Date(event.event_date + 'T' + (event.event_time || '23:59') + ':00');
            const deadlinePassed = event.booking_deadline
                && new Date(String(event.booking_deadline).replace(' ', 'T')) <= new Date();
            if (sessionStart <= new Date() || deadlinePassed) return callback(null, promotedCount);
            const useFullPrice = Number(event.full_price_tickets || 0) > 0;
            const useConcession = !useFullPrice && Number(event.concession_tickets || 0) > 0;
            if (!useFullPrice && !useConcession) return callback(null, promotedCount);
            db.get(
                "SELECT w.id, w.attendee_id, a.name, a.email FROM waitlist_entries w JOIN attendees a ON a.id = w.attendee_id WHERE w.event_id = ? AND w.status = 'waiting' ORDER BY datetime(w.joined_at) ASC, w.id ASC LIMIT 1",
                [eventId],
                (waitErr, entry) => {
                    if (waitErr) return callback(waitErr);
                    if (!entry) return callback(null, promotedCount);
                    const fullQty = useFullPrice ? 1 : 0;
                    const concessionQty = useConcession ? 1 : 0;
                    const totalAmount = fullQty ? Number(event.full_price_cost || 0) : Number(event.concession_cost || 0);
                    db.run(
                        'UPDATE events SET full_price_tickets = full_price_tickets - ?, concession_tickets = concession_tickets - ? WHERE id = ? AND full_price_tickets >= ? AND concession_tickets >= ?',
                        [fullQty, concessionQty, eventId, fullQty, concessionQty],
                        function (inventoryErr) {
                            if (inventoryErr) return callback(inventoryErr);
                            if (this.changes !== 1) return callback(new Error('Waitlist promotion inventory changed unexpectedly.'));
                            db.run(
                                "INSERT INTO bookings (event_id, attendee_id, attendee_name, full_price_qty, concession_qty, full_price_price_snapshot, concession_price_snapshot, full_price_qty_snapshot, concession_qty_snapshot, total_amount_paid, total_amount, status, booked_at, payment_name, payment_email, payment_method, payment_brand) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', datetime('now', '+8 hours'), ?, ?, 'waitlist_auto', 'Waitlist')",
                                [eventId, entry.attendee_id, entry.name, fullQty, concessionQty, Number(event.full_price_cost || 0), Number(event.concession_cost || 0), fullQty, concessionQty, totalAmount, totalAmount, entry.name, entry.email],
                                function (insertErr) {
                                    if (insertErr) return callback(insertErr);
                                    const bookingId = this.lastID;
                                    const reference = 'BK-' + String(bookingId).padStart(6, '0');
                                    db.run('UPDATE bookings SET booking_reference = ? WHERE id = ?', [reference, bookingId], (referenceErr) => {
                                        if (referenceErr) return callback(referenceErr);
                                        db.run(
                                            "UPDATE waitlist_entries SET status = 'promoted', promoted_at = datetime('now', '+8 hours'), booking_id = ? WHERE id = ? AND status = 'waiting'",
                                            [bookingId, entry.id],
                                            function (waitUpdateErr) {
                                                if (waitUpdateErr) return callback(waitUpdateErr);
                                                if (this.changes !== 1) return callback(new Error('Waitlist entry was already processed.'));
                                                promoteWaitlistEntries(eventId, callback, promotedCount + 1);
                                            }
                                        );
                                    });
                                }
                            );
                        }
                    );
                }
            );
        }
    );
}

// Purpose: Cancels one confirmed booking and restores its inventory atomically.
// Inputs: Booking ID and callback. Outputs: Commits once or rolls back on any failure.
function cancelBooking(bookingId, callback) {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return callback(beginErr);

        db.get(
            `SELECT id, event_id, full_price_qty, concession_qty, status FROM bookings WHERE id = ?`,
            [bookingId],
            (selectErr, booking) => {
                if (selectErr) {
                    return db.run('ROLLBACK', () => callback(selectErr));
                }
                if (!booking) {
                    return db.run('ROLLBACK', () => callback(new Error('Booking not found.')));
                }
                if (booking.status !== 'confirmed') {
                    return db.run('ROLLBACK', () => callback(new Error('Booking is already cancelled.')));
                }

                db.run(
                    `UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'confirmed'`,
                    [bookingId],
                    function (updateErr) {
                        if (updateErr) {
                            return db.run('ROLLBACK', () => callback(updateErr));
                        }
                        if (this.changes !== 1) {
                            return db.run('ROLLBACK', () => callback(new Error('Booking could not be cancelled.')));
                        }

                        db.run(
                            `UPDATE events
                             SET full_price_tickets = full_price_tickets + ?,
                                 concession_tickets = concession_tickets + ?
                             WHERE id = ?
                             AND status = 'published'`,
                            [booking.full_price_qty, booking.concession_qty, booking.event_id],
                            function (restoreErr) {
                                if (restoreErr) {
                                    return db.run('ROLLBACK', () => callback(restoreErr));
                                }
                                if (this.changes !== 1) {
                                    return db.run('ROLLBACK', () => callback(new Error('The event is no longer available for inventory restoration.')));
                                }
                                promoteWaitlistEntries(booking.event_id, (promotionErr, promotedCount) => {
                                    if (promotionErr) return db.run('ROLLBACK', () => callback(promotionErr));
                                    db.run('COMMIT', (commitErr) => {
                                        if (commitErr) return db.run('ROLLBACK', () => callback(commitErr));
                                        callback(null, { promotedCount: Number(promotedCount || 0) });
                                    });
                                });
                            }
                        );
                    }
                );
            }
        );
    });
}

// Purpose: Finds a booking using the reference encoded in its QR confirmation.
// Inputs: Booking reference. Outputs: Enriched booking details or undefined.
function getBookingByReference(reference, callback) {
    db.get(
        'SELECT b.*, e.title AS event_title, e.event_date, e.event_time, e.location AS event_location FROM bookings b JOIN events e ON e.id = b.event_id WHERE UPPER(b.booking_reference) = UPPER(?)',
        [String(reference || '').trim()],
        callback
    );
}

// Purpose: Records one organiser check-in while preventing cancelled or duplicate check-ins.
// Inputs: Booking ID. Outputs: Updated booking state or a validation error.
function checkInBooking(bookingId, callback) {
    db.run('BEGIN IMMEDIATE', (beginErr) => {
        if (beginErr) return callback(beginErr);
        db.get('SELECT id, status, checked_in_at FROM bookings WHERE id = ?', [bookingId], (selectErr, booking) => {
            if (selectErr) return db.run('ROLLBACK', () => callback(selectErr));
            if (!booking) return db.run('ROLLBACK', () => callback(new Error('Booking not found.')));
            if (booking.status !== 'confirmed') {
                return db.run('ROLLBACK', () => callback(new Error('Cancelled bookings cannot be checked in.')));
            }
            if (booking.checked_in_at) {
                return db.run('ROLLBACK', () => callback(new Error('This booking has already been checked in.')));
            }
            db.run(
                "UPDATE bookings SET checked_in_at = datetime('now', '+8 hours') WHERE id = ? AND status = 'confirmed' AND checked_in_at IS NULL",
                [bookingId],
                function (updateErr) {
                    if (updateErr) return db.run('ROLLBACK', () => callback(updateErr));
                    if (this.changes !== 1) {
                        return db.run('ROLLBACK', () => callback(new Error('This booking could not be checked in.')));
                    }
                    db.run('COMMIT', (commitErr) => {
                        if (commitErr) return db.run('ROLLBACK', () => callback(commitErr));
                        callback(null);
                    });
                }
            );
        });
    });
}

// Purpose: Restores inventory for a specified booking in legacy administrative flows.
// Inputs: Booking ID and callback. Outputs: Adds purchased quantities back to the event.
function restoreTicketsForBooking(bookingId, callback) {
    db.get(
        `SELECT event_id, full_price_qty, concession_qty FROM bookings WHERE id = ?`,
        [bookingId],
        (err, booking) => {
            if (err || !booking) return callback(err || new Error('Booking not found'));
            db.run(
                `UPDATE events
                 SET full_price_tickets = full_price_tickets + ?,
                     concession_tickets = concession_tickets + ?
                 WHERE id = ?`,
                [booking.full_price_qty, booking.concession_qty, booking.event_id],
                callback
            );
        }
    );
}

// Purpose: Retrieves filtered booking records for organiser management.
// Inputs: Search text, status filter, and callback. Outputs: Matching booking summaries.
function getBookingDashboard(search, status, callback) {
    const params = [];
    let filters = [];

    if (status && ['confirmed', 'cancelled'].includes(status)) {
        filters.push('b.status = ?');
        params.push(status);
    }

    if (search && search.trim()) {
        const query = `%${search.trim().toLowerCase()}%`;
        filters.push(`(
            LOWER(b.attendee_name) LIKE ? OR
            LOWER(e.title) LIKE ? OR
            CAST(b.id AS TEXT) LIKE ?
        )`);
        params.push(query, query, query);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    db.all(
        `SELECT
            b.id,
            b.booking_reference,
            b.attendee_name,
            e.title AS event_title,
            b.status,
            b.checked_in_at,
            b.full_price_qty,
            b.concession_qty,
            b.payment_email,
            b.payment_method,
            b.payment_last4,
            ${bookingAmountSql} AS amount_paid,
            strftime('%d %b %Y %H:%M', b.booked_at) AS booked_at,
            b.full_price_price_snapshot,
            b.concession_price_snapshot,
            b.full_price_qty_snapshot,
            b.concession_qty_snapshot
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         ${whereClause}
         ORDER BY datetime(b.booked_at) DESC`,
        params,
        callback
    );
}

// Purpose: Calculates booking, ticket, cancellation, and historical revenue totals.
// Inputs: Callback. Outputs: One aggregate totals row.
function getBookingTotals(callback) {
    db.get(
        `SELECT
            COUNT(*) AS total_bookings,
            COALESCE(SUM(full_price_qty + concession_qty), 0) AS total_tickets,
            COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN full_price_qty + concession_qty ELSE 0 END), 0) AS confirmed_tickets,
            COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN ${bookingAmountSql} ELSE 0 END), 0) AS total_revenue,
            COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN 1 ELSE 0 END), 0) AS confirmed_bookings,
            COALESCE(SUM(CASE WHEN b.status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_bookings
         FROM bookings b
         JOIN events e ON e.id = b.event_id`,
        [],
        callback
    );
}

// Purpose: Retrieves all bookings belonging to one event.
// Inputs: Event ID and callback. Outputs: Booking rows ordered newest first.
function getBookingsForEvent(eventId, callback) {
    db.all('SELECT * FROM bookings WHERE event_id = ? ORDER BY datetime(booked_at) DESC', [eventId], callback);
}

// Purpose: Counts confirmed full-price and concession tickets for an event.
// Inputs: Event ID and callback. Outputs: Aggregate confirmed ticket quantities.
function getBookingCount(eventId, callback) {
    db.get(
        `SELECT
            COALESCE(SUM(full_price_qty), 0) AS full_price_booked,
            COALESCE(SUM(concession_qty), 0) AS concession_booked
         FROM bookings WHERE event_id = ? AND status = 'confirmed'`,
        [eventId],
        callback
    );
}

// Purpose: Calculates confirmed ticket popularity for published events.
// Inputs: Callback. Outputs: One booked-seat total per published event.
function getPublishedEventPopularityCounts(callback) {
    db.all(
        `SELECT e.id,
            COALESCE((
                SELECT SUM(b.full_price_qty + b.concession_qty)
                FROM bookings b
                WHERE b.event_id = e.id AND b.status = 'confirmed'
            ), 0) AS bookedSeats,
            (SELECT COUNT(*) FROM favorites f WHERE f.event_id = e.id) AS wishlistCount
         FROM events e
         WHERE e.status = 'published'`,
        [],
        callback
    );
}

// Purpose: Builds the organiser revenue and event-performance overview.
// Inputs: Callback. Outputs: Aggregated historical revenue, sales, and event metrics.
function getRevenueOverview(callback) {
    const summary = {
        totalEvents: 0,
        publishedEvents: 0,
        draftEvents: 0,
        upcomingEvents: 0,
        pastEvents: 0,
        unscheduledEvents: 0,
        totalBookings: 0,
        totalRevenue: 0,
        totalTicketsSold: 0,
        totalFullTickets: 0,
        totalConcessionTickets: 0,
        averageRevenuePerEvent: 0,
        averageTicketPrice: 0,
        ticketsRemaining: 0,
        highestRevenueMonth: null,
        bestSellingEvent: null,
        revenueByEvent: [],
        recentBookings: []
    };

    let pending = 12;
    let errorOccurred = false;

    // Purpose: Completes the multi-query revenue overview once or returns its first error.
    // Inputs: Optional database error. Outputs: Invokes the overview callback exactly once.
    const finish = (err) => {
        if (errorOccurred) return;
        if (err) {
            errorOccurred = true;
            return callback(err);
        }
        if (--pending === 0) {
            summary.averageRevenuePerEvent = summary.totalEvents ? summary.totalRevenue / summary.totalEvents : 0;
            summary.averageTicketPrice = summary.totalTicketsSold ? summary.totalRevenue / summary.totalTicketsSold : 0;
            callback(null, summary);
        }
    };

    db.get('SELECT COUNT(*) AS total_events FROM events', [], (err, row) => {
        if (!err && row) summary.totalEvents = row.total_events || 0;
        finish(err);
    });

    db.get("SELECT COUNT(*) AS published_events FROM events WHERE status = 'published'", [], (err, row) => {
        if (!err && row) summary.publishedEvents = row.published_events || 0;
        finish(err);
    });

    db.get("SELECT COUNT(*) AS draft_events FROM events WHERE status = 'draft'", [], (err, row) => {
        if (!err && row) summary.draftEvents = row.draft_events || 0;
        finish(err);
    });

    db.get("SELECT COUNT(*) AS upcoming_events FROM events WHERE status = 'published' AND date(event_date) >= date('now')", [], (err, row) => {
        if (!err && row) summary.upcomingEvents = row.upcoming_events || 0;
        finish(err);
    });

    db.get("SELECT COUNT(*) AS past_events FROM events WHERE status = 'published' AND date(event_date) < date('now')", [], (err, row) => {
        if (!err && row) summary.pastEvents = row.past_events || 0;
        finish(err);
    });

    db.get("SELECT COUNT(*) AS unscheduled_events FROM events WHERE status = 'published' AND (event_date IS NULL OR event_date = '')", [], (err, row) => {
        if (!err && row) summary.unscheduledEvents = row.unscheduled_events || 0;
        finish(err);
    });

    db.get(
        `SELECT
            COUNT(b.id) AS total_bookings,
            COALESCE(SUM(${bookingAmountSql}), 0) AS total_revenue,
            COALESCE(SUM(b.full_price_qty + b.concession_qty), 0) AS total_tickets_sold,
            COALESCE(SUM(b.full_price_qty), 0) AS total_full_tickets,
            COALESCE(SUM(b.concession_qty), 0) AS total_concession_tickets
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.status = 'confirmed'`,
        [],
        (err, row) => {
            if (!err && row) {
                summary.totalBookings = row.total_bookings || 0;
                summary.totalRevenue = row.total_revenue || 0;
                summary.totalTicketsSold = row.total_tickets_sold || 0;
                summary.totalFullTickets = row.total_full_tickets || 0;
                summary.totalConcessionTickets = row.total_concession_tickets || 0;
            }
            finish(err);
        }
    );

    db.get(
        `SELECT COALESCE(SUM(full_price_tickets + concession_tickets), 0) AS tickets_remaining FROM events WHERE status = 'published'`,
        [],
        (err, row) => {
            if (!err && row) {
                summary.ticketsRemaining = row.tickets_remaining || 0;
            }
            finish(err);
        }
    );

    db.get(
        `SELECT
            strftime('%Y-%m', b.booked_at) AS month_key,
            COALESCE(SUM(${bookingAmountSql}), 0) AS revenue
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.status = 'confirmed'
         GROUP BY month_key
         ORDER BY revenue DESC
         LIMIT 1`,
        [],
        (err, row) => {
            if (!err && row && row.month_key) {
                const [year, month] = row.month_key.split('-');
                const monthName = new Date(`${row.month_key}-01T00:00:00`).toLocaleString('en-SG', { month: 'long', year: 'numeric' });
                summary.highestRevenueMonth = {
                    label: monthName,
                    revenue: row.revenue || 0
                };
            }
            finish(err);
        }
    );

    db.all(
        `SELECT
            e.title,
            b.booking_reference,
            COALESCE(SUM(${bookingAmountSql}), 0) AS revenue,
            COALESCE(SUM(b.full_price_qty + b.concession_qty), 0) AS tickets_sold
         FROM events e
         LEFT JOIN bookings b ON b.event_id = e.id AND b.status = 'confirmed'
         GROUP BY e.id
         ORDER BY revenue DESC
         LIMIT 4`,
        [],
        (err, rows) => {
            if (!err && rows) {
                summary.revenueByEvent = rows.map((row) => ({
                    title: row.title,
                    revenue: row.revenue || 0,
                    ticketsSold: row.tickets_sold || 0
                }));
            }
            finish(err);
        }
    );

    db.get(
        `SELECT
            e.title,
            COALESCE(SUM(b.full_price_qty + b.concession_qty), 0) AS tickets_sold
         FROM events e
         LEFT JOIN bookings b ON b.event_id = e.id AND b.status = 'confirmed'
         GROUP BY e.id
         HAVING COALESCE(SUM(b.full_price_qty + b.concession_qty), 0) > 0
         ORDER BY tickets_sold DESC
         LIMIT 1`,
        [],
        (err, row) => {
            if (!err && row) {
                summary.bestSellingEvent = {
                    title: row.title,
                    ticketsSold: row.tickets_sold || 0
                };
            }
            finish(err);
        }
    );

    db.all(
        `SELECT
            b.attendee_name,
            b.full_price_qty,
            b.concession_qty,
            b.booked_at,
            e.title AS event_title,
            ${bookingAmountSql} AS amount_paid,
            CASE 
                WHEN b.full_price_qty > 0 AND b.concession_qty > 0 THEN 'Mixed'
                WHEN b.full_price_qty > 0 THEN 'Full'
                ELSE 'Concession'
            END AS ticket_type
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.status = 'confirmed'
         ORDER BY datetime(b.booked_at) DESC
         LIMIT 3`,
        [],
        (err, rows) => {
            if (!err && rows) {
                summary.recentBookings = rows;
            }
            finish(err);
        }
    );
}

// Purpose: Retrieves the complete booking export and management dataset.
// Inputs: Callback. Outputs: Booking rows using immutable historical totals.
function getAllBookings(callback) {
    db.all(
        `SELECT
            b.id,
            b.attendee_name,
            b.status,
            b.checked_in_at,
            b.full_price_qty,
            b.concession_qty,
            b.booked_at,
            strftime('%Y-%m-%dT%H:%M:%S', b.booked_at) AS booked_at_iso,
            e.id AS event_id,
            e.title AS event_title,
            e.event_date AS event_date,
            e.event_time AS event_time,
            e.full_price_tickets AS event_full_price_tickets,
            e.concession_tickets AS event_concession_tickets,
            e.status AS event_status,
            ${bookingAmountSql} AS amount_paid,
            CASE 
                WHEN b.full_price_qty > 0 AND b.concession_qty > 0 THEN 'Mixed'
                WHEN b.full_price_qty > 0 THEN 'Full'
                ELSE 'Concession'
            END AS ticket_type
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         ORDER BY datetime(b.booked_at) DESC`,
        [],
        (err, rows) => {
            if (err) {
                console.error('Error fetching all bookings:', err.message);
                return callback(err, null);
            }
            callback(null, rows || []);
        }
    );
}

// Purpose: Retrieves one booking with its event and receipt information.
// Inputs: Booking ID and callback. Outputs: One enriched booking row.
function getBookingById(bookingId, callback) {
    db.get(
        `SELECT
            b.id,
            b.booking_reference,
            b.attendee_name,
            b.attendee_id,
            b.status,
            b.checked_in_at,
            b.full_price_qty,
            b.concession_qty,
            b.booked_at,
            strftime('%Y-%m-%dT%H:%M:%S', b.booked_at) AS booked_at_iso,
            e.id AS event_id,
            e.title AS event_title,
            e.event_date AS event_date,
            e.event_time AS event_time,
            e.location AS event_location,
            e.full_price_cost,
            e.concession_cost,
            b.payment_name,
            b.payment_email,
            b.payment_method,
            b.payment_last4,
            b.payment_brand,
            ${bookingAmountSql} AS amount_paid,
            CASE 
                WHEN b.full_price_qty > 0 AND b.concession_qty > 0 THEN 'Mixed'
                WHEN b.full_price_qty > 0 THEN 'Full'
                ELSE 'Concession'
            END AS ticket_type
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.id = ?`,
        [bookingId],
        callback
    );
}

// Purpose: Creates an attendee account with confirmation state.
// Inputs: Validated attendee data and callback. Outputs: New attendee ID.
function createAttendee(data, callback) {
    db.run(
        `INSERT INTO attendees (name, email, password_hash, created_at, confirmed, confirmation_token)
         VALUES (?, ?, ?, datetime('now', '+8 hours'), ?, ?)`,
        [data.name, data.email, data.password_hash, data.confirmed ? 1 : 0, data.confirmation_token || null],
        function (err) {
            if (err) return callback(err);
            callback(null, this.lastID);
        }
    );
}

// Purpose: Finds the attendee associated with a simulated confirmation token.
// Inputs: Token and callback. Outputs: Matching attendee row.
function getAttendeeByConfirmationToken(token, callback) {
    db.get('SELECT * FROM attendees WHERE confirmation_token = ?', [token], callback);
}

// Purpose: Marks an attendee confirmed and consumes their token.
// Inputs: Attendee ID and callback. Outputs: Updated account state.
function confirmAttendeeById(id, callback) {
    db.run('UPDATE attendees SET confirmed = 1, confirmation_token = NULL WHERE id = ?', [id], callback);
}

// Purpose: Retrieves an attendee for authentication.
// Inputs: Normalised email and callback. Outputs: Matching attendee row.
function getAttendeeByEmail(email, callback) {
    db.get('SELECT * FROM attendees WHERE email = ?', [email], callback);
}

// Purpose: Retrieves an attendee by primary key.
// Inputs: Attendee ID and callback. Outputs: Matching attendee row.
function getAttendeeById(id, callback) {
    db.get('SELECT * FROM attendees WHERE id = ?', [id], callback);
}

// Purpose: Records an attendee's latest successful login.
// Inputs: Attendee ID and callback. Outputs: Updates the login timestamp.
function updateAttendeeLastLogin(attendeeId, callback) {
    db.run(
        `UPDATE attendees SET last_login = datetime('now', '+8 hours') WHERE id = ?`,
        [attendeeId],
        callback
    );
}

// Purpose: Retrieves an attendee's personal booking history.
// Inputs: Attendee ID and callback. Outputs: Enriched bookings ordered newest first.
function getBookingsForAttendee(attendeeId, callback) {
    db.all(
        `SELECT
            b.id,
            b.booking_reference,
            b.attendee_name,
            b.full_price_qty,
            b.concession_qty,
            b.status,
            b.checked_in_at,
            b.booked_at,
            e.id AS event_id,
            e.title AS event_title,
            e.event_date,
            e.event_time,
            e.location,
            b.payment_name,
            b.payment_email,
            b.payment_method,
            b.payment_last4,
            b.payment_brand,
            ${bookingAmountSql} AS amount_paid
         FROM bookings b
         JOIN events e ON e.id = b.event_id
         WHERE b.attendee_id = ?
         ORDER BY datetime(b.booked_at) DESC`,
        [attendeeId],
        callback
    );
}

// Purpose: Adds an event to an attendee's favourites without duplication.
// Inputs: Attendee ID, event ID, and callback. Outputs: Insert result.
function addFavorite(attendeeId, eventId, callback) {
    db.run(
        `INSERT OR IGNORE INTO favorites (attendee_id, event_id) VALUES (?, ?)`,
        [attendeeId, eventId],
        function (err) {
            callback(err, this ? this.lastID : null);
        }
    );
}

// Purpose: Removes an event from an attendee's favourites.
// Inputs: Attendee ID, event ID, and callback. Outputs: Delete result.
function removeFavorite(attendeeId, eventId, callback) {
    db.run(
        `DELETE FROM favorites WHERE attendee_id = ? AND event_id = ?`,
        [attendeeId, eventId],
        callback
    );
}

// Purpose: Retrieves an attendee's saved published-event references.
// Inputs: Attendee ID and callback. Outputs: Favourite event rows.
function getFavoritesForAttendee(attendeeId, callback) {
    db.all(
        `SELECT f.event_id, f.created_at AS saved_at,
            e.title, e.description, e.event_date, e.event_time, e.location,
            e.full_price_tickets, e.concession_tickets, e.status
         FROM favorites f
         JOIN events e ON e.id = f.event_id
         WHERE f.attendee_id = ? AND e.status = 'published'
         ORDER BY f.created_at DESC`,
        [attendeeId],
        callback
    );
}

// Purpose: Retrieves an organiser for authentication.
// Inputs: Normalised email and callback. Outputs: Matching organiser row.
function getOrganiserByEmail(email, callback) {
    db.get('SELECT * FROM organisers WHERE email = ?', [email], callback);
}

// Purpose: Exposes a parameterised single-row query for controlled tests and helpers.
// Inputs: SQL, parameters, callback. Outputs: One matching row.
function getFromDb(sql, params, callback) {
    db.get(sql, params, callback);
}

// Purpose: Exposes a parameterised multi-row query for controlled tests and helpers.
// Inputs: SQL, parameters, callback. Outputs: Matching rows.
function allFromDb(sql, params, callback) {
    db.all(sql, params, callback);
}

// Purpose: Exposes a parameterised write query for controlled tests and helpers.
// Inputs: SQL, parameters, callback. Outputs: SQLite statement result.
function runInDb(sql, params, callback) {
    db.run(sql, params, callback);
}

// Purpose: Closes the shared SQLite connection during automated-test teardown.
// Inputs: Completion callback.
// Outputs: Releases the database handle and reports any close error.
function closeDatabase(callback) {
    db.close(callback);
}

module.exports = {
    get: getFromDb,
    all: allFromDb,
    run: runInDb,
    getSiteSettings,
    updateSiteSettings,
    getAllEvents,
    getPublishedEvents,
    getEventById,
    createEvent,
    updateEvent,
    publishEvent,
    deleteEvent,
    createBooking,
    cancelBooking,
    joinWaitlist,
    getWaitlistEntry,
    getWaitlistForAttendee,
    getBookingByReference,
    checkInBooking,
    restoreTicketsForBooking,
    getBookingDashboard,
    getBookingTotals,
    getBookingsForEvent,
    getBookingCount,
    getPublishedEventPopularityCounts,
    getRevenueOverview,
    processScheduledEvents,
    getAllBookings,
    createAttendee,
    getAttendeeByEmail,
    getAttendeeById,
    updateAttendeeLastLogin,
    getBookingsForAttendee,
    addFavorite,
    removeFavorite,
    getFavoritesForAttendee,
    getAttendeeByConfirmationToken,
    confirmAttendeeById,
    getBookingById,
    getOrganiserByEmail,
    updateOrganiserLastLogin,
    close: closeDatabase
};
