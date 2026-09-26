const express = require('express');
const bcrypt = require('bcryptjs');
const router = express.Router();
const db = require('./db');
const { ensureAuthenticated } = require('../middleware/auth');
const { formatDateTimeDisplay } = require('../utils/formatDate');
const MAX_EVENT_IMAGE_LENGTH = 2800000;

// Purpose: Normalizes an HTML date-time value into SQLite date-time format.
// Inputs: Date-time string. Outputs: Normalized string or null when empty.
function normalizeScheduledPublish(value) {
    if (!value) return null;
    let rawValue = String(value).trim();
    if (!rawValue) return null;
    rawValue = rawValue.replace('T', ' ');
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(rawValue)) {
        rawValue = `${rawValue}:00`;
    }
    return rawValue;
}

// Purpose: Converts optional numeric form values without treating blanks as invalid numbers.
// Inputs: Raw form value. Outputs: Number, with blank values represented by zero.
function parseNumericInput(value) {
    const rawValue = String(value ?? '').trim();
    return rawValue === '' ? 0 : Number(rawValue);
}

// Purpose: Validates an optional browser-encoded event photograph before database storage.
// Inputs: Data-URL string. Outputs: A validation message or null when valid/empty.
function validateEventImage(value) {
    if (!value) return null;
    const imageData = String(value).trim();
    if (imageData.length > MAX_EVENT_IMAGE_LENGTH) return 'The event photo is too large. Choose an image under 2 MB.';
    if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(imageData)) {
        return 'The event photo must be a JPG, PNG, or WEBP image.';
    }
    return null;
}

// Purpose: Applies server-side event validation before saving or publishing.
// Inputs: Event form data and draft-permission option. Outputs: Array of validation messages.
function validateEventPayload(data, { allowDraft = true } = {}) {
    const errors = [];
    if (!data.title || !String(data.title).trim()) errors.push('A meaningful title is required.');
    if (!data.description || !String(data.description).trim()) errors.push('A description is required.');
    if (!data.event_date) {
        if (allowDraft === false) errors.push('An event date is required before publication.');
    } else if (Number.isNaN(new Date(`${data.event_date}T00:00:00`).getTime())) {
        errors.push('The event date must be a valid date.');
    }
    if (data.event_time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(data.event_time))) {
        errors.push('The event time must be valid.');
    }
    if (data.scheduled_publish_at) {
        const futureDate = new Date(normalizeScheduledPublish(data.scheduled_publish_at));
        if (Number.isNaN(futureDate.getTime()) || futureDate <= new Date()) {
            errors.push('Scheduled publication must be a valid future date and time.');
        }
    }
    if (data.booking_deadline) {
        const deadline = new Date(normalizeScheduledPublish(data.booking_deadline));
        if (Number.isNaN(deadline.getTime())) {
            errors.push('The booking deadline must be a valid date and time.');
        } else if (!data.event_date) {
            errors.push('Set the event date before adding a booking deadline.');
        } else {
            const sessionStart = new Date(`${data.event_date}T${data.event_time || '23:59'}:00`);
            if (deadline >= sessionStart) errors.push('The booking deadline must be before the session starts.');
            if (deadline <= new Date()) errors.push('The booking deadline must be in the future.');
        }
    }
    if (!Number.isInteger(Number(data.duration_minutes || 0)) || Number(data.duration_minutes || 0) < 0) {
        errors.push('Duration must be a non-negative integer.');
    }
    if (!Number.isInteger(Number(data.full_price_tickets || 0)) || Number(data.full_price_tickets || 0) < 0) {
        errors.push('Full-price ticket quantity must be a non-negative integer.');
    }
    if (!Number.isInteger(Number(data.concession_tickets || 0)) || Number(data.concession_tickets || 0) < 0) {
        errors.push('Concession ticket quantity must be a non-negative integer.');
    }
    if (Number.isNaN(Number(data.full_price_cost)) || Number(data.full_price_cost) < 0) {
        errors.push('Full-price ticket price must be a valid non-negative number.');
    }
    if (Number.isNaN(Number(data.concession_cost)) || Number(data.concession_cost) < 0) {
        errors.push('Concession ticket price must be a valid non-negative number.');
    }
    if (data.image_update_requested) {
        const imageError = validateEventImage(data.image_data);
        if (imageError) errors.push(imageError);
    }
    return errors;
}

// Purpose: Renders the organiser login page.
// Inputs: Existing organiser session from req.session.
// Outputs: Shows the login form or redirects an authenticated organiser to the dashboard.
router.get('/login', (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect('/organiser');
    }
    res.render('login', { title: 'Organiser Login', error: null });
});

// Purpose: Authenticates an organiser and starts a protected session.
// Inputs: Email and password from req.body.
// Outputs: Redirects to the organiser dashboard or renders a validation error.
router.post('/login', (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
        return res.render('login', {
            title: 'Organiser Login',
            error: 'Please enter both email and password.'
        });
    }

    db.getOrganiserByEmail(email, (err, organiser) => {
        if (err || !organiser) {
            return res.render('login', {
                title: 'Organiser Login',
                error: 'Invalid email or password.'
            });
        }

        bcrypt.compare(password, organiser.password_hash, (compareErr, isMatch) => {
            if (compareErr || !isMatch) {
                return res.render('login', {
                    title: 'Organiser Login',
                    error: 'Invalid email or password.'
                });
            }

            req.session.regenerate((sessionErr) => {
                if (sessionErr) {
                    console.error('Session regeneration error:', sessionErr.message);
                    return res.status(500).render('error', {
                        title: 'Error',
                        message: 'Unable to create your session. Please try again.',
                        statusCode: 500
                    });
                }

                const previousLoginText = organiser.last_login ? formatDateTimeDisplay(organiser.last_login) : null;

                req.session.user = {
                    id: organiser.id,
                    email: organiser.email,
                    name: organiser.name,
                    lastLogin: previousLoginText
                };

                db.updateOrganiserLastLogin(organiser.id, (updateErr) => {
                    if (updateErr) {
                        console.error('Error saving organiser last login:', updateErr.message);
                    }
                    res.redirect('/organiser');
                });
            });
        });
    });
});

// Purpose: Ends the current organiser session.
// Inputs: Organiser session from req.session.
// Outputs: Destroys the session and redirects to organiser login.
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Logout error:', err.message);
        }
        res.clearCookie('connect.sid');
        res.redirect('/organiser/login');
    });
});

// Protect organiser pages after auth routes
router.use(ensureAuthenticated);

// Purpose: Renders the organiser dashboard and refreshes the event list.
// Inputs: Authenticated organiser session from req.session.
// Outputs: Renders the organiser home page with published, draft, and scheduled events plus booking totals.
router.get('/', (req, res) => {
    db.processScheduledEvents((scheduleErr) => {
        if (scheduleErr) {
            console.error('Error processing scheduled events:', scheduleErr.message);
        }

        db.getSiteSettings((settingsErr, settings) => {
            if (settingsErr) settings = { name: 'PulsePoint Wellness', description: 'Strength, movement and recovery for every body.', display_font_family: 'Barlow Condensed', description_italic: 0, last_modified_at: null };
            
            db.getAllEvents((err, events) => {
                if (err) {
                    console.error('Error fetching events:', err.message);
                    return res.status(500).render('error', {
                        title: 'Error',
                        message: 'Could not load events.',
                        statusCode: 500
                    });
                }

                db.getBookingTotals((totalsErr, totals) => {
                    if (totalsErr) {
                        console.error('Error fetching booking totals:', totalsErr.message);
                        totals = {
                            total_bookings: 0,
                            total_tickets: 0,
                            total_revenue: 0
                        };
                    }

                    res.render('organiser_home', {
                        title: 'Organiser Dashboard',
                        events: events || [],
                        currentUser: req.session.user,
                        siteSettings: settings,
                        totals: totals || {}
                    });
                });
            });
        });
    });
});

// Purpose: Instantly creates a blank draft event and redirects the organiser to its edit screen.
// Inputs: No request body data is required.
// Outputs: Inserts a new draft event into SQLite and redirects to the organiser edit page for that event.
router.post('/events/create-draft', (req, res) => {
    db.createEvent((err, newId) => {
        if (err) {
            console.error('Error creating draft event:', err && err.message ? err.message : err);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Could not create a new draft event.',
                statusCode: 500
            });
        }

        res.redirect(`/organiser/events/${newId}/edit`);
    });
});

// Purpose: Renders the standalone create-event form for manual event drafting.
// Inputs: Authenticated organiser session from req.session.
// Outputs: Renders the create-event form with default draft values.
router.get('/events/new', (req, res) => {
    res.render('create_event', {
        title: 'Create New Event',
        event: {
            title: '',
            description: '',
            image_data: null,
            event_date: '',
            event_time: '',
            scheduled_publish_at: '',
            duration_minutes: 0,
            location: '',
            full_price_tickets: 0,
            full_price_cost: 0.00,
            concession_tickets: 0,
            concession_cost: 0.00,
            booking_deadline: '',
            status: 'draft',
            created_at: new Date().toISOString().split('T')[0],
            last_modified_at: new Date().toISOString()
        },
        bookings: { full_price_booked: 0, concession_booked: 0 },
        currentUser: req.session.user
    });
});

// Purpose: Saves a manually entered draft event from the create-event form.
// Inputs: Event form values from req.body.
// Outputs: Stores the new draft event in SQLite and redirects to the edit page or publishes it immediately.
router.post('/events/new', (req, res) => {
    const data = {
        title: req.body.title || 'New Event',
        description: req.body.description || '',
        image_data: req.body.image_data || null,
        image_update_requested: Boolean(req.body.image_data),
        event_date: req.body.event_date || null,
        event_time: req.body.event_time || null,
        scheduled_publish_at: normalizeScheduledPublish(req.body.scheduled_publish_at),
        booking_deadline: normalizeScheduledPublish(req.body.booking_deadline),
        location: req.body.location || '',
        duration_minutes: parseNumericInput(req.body.duration_minutes),
        full_price_tickets: parseNumericInput(req.body.full_price_tickets),
        full_price_cost: parseNumericInput(req.body.full_price_cost),
        concession_tickets: parseNumericInput(req.body.concession_tickets),
        concession_cost: parseNumericInput(req.body.concession_cost)
    };

    const validationErrors = validateEventPayload(data, { allowDraft: true });
    if (validationErrors.length > 0) {
        return res.status(400).render('create_event', {
            title: 'Create New Event',
            event: { ...data, status: 'draft' },
            bookings: { full_price_booked: 0, concession_booked: 0 },
            currentUser: req.session.user,
            validationErrors
        });
    }

    db.createEvent((err, newId) => {
        if (err) {
            console.error('Error creating event:', err && err.message ? err.message : err);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Could not create event.',
                statusCode: 500
            });
        }
        db.updateEvent(newId, data, (updateErr) => {
            if (updateErr) {
                console.error('Error saving new draft:', updateErr && updateErr.message ? updateErr.message : updateErr, 'data:', data);
                return res.status(500).render('error', {
                    title: 'Error',
                    message: 'Could not save draft event.',
                    statusCode: 500
                });
            }
            if (req.body && req.body.action === 'publish') {
                db.publishEvent(newId, (pubErr) => {
                    if (pubErr) {
                        console.error('Error publishing new event:', pubErr.message);
                        return res.status(400).render('create_event', {
                            title: 'Create New Event',
                            event: { ...data, status: 'draft' },
                            bookings: { full_price_booked: 0, concession_booked: 0 },
                            currentUser: req.session.user,
                            validationErrors: [pubErr.message]
                        });
                    }
                    return res.redirect('/organiser');
                });
            } else {
                res.redirect(`/organiser/events/${newId}/edit`);
            }
        });
    });
});

// Purpose: Renders the organiser revenue dashboard with summaries and performance insights.
// Inputs: Authenticated organiser session from req.session.
// Outputs: Renders revenue statistics, event performance tables, upcoming events, and comparison summary data.
router.get('/revenue', (req, res) => {
    db.getRevenueOverview((err, summary) => {
        if (err) {
            console.error('Error loading revenue dashboard:', err.message);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Unable to load revenue data.',
                statusCode: 500
            });
        }

        // Fetch published events and all bookings to compute today/yesterday metrics
        db.getPublishedEvents((eventsErr, publishedEvents) => {
            if (eventsErr) {
                console.error('Error loading published events for revenue dashboard:', eventsErr.message);
                publishedEvents = [];
            }

            db.getAllBookings((bookingsErr, allBookings) => {
                if (bookingsErr) {
                    console.error('Error loading bookings for revenue dashboard:', bookingsErr.message);
                    allBookings = [];
                }

                // Purpose: Converts a booking timestamp into a local YYYY-MM-DD key.
                // Inputs: Date object or timestamp text. Outputs: Date key or null for invalid input.
                const getDateKey = (value) => {
                    if (!value) return null;
                    const parsedDate = value instanceof Date ? value : new Date(String(value).trim());
                    if (Number.isNaN(parsedDate.getTime())) {
                        const normalized = String(value).trim();
                        const fallback = normalized.includes('T') ? normalized : normalized.replace(' ', 'T');
                        const fallbackDate = new Date(fallback);
                        if (Number.isNaN(fallbackDate.getTime())) return null;
                        const year = fallbackDate.getFullYear();
                        const month = String(fallbackDate.getMonth() + 1).padStart(2, '0');
                        const day = String(fallbackDate.getDate()).padStart(2, '0');
                        return `${year}-${month}-${day}`;
                    }
                    const year = parsedDate.getFullYear();
                    const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
                    const day = String(parsedDate.getDate()).padStart(2, '0');
                    return `${year}-${month}-${day}`;
                };

                // Purpose: Describes the change between today's and yesterday's dashboard totals.
                // Inputs: Current value, previous value, and currency flag. Outputs: Readable comparison text.
                const buildComparisonText = (todayValue, yesterdayValue, isCurrency = false) => {
                    if (todayValue === 0 && yesterdayValue === 0) {
                        return 'No change from yesterday';
                    }
                    if (yesterdayValue === 0) {
                        return todayValue === 0 ? 'No change from yesterday' : 'New activity today';
                    }
                    const diff = todayValue - yesterdayValue;
                    const absDiff = isCurrency ? `SGD ${Math.abs(diff).toFixed(2)}` : `${Math.abs(diff)}`;
                    return `${diff >= 0 ? '+' : '-'}${absDiff} from yesterday`;
                };

                // Compute today vs yesterday metrics using confirmed bookings
                const now = new Date();
                const todayKey = getDateKey(now);
                const yesterday = new Date(now);
                yesterday.setDate(now.getDate() - 1);
                const yesterdayKey = getDateKey(yesterday);

                const confirmedBookings = (allBookings || []).filter(b => b.status === 'confirmed');

                // Purpose: Groups confirmed bookings into daily booking, ticket, and revenue totals.
                // Inputs: Booking array. Outputs: Object keyed by local date.
                const aggregateByDay = (bookings) => bookings.reduce((acc, b) => {
                    const day = getDateKey(b.booked_at || b.booked_at_iso || '');
                    if (!day) return acc;
                    acc[day] = acc[day] || { bookings: 0, tickets: 0, revenue: 0 };
                    acc[day].bookings += 1;
                    acc[day].tickets += (Number(b.full_price_qty) || 0) + (Number(b.concession_qty) || 0);
                    acc[day].revenue += Number(b.amount_paid || 0);
                    return acc;
                }, {});

                const dayAgg = aggregateByDay(confirmedBookings);
                const todayData = dayAgg[todayKey] || { bookings: 0, tickets: 0, revenue: 0 };
                const yesterdayData = dayAgg[yesterdayKey] || { bookings: 0, tickets: 0, revenue: 0 };

                const todayMetrics = {
                    bookingsToday: todayData.bookings,
                    bookingsYesterday: yesterdayData.bookings,
                    bookingsDelta: todayData.bookings - yesterdayData.bookings,
                    bookingsComparisonText: buildComparisonText(todayData.bookings, yesterdayData.bookings),
                    revenueToday: todayData.revenue,
                    revenueYesterday: yesterdayData.revenue,
                    revenueDelta: todayData.revenue - yesterdayData.revenue,
                    revenueComparisonText: buildComparisonText(todayData.revenue, yesterdayData.revenue, true),
                    ticketsToday: todayData.tickets,
                    ticketsYesterday: yesterdayData.tickets,
                    ticketsDelta: todayData.tickets - yesterdayData.tickets,
                    ticketsComparisonText: buildComparisonText(todayData.tickets, yesterdayData.tickets)
                };

                const totalRevenue = confirmedBookings.reduce((sum, booking) => sum + (Number(booking.amount_paid || 0) || 0), 0);
                const totalBookingsCount = confirmedBookings.length;
                const totalTicketsSoldCount = confirmedBookings.reduce((sum, booking) => sum + ((Number(booking.full_price_qty) || 0) + (Number(booking.concession_qty) || 0)), 0);

                summary.totalRevenue = Number(totalRevenue || 0);
                summary.totalBookings = Number(totalBookingsCount || 0);
                summary.totalTicketsSold = Number(totalTicketsSoldCount || 0);

                // Build revenue by event and event performance table from published events + bookings
                const bookingsByEvent = (confirmedBookings || []).reduce((acc, b) => {
                    const id = b.event_id || `event-${b.event_title}`;
                    acc[id] = acc[id] || { revenue: 0, tickets: 0, bookings: 0, fullTickets: 0, concessionTickets: 0 };
                    acc[id].revenue += Number(b.amount_paid || 0);
                    acc[id].tickets += (Number(b.full_price_qty) || 0) + (Number(b.concession_qty) || 0);
                    acc[id].bookings += 1;
                    acc[id].fullTickets += Number(b.full_price_qty) || 0;
                    acc[id].concessionTickets += Number(b.concession_qty) || 0;
                    return acc;
                }, {});

                const eventsPerformance = (publishedEvents || []).map(ev => {
                    const id = ev.id || `event-${ev.title}`;
                    const data = bookingsByEvent[id] || { revenue: 0, tickets: 0, bookings: 0, fullTickets: 0, concessionTickets: 0 };
                    const remainingFullTickets = Number(ev.full_price_tickets) || 0;
                    const remainingConcessionTickets = Number(ev.concession_tickets) || 0;
                    const bookedTickets = Number(data.tickets) || 0;
                    const availability = remainingFullTickets + remainingConcessionTickets;
                    const totalCapacity = availability + bookedTickets;
                    const fullPrice = Number(ev.full_price_cost) || 0;
                    const concessionPrice = Number(ev.concession_cost) || 0;
                    const potentialRevenue = Math.round((remainingFullTickets * fullPrice + remainingConcessionTickets * concessionPrice) * 100) / 100;

                    return {
                        id,
                        title: ev.title || 'Untitled event',
                        date: ev.event_date || null,
                        time: ev.event_time || null,
                        revenue: data.revenue || 0,
                        ticketsSold: bookedTickets,
                        bookings: data.bookings || 0,
                        totalCapacity,
                        availability,
                        fullPrice,
                        concessionPrice,
                        potentialRevenue,
                        wishlistCount: Number(ev.wishlist_count) || 0,
                        status: ev.status || 'unknown'
                    };
                }).sort((a,b) => b.revenue - a.revenue);

                // Prepare event table rows
                const eventTable = eventsPerformance.map(ev => ({
                    title: ev.title,
                    bookings: ev.bookings,
                    ticketsSold: ev.ticketsSold,
                    revenue: ev.revenue,
                    status: ev.status,
                    availability: ev.availability
                }));

                // Prepare upcoming events (published and in future)
                const upcomingEvents = (publishedEvents || []).filter(ev => {
                    if (!ev.event_date) return false;
                    const evDate = new Date(ev.event_date + 'T00:00:00');
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    return evDate >= today;
                }).map(ev => {
                    const id = ev.id || `event-${ev.title}`;
                    const data = bookingsByEvent[id] || { revenue: 0, tickets: 0, bookings: 0 };
                    const availability = (Number(ev.full_price_tickets) || 0) + (Number(ev.concession_tickets) || 0);
                    return {
                        id,
                        title: ev.title,
                        datetime: `${ev.event_date || ''}${ev.event_time ? ', ' + ev.event_time : ''}`,
                        ticketsSold: data.tickets || 0,
                        totalCapacity: availability + (data.tickets || 0),
                        revenue: data.revenue || 0,
                        availability,
                        status: ev.status || 'published'
                    };
                }).sort((a,b) => new Date(a.datetime) - new Date(b.datetime)).slice(0,6);

                // A best seller requires at least one confirmed ticket sale.
                const bestByTickets = eventsPerformance.slice().sort((a,b) => b.ticketsSold - a.ticketsSold)[0];
                if (bestByTickets && bestByTickets.ticketsSold > 0) {
                    summary.bestSeller = bestByTickets.title;
                } else {
                    summary.bestSeller = null;
                }

                // Events already store remaining ticket inventory, so derive availability from those remaining values directly.
                const earnedSoFar = Number(summary.totalRevenue || 0);
                const remainingPossible = eventsPerformance.reduce((s, e) => s + (Number(e.potentialRevenue) || 0), 0);
                const totalPotential = Math.round((earnedSoFar + remainingPossible) * 100) / 100;
                const earnedPct = totalPotential > 0 ? Math.round((earnedSoFar / totalPotential) * 100) : 0;

                const totalFilled = eventsPerformance.reduce((s,e) => s + (Number(e.ticketsSold)||0), 0);
                const totalCapacitySeats = eventsPerformance.reduce((s,e) => s + (Number(e.totalCapacity)||0), 0) || 0;
                const occupancyPct = totalCapacitySeats > 0 ? Math.round((totalFilled / totalCapacitySeats) * 100) : 0;

                const insights = [];
                if (bestByTickets && bestByTickets.ticketsSold > 0) {
                    insights.push({
                        badge: '🏆',
                        title: 'Best Seller',
                        text: `${bestByTickets.title} leads with ${bestByTickets.ticketsSold} tickets sold.`
                    });
                } else {
                    insights.push({
                        badge: '—',
                        title: 'Sales Status',
                        text: 'No confirmed ticket sales yet, so no best seller has been named.'
                    });
                }

                const mostWishlisted = eventsPerformance.slice().sort((a, b) => b.wishlistCount - a.wishlistCount)[0];
                if (mostWishlisted && mostWishlisted.wishlistCount > 0) {
                    insights.push({
                        badge: '♡',
                        title: 'Wishlist Interest',
                        text: `${mostWishlisted.title} leads with ${mostWishlisted.wishlistCount} attendee ${mostWishlisted.wishlistCount === 1 ? 'save' : 'saves'}.`
                    });
                } else {
                    insights.push({
                        badge: '♡',
                        title: 'Wishlist Interest',
                        text: 'No attendees have saved an event to their wishlist yet.'
                    });
                }

                insights.push({
                    badge: '📈',
                    title: 'Today’s Activity',
                    text: `SGD ${(todayMetrics.revenueToday || 0).toFixed(2)} from ${todayMetrics.bookingsToday || 0} bookings today.`
                });

                if (insights.length < 3) {
                    insights.push({
                        badge: '✨',
                        title: 'Momentum',
                        text: occupancyPct < 50
                            ? 'Overall occupancy is still building, so promotion may help.'
                            : 'Overall occupancy looks healthy and steady.'
                    });
                }

                // Render with augmented data
                res.render('organiser_revenue', {
                    title: 'Revenue Dashboard',
                    summary: summary,
                    todayMetrics: todayMetrics,
                    eventsPerformance: eventsPerformance,
                    eventTable: eventTable,
                    upcomingEvents: upcomingEvents,
                    currentUser: req.session.user,
                    revenuePotential: {
                        earnedSoFar: earnedSoFar,
                        remainingPossible: remainingPossible,
                        totalPotential: totalPotential,
                        earnedPct: earnedPct
                    },
                    insights: insights,
                    occupancyPct: occupancyPct,
                    totalFilled: totalFilled,
                    totalCapacitySeats: totalCapacitySeats
                });
            });
        });
    });
});

// Purpose: Renders the unified booking-management dashboard with filters and calendar data.
// Inputs: Search, status, range, date, month, and year filters from req.query.
// Outputs: Displays matching bookings, occupancy figures, and event calendar details.
router.get('/booking-management', (req, res) => {
    try {
        const search = (req.query.search || '').trim();
        const status = (req.query.status || '').trim().toLowerCase();
        const range = (req.query.range || '').trim().toLowerCase();
        const selectedDate = (req.query.date || '').trim();
        const calendarMonth = Number.isInteger(parseInt(req.query.calendarMonth, 10)) ? parseInt(req.query.calendarMonth, 10) : null;
        const calendarYear = Number.isInteger(parseInt(req.query.calendarYear, 10)) ? parseInt(req.query.calendarYear, 10) : null;

        db.getBookingTotals((err, totals) => {
            if (err) {
                console.error('Error loading booking totals:', err.message);
                return res.status(500).render('error', {
                    title: 'Error',
                    message: 'Unable to load booking statistics.',
                    statusCode: 500
                });
            }

            db.getPublishedEvents((eventsErr, publishedEvents) => {
                if (eventsErr) {
                    console.error('Error loading published events:', eventsErr.message);
                    return res.status(500).render('error', {
                        title: 'Error',
                        message: 'Unable to load events for booking calendar.',
                        statusCode: 500
                    });
                }

                db.getAllBookings((allErr, allBookings) => {
                    if (allErr) {
                        console.error('Error loading bookings:', allErr.message);
                        return res.status(500).render('error', {
                            title: 'Error',
                            message: 'Unable to load bookings.',
                            statusCode: 500
                        });
                    }

                    let filtered = allBookings || [];

                    if (search) {
                        const searchLower = search.toLowerCase();
                        filtered = filtered.filter(b => 
                            b.attendee_name.toLowerCase().includes(searchLower) ||
                            b.event_title.toLowerCase().includes(searchLower)
                        );
                    }

                    if (status) {
                        filtered = filtered.filter(b => b.status === status);
                    }

                    if (range) {
                        const now = new Date();
                        let start = new Date(now);

                        if (range === 'today') {
                            start.setHours(0, 0, 0, 0);
                        } else if (range === 'this_week') {
                            const day = now.getDay();
                            const diff = day === 0 ? -6 : 1 - day;
                            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
                            start.setHours(0, 0, 0, 0);
                        } else if (range === 'this_month') {
                            start = new Date(now.getFullYear(), now.getMonth(), 1);
                        } else {
                            start = null;
                        }

                        if (start) {
                            filtered = filtered.filter(b => {
                                const bookingDate = new Date(b.booked_at_iso || b.booked_at.replace(' ', 'T'));
                                return bookingDate >= start && bookingDate <= now;
                            });
                        }
                    }

                    const hasValidSelectedDate = /^\d{4}-\d{2}-\d{2}$/.test(selectedDate);
                    let selectedDateValue = '';
                    let selectedDateFormatted = '';
                    if (hasValidSelectedDate) {
                        selectedDateValue = selectedDate;
                    }

                    const now = new Date();
                    let displayYear = Number.isInteger(calendarYear) ? calendarYear : now.getFullYear();
                    let displayMonth = Number.isInteger(calendarMonth) ? calendarMonth : now.getMonth();

                    if (selectedDateValue) {
                        const parts = selectedDateValue.split('-').map((part) => Number(part));
                        if (parts.length === 3) {
                            const [year, month, day] = parts;
                            if (year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
                                displayYear = year;
                                displayMonth = month - 1;
                                const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                                selectedDateFormatted = `${String(day).padStart(2, '0')} ${monthNames[month - 1]} ${year}`;
                            }
                        }
                    }

                    const publishedEventsByDate = (publishedEvents || []).reduce((acc, event) => {
                        if (!event.event_date) return acc;
                        acc[event.event_date] = acc[event.event_date] || [];
                        acc[event.event_date].push(event);
                        return acc;
                    }, {});

                    const confirmedBookingsByEventId = (allBookings || []).reduce((acc, booking) => {
                        if (booking.status !== 'confirmed') return acc;
                        const eventId = booking.event_id || 0;
                        acc[eventId] = acc[eventId] || 0;
                        acc[eventId] += (Number(booking.full_price_qty) || 0) + (Number(booking.concession_qty) || 0);
                        return acc;
                    }, {});

                    const monthStart = new Date(displayYear, displayMonth, 1);
                    const firstDay = monthStart.getDay();
                    const daysInMonth = new Date(displayYear, displayMonth + 1, 0).getDate();
                    const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
                    const bookingsByDate = filtered.reduce((acc, booking) => {
                        const dateKey = booking.event_date || '';
                        if (!dateKey) return acc;
                        acc[dateKey] = acc[dateKey] || [];
                        acc[dateKey].push(booking);
                        return acc;
                    }, {});

                    const selectedDateEvents = selectedDateValue ? (publishedEventsByDate[selectedDateValue] || []).map((event) => {
                        const bookedTickets = (allBookings || []).filter((booking) => booking.event_id === event.id && booking.status === 'confirmed').reduce((sum, booking) => {
                            return sum + (Number(booking.full_price_qty) || 0) + (Number(booking.concession_qty) || 0);
                        }, 0);
                        const seatsLeft = (Number(event.full_price_tickets) || 0) + (Number(event.concession_tickets) || 0);
                        return {
                            eventId: event.id,
                            eventTitle: event.title || 'Untitled Event',
                            eventTime: event.event_time || 'TBC',
                            eventDate: event.event_date,
                            bookedTickets,
                            seatsLeft,
                            totalCapacity: bookedTickets + seatsLeft,
                            eventUrl: `/organiser/events/${event.id}/edit`
                        };
                    }) : [];

                    const selectedDateBookings = selectedDateValue ? (bookingsByDate[selectedDateValue] || []) : [];

                    const calendarDays = [];
                    for (let index = 0; index < totalCells; index += 1) {
                        const dayDate = new Date(displayYear, displayMonth, index - firstDay + 1);
                        const dateKey = `${dayDate.getFullYear().toString().padStart(4, '0')}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
                        const dayEvents = publishedEventsByDate[dateKey] || [];
                        const dayBookings = bookingsByDate[dateKey] || [];
                        const dayFullyBooked = dayEvents.some((event) => {
                            const remainingSeats = (Number(event.full_price_tickets) || 0) + (Number(event.concession_tickets) || 0);
                            const bookedSeats = confirmedBookingsByEventId[event.id] || 0;
                            return remainingSeats === 0 && bookedSeats > 0;
                        });
                        const dotType = dayFullyBooked ? 'full' : (dayBookings.length ? 'booking' : (dayEvents.length ? 'event' : ''));

                        calendarDays.push({
                            date: dayDate,
                            day: dayDate.getDate(),
                            dateKey,
                            isCurrentMonth: dayDate.getMonth() === displayMonth,
                            hasBookings: Boolean(dayBookings.length),
                            hasEvent: Boolean(dayEvents.length),
                            dotType,
                            bookings: dayBookings,
                            events: dayEvents
                        });
                    }

                    const monthEventCount = new Set((filtered || []).map((booking) => booking.event_id || booking.event_title)).size;

                    const prevMonth = displayMonth === 0 ? 11 : displayMonth - 1;
                    const prevYear = displayMonth === 0 ? displayYear - 1 : displayYear;
                    const nextMonth = displayMonth === 11 ? 0 : displayMonth + 1;
                    const nextYear = displayMonth === 11 ? displayYear + 1 : displayYear;

                    // Build occupancy groups based on published events to use the canonical
                    // event capacity values from the `events` table rather than relying on
                    // per-booking snapshots which can be inconsistent if capacities changed.
                    const confirmedBookingsForOccupancy = (allBookings || []).filter((booking) => booking.status === 'confirmed');
                    const confirmedOccupancyGroups = (publishedEvents || []).map((event) => {
                        const filled = confirmedBookingsByEventId[event.id] || 0;
                        // event.full_price_tickets and event.concession_tickets are remaining tickets
                        const remaining = (Number(event.full_price_tickets) || 0) + (Number(event.concession_tickets) || 0);
                        const totalCapacity = remaining + filled; // original capacity = remaining + filled
                        const percent = totalCapacity > 0 ? Math.round((filled / totalCapacity) * 100) : 0;
                        const fillPercent = totalCapacity > 0 ? Math.min(100, Math.round((filled / totalCapacity) * 100)) : 0;
                        return {
                            eventId: event.id || `event-${event.title}`,
                            title: event.title || 'Untitled event',
                            filled,
                            totalCapacity,
                            percent,
                            fillPercent
                        };
                    }).sort((a, b) => b.percent - a.percent);

                    const totalFilledSeats = confirmedOccupancyGroups.reduce((sum, item) => sum + item.filled, 0);
                    const totalCapacitySeats = confirmedOccupancyGroups.reduce((sum, item) => sum + item.totalCapacity, 0);
                    const occupancyPercent = totalCapacitySeats > 0 ? (totalFilledSeats / totalCapacitySeats) * 100 : 0;
                    const occupancyFillPercent = Math.min(100, Math.round(occupancyPercent));
                    const occupancyGroups = confirmedOccupancyGroups.slice(0, 4);

                    const selectedDateString = selectedDateValue;
                    const calendarDetails = calendarDays
                        .filter(day => day.isCurrentMonth && day.hasBookings)
                        .slice(0, 4)
                        .map(day => ({
                            date: day.dateKey,
                            bookingSummary: day.bookings.slice(0, 1).map(b => `${b.event_title} · ${b.attendee_name}`)[0] || 'Booked'
                        }));

                    res.render('organiser_booking_management', {
                        title: 'Booking Management',
                        totals: totals || { total_bookings: 0, total_tickets: 0, total_revenue: 0, confirmed_bookings: 0, cancelled_bookings: 0 },
                        bookings: filtered,
                        currentUser: req.session.user,
                        search: search,
                        status: status,
                        range: range,
                        selectedDate: selectedDateString,
                        selectedDateFormatted: selectedDateFormatted,
                        calendarMonth: displayMonth,
                        calendarYear: displayYear,
                        prevMonth: prevMonth,
                        prevYear: prevYear,
                        nextMonth: nextMonth,
                        nextYear: nextYear,
                        calendarDays: calendarDays,
                        monthEventCount: monthEventCount,
                        selectedDateEvents: selectedDateEvents,
                        selectedDateBookings: selectedDateBookings,
                        bookingsTable: filtered,
                        occupancyItems: occupancyGroups,
                        totalFilledSeats: totalFilledSeats,
                        totalCapacitySeats: totalCapacitySeats,
                        occupancyPercent: occupancyPercent,
                        occupancyFillPercent: occupancyFillPercent,
                        calendarDetails: calendarDetails,
                        checkinSuccess: req.query.checkin_success || null,
                        checkinError: req.query.checkin_error || null
                    });
                });
            });
        });
    } catch (err) {
        console.error('Exception in booking-management route:', err.message);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An unexpected error occurred.',
            statusCode: 500
        });
    }
});

// Purpose: Renders the legacy booking summary dashboard.
// Inputs: Optional search and status filters from req.query.
// Outputs: Displays booking totals and matching booking records.
router.get('/booking-dashboard', (req, res) => {
    const search = (req.query.search || '').trim();
    const status = (req.query.status || '').trim().toLowerCase();

    db.getBookingTotals((totalsErr, totals) => {
        if (totalsErr) {
            console.error('Error loading booking totals:', totalsErr.message);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Unable to load booking statistics.',
                statusCode: 500
            });
        }

        db.getBookingDashboard(search, status, (bookingsErr, bookings) => {
            if (bookingsErr) {
                console.error('Error loading booking dashboard:', bookingsErr.message);
                return res.status(500).render('error', {
                    title: 'Error',
                    message: 'Unable to load bookings.',
                    statusCode: 500
                });
            }

            res.render('organiser_booking_dashboard', {
                title: 'Booking Dashboard',
                totals: totals || { total_bookings: 0, total_tickets: 0, total_revenue: 0, confirmed_bookings: 0, cancelled_bookings: 0 },
                bookings: bookings || [],
                currentSearch: search,
                currentStatus: status,
                currentUser: req.session.user
            });
        });
    });
});

// Purpose: Cancels a confirmed booking from the organiser area.
// Inputs: Booking ID from req.params.id and authenticated organiser session.
// Outputs: Restores ticket inventory and redirects with a result message.
router.post('/bookings/:id/cancel', (req, res) => {
    try {
        const bookingId = parseInt(req.params.id, 10);

        if (isNaN(bookingId)) {
            return res.status(400).render('error', {
                title: 'Error',
                message: 'Invalid booking ID.',
                statusCode: 400
            });
        }

        db.cancelBooking(bookingId, (err) => {
            if (err) {
                console.error('Error cancelling booking:', err.message);
                return res.status(500).render('error', {
                    title: 'Error',
                    message: 'Unable to cancel booking.',
                    statusCode: 500
                });
            }

            req.session.message = { type: 'success', text: 'Booking cancelled successfully.' };
            res.redirect('/organiser/booking-management');
        });
    } catch (err) {
        console.error('Exception in cancel booking route:', err.message);
        res.status(500).render('error', {
            title: 'Error',
            message: 'An unexpected error occurred.',
            statusCode: 500
        });
    }
});

// Purpose: Displays the organiser QR/reference check-in page.
// Inputs: Optional booking reference from req.query.
// Outputs: Renders a matching booking and its current check-in state.
router.get('/check-in', (req, res) => {
    const reference = String(req.query.reference || '').trim();
    if (!reference) {
        return res.render('organiser_check_in', {
            title: 'Attendee Check-in', reference: '', booking: null,
            error: req.query.error || null, success: req.query.success || null
        });
    }
    db.getBookingByReference(reference, (err, booking) => {
        res.status(err ? 500 : 200).render('organiser_check_in', {
            title: 'Attendee Check-in', reference, booking: booking || null,
            error: err ? 'Unable to look up that booking.' : (!booking ? 'Booking reference not found.' : req.query.error || null),
            success: req.query.success || null
        });
    });
});

// Purpose: Checks in a booking entered or scanned by booking reference.
// Inputs: Booking reference from req.body.
// Outputs: Records one check-in or returns a duplicate/cancelled validation message.
router.post('/check-in', (req, res) => {
    const reference = String(req.body.reference || '').trim().toUpperCase();
    if (!reference) return res.redirect('/organiser/check-in?error=' + encodeURIComponent('Enter a booking reference.'));
    db.getBookingByReference(reference, (lookupErr, booking) => {
        if (lookupErr || !booking) {
            return res.redirect('/organiser/check-in?reference=' + encodeURIComponent(reference) + '&error=' + encodeURIComponent('Booking reference not found.'));
        }
        db.checkInBooking(booking.id, (checkErr) => {
            const key = checkErr ? 'error' : 'success';
            const message = checkErr ? checkErr.message : 'Attendee checked in successfully.';
            res.redirect('/organiser/check-in?reference=' + encodeURIComponent(reference) + '&' + key + '=' + encodeURIComponent(message));
        });
    });
});

// Purpose: Checks in a confirmed booking directly from the booking-management table.
// Inputs: Booking ID from req.params.id.
// Outputs: Records one check-in and redirects with a visible result message.
router.post('/bookings/:id/check-in', (req, res) => {
    const bookingId = Number(req.params.id);
    if (!Number.isInteger(bookingId) || bookingId <= 0) {
        return res.status(400).render('error', { title: 'Invalid booking', message: 'Invalid booking ID.', statusCode: 400 });
    }
    db.checkInBooking(bookingId, (err) => {
        if (err) {
            return res.redirect('/organiser/booking-management?checkin_error=' + encodeURIComponent(err.message) + '#bookings-table');
        }
        res.redirect('/organiser/booking-management?checkin_success=1#bookings-table');
    });
});

// Purpose: Displays all bookings to the authenticated organiser.
// Inputs: Authenticated organiser session.
// Outputs: Renders the complete booking table.
router.get('/bookings', (req, res) => {
    db.getAllBookings((err, bookings) => {
        if (err) {
            console.error('Error loading bookings:', err.message);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Unable to load bookings.',
                statusCode: 500
            });
        }

        res.render('organiser_bookings', {
            title: 'All Bookings',
            bookings: bookings || [],
            currentUser: req.session.user
        });
    });
});

// Purpose: Exports booking records as a CSV file.
// Inputs: Authenticated organiser session.
// Outputs: Sends a UTF-8 CSV download containing booking and event information.
router.get('/bookings/export', (req, res) => {
    db.getAllBookings((err, bookings) => {
        if (err) {
            console.error('Error preparing CSV export:', err.message);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Unable to export bookings.',
                statusCode: 500
            });
        }

        const columns = [
            'Booking ID',
            'Attendee Name',
            'Status',
            'Event Title',
            'Event Date',
            'Event Time',
            'Full Price Quantity',
            'Concession Quantity',
            'Ticket Type',
            'Amount Paid',
            'Booked At'
        ];

        // Purpose: Escapes spreadsheet-sensitive characters and quotes for safe CSV export.
        // Inputs: Cell value. Outputs: CSV-safe quoted string.
        const escapeCsv = (value) => {
            if (value === null || value === undefined) return '';
            const raw = String(value);
            if (raw.includes(',') || raw.includes('"') || raw.includes('\n')) {
                return `"${raw.replace(/"/g, '""')}"`;
            }
            return raw;
        };

        const csvRows = [columns.join(',')];
        bookings.forEach((booking) => {
            const amountPaid = Number(booking.amount_paid || 0).toFixed(2);
            csvRows.push([
                `BK${String(booking.id).padStart(4, '0')}`,
                booking.attendee_name,
                booking.status,
                booking.event_title,
                booking.event_date || '',
                booking.event_time || '',
                booking.full_price_qty,
                booking.concession_qty,
                booking.ticket_type,
                amountPaid,
                booking.booked_at || ''
            ].map(escapeCsv).join(','));
        });

        const csvContent = csvRows.join('\n');
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="eventflow-bookings.csv"');
        res.status(200).send(csvContent);
    });
});

// Purpose: Shows the organiser edit event page for a specific event.
// Inputs: Event ID from req.params.id.
// Outputs: Renders the event editor with the current event details and current booking counts.
router.get('/events/:id/edit', (req, res) => {
    const eventId = req.params.id;
    db.getEventById(eventId, (err, event) => {
        if (err || !event) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Event not found.',
                statusCode: 404
            });
        }
        db.getBookingCount(eventId, (err2, counts) => {
            if (err2) counts = { full_price_booked: 0, concession_booked: 0 };
            res.render('edit_event', {
                title: 'Edit Event',
                event: event,
                bookings: counts
            });
        });
    });
});

// Purpose: Saves updates made on the organiser edit event page.
// Inputs: Event ID from req.params.id and edited form values from req.body.
// Outputs: Updates the event in SQLite and redirects back to the edit page.
router.post('/events/:id/update', (req, res) => {
    const eventId = req.params.id;
    const removeImage = req.body.remove_image === '1';
    const data = {
        title: req.body.title || 'New Event',
        description: req.body.description || '',
        image_data: removeImage ? null : (req.body.image_data || null),
        image_update_requested: removeImage || Boolean(req.body.image_data),
        event_date: req.body.event_date || null,
        event_time: req.body.event_time || null,
        scheduled_publish_at: normalizeScheduledPublish(req.body.scheduled_publish_at),
        booking_deadline: normalizeScheduledPublish(req.body.booking_deadline),
        location: req.body.location || '',
        duration_minutes: parseNumericInput(req.body.duration_minutes),
        full_price_tickets: parseNumericInput(req.body.full_price_tickets),
        full_price_cost: parseNumericInput(req.body.full_price_cost),
        concession_tickets: parseNumericInput(req.body.concession_tickets),
        concession_cost: parseNumericInput(req.body.concession_cost)
    };

    const validationErrors = validateEventPayload(data, { allowDraft: true });
    if (validationErrors.length > 0) {
        return db.getEventById(eventId, (eventErr, event) => {
            if (eventErr || !event) {
                return res.status(404).render('error', { title: 'Not found', message: 'Event not found.', statusCode: 404 });
            }
            db.getBookingCount(eventId, (countErr, counts) => {
                if (countErr) counts = { full_price_booked: 0, concession_booked: 0 };
                const displayEvent = {
                    ...event,
                    ...data,
                    image_data: data.image_update_requested ? data.image_data : event.image_data
                };
                return res.status(400).render('edit_event', {
                    title: 'Edit Event',
                    event: displayEvent,
                    bookings: counts,
                    validationErrors
                });
            });
        });
    }

    db.updateEvent(eventId, data, (err) => {
        if (err) {
            console.error('Error updating event:', err.message);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Could not update event.',
                statusCode: 500
            });
        }
        if (req.body.action === 'publish') {
            return db.publishEvent(eventId, (publishErr) => {
                if (!publishErr) return res.redirect('/organiser');
                db.getEventById(eventId, (eventErr, event) => {
                    if (eventErr || !event) {
                        return res.status(404).render('error', { title: 'Not found', message: 'Event not found.', statusCode: 404 });
                    }
                    db.getBookingCount(eventId, (countErr, counts) => {
                        if (countErr) counts = { full_price_booked: 0, concession_booked: 0 };
                        return res.status(400).render('edit_event', {
                            title: 'Edit Event',
                            event,
                            bookings: counts,
                            validationErrors: [publishErr.message]
                        });
                    });
                });
            });
        }
        return res.redirect(`/organiser/events/${eventId}/edit`);
    });
});

// Purpose: Publishes a draft event so attendees can book it.
// Inputs: Event ID from req.params.id.
// Outputs: Updates the event status and published timestamp in SQLite, then redirects to the organiser home page.
router.post('/events/:id/publish', (req, res) => {
    const eventId = req.params.id;
    db.publishEvent(eventId, (err) => {
        if (err) {
            console.error('Error publishing event:', err.message);
            return db.getEventById(eventId, (eventErr, event) => {
                if (eventErr || !event) {
                    return res.status(404).render('error', { title: 'Not Found', message: 'Event not found.', statusCode: 404 });
                }
                db.getBookingCount(eventId, (countErr, counts) => {
                    if (countErr) counts = { full_price_booked: 0, concession_booked: 0 };
                    return res.status(400).render('edit_event', {
                        title: 'Edit Event',
                        event,
                        bookings: counts,
                        validationErrors: [err.message]
                    });
                });
            });
        }
        res.redirect('/organiser');
    });
});

// Purpose: Deletes an event and its related bookings.
// Inputs: Event ID from req.params.id.
// Outputs: Removes the event record from SQLite and redirects to the organiser home page.
router.post('/events/:id/delete', (req, res) => {
    const eventId = req.params.id;
    db.deleteEvent(eventId, (err) => {
        if (err) {
            console.error('Error deleting event:', err.message);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Could not delete event.',
                statusCode: 500
            });
        }
        res.redirect('/organiser');
    });
});

module.exports = router;
