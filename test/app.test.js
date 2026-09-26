const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const bcrypt = require('bcryptjs');
const request = require('supertest');

const projectRoot = path.join(__dirname, '..');
const testDbPath = path.join(__dirname, 'tmp-eventflow.db');
process.env.DB_PATH = testDbPath;
process.env.SESSION_SECRET = 'eventflow-test-secret';
process.env.NODE_ENV = 'test';

if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
const buildResult = spawnSync(process.execPath, [path.join(projectRoot, 'db', 'build_db.js')], {
    cwd: projectRoot,
    env: { ...process.env, RESET_DB: '1' },
    encoding: 'utf8'
});
if (buildResult.status !== 0) {
    throw new Error(buildResult.stderr || buildResult.stdout || 'Test database build failed.');
}

const app = require('../index');
const db = require('../routes/db');

// Purpose: Executes a write statement against the isolated test database.
// Inputs: SQL and optional parameters. Outputs: Promise containing SQLite run metadata.
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

// Purpose: Reads one row from the isolated test database.
// Inputs: SQL and optional parameters. Outputs: Promise containing the selected row.
function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

// Purpose: Creates an authenticated organiser test session.
// Inputs: Supertest agent. Outputs: Promise for the login response.
function loginAsOrganiser(agent) {
    return agent.post('/organiser/login').type('form').send({
        email: 'organiser@example.com',
        password: 'EventFlow123!'
    });
}

// Purpose: Creates an authenticated attendee test session.
// Inputs: Supertest agent and optional credentials. Outputs: Promise for the login response.
function loginAsAttendee(agent, email = 'attendee@example.com', password = 'EventFlow123!') {
    return agent.post('/attendee/login').type('form').send({ email, password });
}

// Purpose: Creates and publishes a valid event fixture through public routes.
// Inputs: Authenticated organiser agent and optional field overrides. Outputs: Published event record.
async function createPublishedEvent(agent, overrides = {}) {
    const draftResponse = await agent.post('/organiser/events/create-draft');
    const eventId = Number(draftResponse.headers.location.match(/events\/(\d+)\/edit/)[1]);
    const data = {
        title: 'Launch Night',
        description: 'A complete event used by the automated tests.',
        event_date: '2030-01-20',
        event_time: '19:00',
        duration_minutes: '90',
        location: 'Harbour Hall',
        full_price_tickets: '10',
        full_price_cost: '20',
        concession_tickets: '5',
        concession_cost: '10',
        scheduled_publish_at: '',
        booking_deadline: '',
        ...overrides
    };
    const updateResponse = await agent.post(`/organiser/events/${eventId}/update`).type('form').send(data);
    assert.equal(updateResponse.status, 302);
    const publishResponse = await agent.post(`/organiser/events/${eventId}/publish`);
    assert.equal(publishResponse.status, 302);
    return { eventId, data };
}

// Purpose: Creates a valid booking fixture through the attendee route.
// Inputs: Supertest agent, event ID, and optional booking overrides. Outputs: Booking response.
async function bookEvent(agent, eventId, overrides = {}) {
    return agent.post(`/attendee/events/${eventId}/book`).type('form').send({
        attendee_name: 'Sample Attendee',
        payment_name: 'Sample Attendee',
        payment_method: 'card',
        payment_number: '4111111111111111',
        payment_expiry: '12/30',
        payment_cvv: '123',
        full_price_qty: '1',
        concession_qty: '1',
        ...overrides
    });
}

test.beforeEach(async () => {
    await run('DELETE FROM favorites');
    await run('DELETE FROM waitlist_entries');
    await run('DELETE FROM bookings');
    await run('DELETE FROM events');
    await run("DELETE FROM attendees WHERE email <> 'attendee@example.com'");
    await run("UPDATE site_settings SET name = 'EventFlow', description = 'Flexible event management for organizers and attendees' WHERE id = 1");
});

test.after(async () => {
    await new Promise((resolve, reject) => db.close((err) => (err ? reject(err) : resolve())));
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
});

test('clean database build creates all required tables', async () => {
    const row = await get("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('site_settings','events','organisers','attendees','bookings','favorites','waitlist_entries')");
    assert.equal(row.count, 7);
});

test('main page and attendee page are available', async () => {
    assert.equal((await request(app).get('/')).status, 200);
    assert.equal((await request(app).get('/attendee')).status, 200);
});

test('organiser routes require authentication', async () => {
    const response = await request(app).get('/organiser');
    assert.ok([302, 303].includes(response.status));
    assert.equal(response.headers.location, '/organiser/login');
});

test('settings reject empty values and accept valid updates', async () => {
    const agent = request.agent(app);
    await loginAsOrganiser(agent);
    const invalid = await agent.post('/settings/update').type('form').send({ name: '', description: '' });
    assert.equal(invalid.status, 400);
    assert.match(invalid.text, /required/i);
    const valid = await agent.post('/settings/update').type('form').send({ name: 'Studio Events', description: 'Inclusive community events.', display_font_family: 'Inter' });
    assert.equal(valid.status, 302);
    const saved = await get('SELECT name, description FROM site_settings WHERE id = 1');
    assert.equal(saved.name, 'Studio Events');
});

test('draft creation works and incomplete publication is rejected', async () => {
    const agent = request.agent(app);
    await loginAsOrganiser(agent);
    const draft = await agent.post('/organiser/events/create-draft');
    assert.match(draft.headers.location, /events\/\d+\/edit/);
    const eventId = draft.headers.location.match(/events\/(\d+)\/edit/)[1];
    const publish = await agent.post(`/organiser/events/${eventId}/publish`);
    assert.equal(publish.status, 400);
});

test('save and publish validates the current form instead of the previous draft copy', async () => {
    const agent = request.agent(app);
    await loginAsOrganiser(agent);
    const draft = await agent.post('/organiser/events/create-draft');
    const eventId = Number(draft.headers.location.match(/events\/(\d+)\/edit/)[1]);
    const response = await agent.post(`/organiser/events/${eventId}/update`).type('form').send({
        action: 'publish',
        title: 'Current Form Publishing',
        description: 'This description exists in the submitted form and must be saved before publishing.',
        event_date: '2030-02-10',
        event_time: '18:30',
        duration_minutes: '60',
        location: 'Pulse Studio',
        full_price_tickets: '12',
        full_price_cost: '24',
        concession_tickets: '4',
        concession_cost: '14',
        scheduled_publish_at: '',
        booking_deadline: ''
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/organiser');
    const saved = await get('SELECT status, description FROM events WHERE id = ?', [eventId]);
    assert.equal(saved.status, 'published');
    assert.match(saved.description, /submitted form/);
});

test('optional event photos save safely and appear on attendee pages', async () => {
    const agent = request.agent(app);
    await loginAsOrganiser(agent);
    const draft = await agent.post('/organiser/events/create-draft');
    const eventId = Number(draft.headers.location.match(/events\/(\d+)\/edit/)[1]);
    const imageData = 'data:image/png;base64,iVBORw0KGgo=';
    const response = await agent.post(`/organiser/events/${eventId}/update`).type('form').send({
        action: 'publish',
        title: 'Photo Event',
        description: 'A complete event with an optional organiser photo.',
        image_data: imageData,
        event_date: '2030-02-11',
        event_time: '19:00',
        duration_minutes: '45',
        location: 'Movement Room',
        full_price_tickets: '8',
        full_price_cost: '18',
        concession_tickets: '2',
        concession_cost: '12',
        scheduled_publish_at: '',
        booking_deadline: ''
    });
    assert.equal(response.status, 302);
    assert.equal((await get('SELECT image_data FROM events WHERE id = ?', [eventId])).image_data, imageData);
    const attendeePage = await request(app).get(`/attendee/events/${eventId}`);
    assert.equal(attendeePage.status, 200);
    assert.match(attendeePage.text, /data:image\/png;base64,iVBORw0KGgo=/);
});

test('valid event publication appears on attendee home', async () => {
    const agent = request.agent(app);
    await loginAsOrganiser(agent);
    const { eventId } = await createPublishedEvent(agent, { title: 'Visible Future Event' });
    const attendeeHome = await request(app).get('/attendee');
    assert.match(attendeeHome.text, /Visible Future Event/);
    assert.equal((await request(app).get(`/attendee/events/${eventId}`)).status, 200);
});

test('draft and past events cannot be booked', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const draft = await organiser.post('/organiser/events/create-draft');
    const draftId = draft.headers.location.match(/events\/(\d+)\/edit/)[1];
    const attendee = request.agent(app);
    await loginAsAttendee(attendee);
    assert.match((await bookEvent(attendee, draftId)).headers.location, /event_unavailable/);

    const { eventId } = await createPublishedEvent(organiser);
    await run("UPDATE events SET event_date = '2020-01-01' WHERE id = ?", [eventId]);
    assert.match((await bookEvent(attendee, eventId)).headers.location, /event_unavailable/);
});

test('valid booking succeeds and invalid quantities are rejected visibly', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const { eventId } = await createPublishedEvent(organiser, { full_price_tickets: '2', concession_tickets: '1' });
    const attendee = request.agent(app);
    await loginAsAttendee(attendee);
    const valid = await bookEvent(attendee, eventId);
    assert.equal(valid.status, 200);
    assert.match(valid.text, /Booking summary/i);

    for (const quantities of [
        { full_price_qty: '-1', concession_qty: '0' },
        { full_price_qty: '0.5', concession_qty: '0' },
        { full_price_qty: '0', concession_qty: '0' }
    ]) {
        const response = await bookEvent(attendee, eventId, quantities);
        assert.equal(response.status, 302);
        const page = await attendee.get(response.headers.location);
        assert.equal(page.status, 200);
        assert.match(page.text, /whole numbers|at least one ticket/i);
    }
});

test('overbooking is rejected with a visible availability message', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const { eventId } = await createPublishedEvent(organiser, { full_price_tickets: '1', concession_tickets: '0' });
    const attendee = request.agent(app);
    await loginAsAttendee(attendee);
    const response = await bookEvent(attendee, eventId, { full_price_qty: '2', concession_qty: '0' });
    assert.ok([302, 303].includes(response.status));
    const page = await attendee.get(response.headers.location);
    assert.match(page.text, /no longer available|smaller quantity/i);
});

test('historical booking revenue is unchanged after event price edits', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const { eventId, data } = await createPublishedEvent(organiser);
    const attendee = request.agent(app);
    await loginAsAttendee(attendee);
    await bookEvent(attendee, eventId, { full_price_qty: '2', concession_qty: '1' });
    const booking = await get('SELECT id, total_amount_paid FROM bookings WHERE event_id = ?', [eventId]);
    assert.equal(booking.total_amount_paid, 50);

    await organiser.post(`/organiser/events/${eventId}/update`).type('form').send({ ...data, full_price_cost: '999', concession_cost: '555', full_price_tickets: '8', concession_tickets: '4' });
    const details = await new Promise((resolve, reject) => db.getBookingById(booking.id, (err, row) => (err ? reject(err) : resolve(row))));
    const overview = await new Promise((resolve, reject) => db.getRevenueOverview((err, row) => (err ? reject(err) : resolve(row))));
    assert.equal(details.amount_paid, 50);
    assert.equal(overview.totalRevenue, 50);
});

test('cancellation restores inventory once and enforces ownership', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const { eventId } = await createPublishedEvent(organiser, { full_price_tickets: '2', concession_tickets: '0' });
    const owner = request.agent(app);
    await loginAsAttendee(owner);
    await bookEvent(owner, eventId, { full_price_qty: '1', concession_qty: '0' });
    const booking = await get('SELECT id FROM bookings WHERE event_id = ?', [eventId]);

    const otherHash = bcrypt.hashSync('OtherPass123!', 4);
    await run("INSERT INTO attendees (name,email,password_hash,confirmed) VALUES ('Other Attendee','other@example.com',?,1)", [otherHash]);
    const other = request.agent(app);
    await loginAsAttendee(other, 'other@example.com', 'OtherPass123!');
    assert.equal((await other.post(`/attendee/bookings/${booking.id}/cancel`)).status, 403);

    assert.match((await owner.post(`/attendee/bookings/${booking.id}/cancel`)).headers.location, /success=cancelled/);
    assert.match((await owner.post(`/attendee/bookings/${booking.id}/cancel`)).headers.location, /error=cancel_failed/);
    const event = await get('SELECT full_price_tickets FROM events WHERE id = ?', [eventId]);
    assert.equal(event.full_price_tickets, 2);
});

test('deleting an event cascades to bookings and favourites', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const { eventId } = await createPublishedEvent(organiser);
    const attendee = request.agent(app);
    await loginAsAttendee(attendee);
    await bookEvent(attendee, eventId);
    const attendeeRow = await get("SELECT id FROM attendees WHERE email = 'attendee@example.com'");
    await run('INSERT INTO favorites (attendee_id,event_id) VALUES (?,?)', [attendeeRow.id, eventId]);
    assert.equal((await organiser.post(`/organiser/events/${eventId}/delete`)).status, 302);
    assert.equal((await get('SELECT COUNT(*) AS count FROM bookings WHERE event_id = ?', [eventId])).count, 0);
    assert.equal((await get('SELECT COUNT(*) AS count FROM favorites WHERE event_id = ?', [eventId])).count, 0);
});

test('booking deadlines must precede the session and block late bookings', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const draftResponse = await organiser.post('/organiser/events/create-draft');
    const draftId = Number(draftResponse.headers.location.match(/events\/(\d+)\/edit/)[1]);
    const invalid = await organiser.post('/organiser/events/' + draftId + '/update').type('form').send({
        title: 'Deadline Validation', description: 'Deadline validation event.',
        event_date: '2030-01-20', event_time: '19:00', duration_minutes: '60', location: 'Studio A',
        full_price_tickets: '2', full_price_cost: '20', concession_tickets: '0', concession_cost: '0',
        scheduled_publish_at: '', booking_deadline: '2030-01-20T20:00'
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.text, /deadline must be before/i);

    const published = await createPublishedEvent(organiser, { booking_deadline: '2029-12-20T18:00' });
    await run("UPDATE events SET booking_deadline = '2020-01-01 00:00:00' WHERE id = ?", [published.eventId]);
    const attendee = request.agent(app);
    await loginAsAttendee(attendee);
    const blocked = await bookEvent(attendee, published.eventId, { full_price_qty: '1', concession_qty: '0' });
    assert.match(blocked.headers.location, /error=deadline/);
});

test('waitlist rejects duplicates and automatically promotes after cancellation', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const published = await createPublishedEvent(organiser, { full_price_tickets: '1', concession_tickets: '0' });
    const owner = request.agent(app);
    await loginAsAttendee(owner);
    await bookEvent(owner, published.eventId, { full_price_qty: '1', concession_qty: '0' });
    const ownerBooking = await get("SELECT id FROM bookings WHERE event_id = ? AND attendee_id = (SELECT id FROM attendees WHERE email = 'attendee@example.com')", [published.eventId]);

    const waitHash = bcrypt.hashSync('WaitPass123!', 4);
    await run("INSERT INTO attendees (name,email,password_hash,confirmed) VALUES ('Waiting Member','waiting@example.com',?,1)", [waitHash]);
    const waiting = request.agent(app);
    await loginAsAttendee(waiting, 'waiting@example.com', 'WaitPass123!');
    assert.match((await waiting.post('/attendee/events/' + published.eventId + '/waitlist')).headers.location, /waitlist_success/);
    assert.match((await waiting.post('/attendee/events/' + published.eventId + '/waitlist')).headers.location, /waitlist_error/);

    await owner.post('/attendee/bookings/' + ownerBooking.id + '/cancel');
    const entry = await get("SELECT status, booking_id FROM waitlist_entries WHERE event_id = ? AND attendee_id = (SELECT id FROM attendees WHERE email = 'waiting@example.com')", [published.eventId]);
    assert.equal(entry.status, 'promoted');
    assert.ok(entry.booking_id);
    const promoted = await get('SELECT status, payment_method FROM bookings WHERE id = ?', [entry.booking_id]);
    assert.equal(promoted.status, 'confirmed');
    assert.equal(promoted.payment_method, 'waitlist_auto');
    assert.equal((await get('SELECT full_price_tickets FROM events WHERE id = ?', [published.eventId])).full_price_tickets, 0);
});

test('organiser check-in succeeds once and rejects duplicate or cancelled check-ins', async () => {
    const organiser = request.agent(app);
    await loginAsOrganiser(organiser);
    const published = await createPublishedEvent(organiser, { full_price_tickets: '2', concession_tickets: '0' });
    const attendee = request.agent(app);
    await loginAsAttendee(attendee);
    await bookEvent(attendee, published.eventId, { full_price_qty: '1', concession_qty: '0' });
    const booking = await get("SELECT id FROM bookings WHERE event_id = ? AND status = 'confirmed'", [published.eventId]);

    const first = await organiser.post('/organiser/bookings/' + booking.id + '/check-in');
    assert.match(first.headers.location, /checkin_success=1/);
    assert.ok((await get('SELECT checked_in_at FROM bookings WHERE id = ?', [booking.id])).checked_in_at);
    const duplicate = await organiser.post('/organiser/bookings/' + booking.id + '/check-in');
    assert.match(duplicate.headers.location, /checkin_error=/);

    await run("UPDATE bookings SET status = 'cancelled', checked_in_at = NULL WHERE id = ?", [booking.id]);
    const cancelled = await organiser.post('/organiser/bookings/' + booking.id + '/check-in');
    assert.match(cancelled.headers.location, /Cancelled%20bookings%20cannot%20be%20checked%20in/);
});

test('unconfirmed attendees cannot log in until simulated confirmation', async () => {
    const passwordHash = bcrypt.hashSync('ConfirmPass123!', 4);
    await run("INSERT INTO attendees (name,email,password_hash,confirmed,confirmation_token) VALUES ('Pending','pending@example.com',?,0,'test-token')", [passwordHash]);
    const agent = request.agent(app);
    const blocked = await loginAsAttendee(agent, 'pending@example.com', 'ConfirmPass123!');
    assert.equal(blocked.status, 403);
    assert.match(blocked.text, /confirm your account/i);
    assert.equal((await agent.get('/attendee/confirm/test-token')).status, 200);
    assert.equal((await loginAsAttendee(agent, 'pending@example.com', 'ConfirmPass123!')).status, 302);
});
