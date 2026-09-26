const express = require('express');
const path = require('path');
const session = require('express-session');
const db = require('./routes/db');
const { formatDateDisplay, formatDateTimeDisplay, countWords } = require('./utils/formatDate');

const app = express();
const PORT = process.env.PORT || 3000;

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true, limit: '6mb' }));
app.use(express.json({ limit: '6mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET || 'eventflow-development-only-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production'
    }
}));
app.use(express.static(path.join(__dirname, 'public')));

// Purpose: Makes authentication state and formatting helpers available to every view.
// Inputs: Express request, response, and next middleware. Outputs: Populates res.locals and continues.
app.use((req, res, next) => {
    res.locals.currentUser = req.session && req.session.user ? req.session.user : null;
    res.locals.currentAttendee = req.session && req.session.attendee ? req.session.attendee : null;
    res.locals.isGuestMode = Boolean(req.session && req.session.guestMode);
    res.locals.formatDateDisplay = formatDateDisplay;
    res.locals.formatDateTimeDisplay = formatDateTimeDisplay;
    res.locals.countWords = countWords;
    next();
});

// Purpose: Loads site settings from SQLite for every server-rendered page.
// Inputs: Express request, response, and next middleware. Outputs: Populates res.locals.siteSettings and continues.
app.use((req, res, next) => {
    db.getSiteSettings((err, settings) => {
        if (err) {
            console.error('Error loading site settings:', err.message);
            res.locals.siteSettings = {
                name: 'PulsePoint Wellness',
                description: 'Strength, movement and recovery — built for every body.',
                display_font_family: 'Barlow Condensed',
                description_italic: 0,
                last_modified_at: null
            };
        } else {
            res.locals.siteSettings = settings || {
                name: 'PulsePoint Wellness',
                description: 'Strength, movement and recovery — built for every body.',
                display_font_family: 'Barlow Condensed',
                description_italic: 0,
                last_modified_at: null
            };
        }
        next();
    });
});

// Routes
const indexRouter = require('./routes/index');
const organiserRouter = require('./routes/organiser');
const attendeeRouter = require('./routes/attendee');
const settingsRouter = require('./routes/settings');

app.use('/', indexRouter);
app.use('/organiser', organiserRouter);
app.use('/attendee', attendeeRouter);
app.use('/settings', settingsRouter);

// Purpose: Starts the background processor that publishes eligible scheduled events.
// Inputs: None; it checks SQLite once per minute.
// Outputs: Returns the interval handle so callers can stop it during controlled shutdown.
function startScheduledPublishProcessor() {
    return setInterval(() => {
        db.processScheduledEvents((err, count) => {
            if (err) {
                console.error('Scheduled publish processor failed:', err.message);
            } else if (count && count > 0) {
                console.log(`Published ${count} scheduled event(s).`);
            }
        });
    }, 60 * 1000);
}

// Purpose: Handles unmatched URLs with a clear not-found page.
// Inputs: Express request and response. Outputs: Renders HTTP 404 response.
app.use((req, res) => {
    res.status(404).render('error', {
        title: 'Page Not Found',
        message: 'The page you are looking for does not exist.',
        statusCode: 404
    });
});

// Purpose: Handles unexpected application errors without exposing internal details.
// Inputs: Error plus Express request, response, and next middleware. Outputs: Renders HTTP 500 response.
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).render('error', {
        title: 'Server Error',
        message: 'Something went wrong on our end. Please try again later.',
        statusCode: 500
    });
});

if (require.main === module) {
    startScheduledPublishProcessor();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`PulsePoint Wellness running at http://localhost:${PORT}`);
    });
}

module.exports = app;
module.exports.startScheduledPublishProcessor = startScheduledPublishProcessor;
