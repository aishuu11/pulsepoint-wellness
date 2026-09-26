const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');

const dbPath = process.env.DB_PATH || path.join(__dirname, 'eventflow.db');
const schemaPath = path.join(__dirname, 'db_schema.sql');

// Remove existing database so we start fresh each build
// By default do NOT remove the existing database to avoid accidental data loss.
// To force a reset (wipe and reseed), set the environment variable RESET_DB=1
if (process.env.RESET_DB === '1') {
    if (fs.existsSync(dbPath)) {
        fs.unlinkSync(dbPath);
        console.log('Removed existing database.');
    }
} else {
    if (fs.existsSync(dbPath)) {
        console.log('Existing database detected. To rebuild and wipe data set RESET_DB=1 and re-run this script.');
    }
}

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
        process.exit(1);
    }
    console.log('Connected to SQLite database at:', dbPath);
});

const schema = fs.readFileSync(schemaPath, 'utf8');

db.exec(schema, (err) => {
    if (err) {
        console.error('Error creating schema:', err.message);
        process.exit(1);
    }

    const defaultEmail = 'organiser@example.com';
    const defaultPassword = 'EventFlow123!';
    const defaultName = 'Aishwarya';
    const passwordHash = bcrypt.hashSync(defaultPassword, 10);

    db.run(
        `INSERT OR IGNORE INTO organisers (name, email, password_hash)
         VALUES (?, ?, ?)`,
        [defaultName, defaultEmail, passwordHash],
        function (insertErr) {
            if (insertErr) {
                console.error('Error seeding organiser account:', insertErr.message);
                process.exit(1);
            }
            if (this.changes === 0) {
                console.log('Organiser account already exists:', defaultEmail);
            } else {
                console.log('Organiser account seeded:', defaultEmail);
                console.log('Default password:', defaultPassword);
            }

            // Seed sample attendee account
            const attendeeEmail = 'attendee@example.com';
            const attendeePassword = 'EventFlow123!';
            const attendeeName = 'Sample Attendee';
            const attendeePasswordHash = bcrypt.hashSync(attendeePassword, 10);

            db.run(
                `INSERT OR IGNORE INTO attendees (name, email, password_hash, confirmed)
                 VALUES (?, ?, ?, 1)`,
                [attendeeName, attendeeEmail, attendeePasswordHash],
                function (attendeeErr) {
                    if (attendeeErr) {
                        console.error('Error seeding attendee account:', attendeeErr.message);
                        process.exit(1);
                    }
                    if (this.changes === 0) {
                        console.log('Attendee account already exists:', attendeeEmail);
                    } else {
                        console.log('Attendee account seeded:', attendeeEmail);
                        console.log('Default password:', attendeePassword);
                    }
                    console.log('Database build complete.');
                    db.close();
                }
            );
        }
    );
});
