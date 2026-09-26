const express = require('express');
const bcrypt = require('bcryptjs');
const QRCode = require('qrcode');
const router = express.Router();
const db = require('./db');
const { ensureAttendeeAuthenticated } = require('../middleware/auth');
const { formatDateDisplay } = require('../utils/formatDate');

// Purpose: Creates a consistent public reference for a booking.
// Inputs: Numeric booking ID. Outputs: Zero-padded booking reference string.
function buildBookingReference(bookingId) {
    return `BK-${String(bookingId).padStart(6, '0')}`;
}

// Purpose: Identifies the simulated payment-card brand for the confirmation record.
// Inputs: Card-number string. Outputs: Display-safe card-brand name.
function detectCardBrand(cardNumber) {
    if (!cardNumber) return 'Card';
    if (cardNumber.startsWith('4')) return 'Visa';
    if (/^5[1-5]/.test(cardNumber)) return 'Mastercard';
    if (/^3[47]/.test(cardNumber)) return 'American Express';
    return 'Card';
}

// Purpose: Creates the organiser verification URL encoded into the attendee QR code.
// Inputs: Current request host and booking reference. Outputs: Absolute check-in URL.
function buildCheckInUrl(req, booking) {
    const reference = booking.booking_reference || buildBookingReference(booking.id);
    return `${req.protocol}://${req.get('host')}/organiser/check-in?reference=${encodeURIComponent(reference)}`;
}

// Purpose: Renders the attendee login page.
// Inputs: Existing attendee session from req.session.
// Outputs: Shows the login view or redirects signed-in attendees to the dashboard.
router.get('/login', (req, res) => {
    if (req.session && req.session.attendee) {
        return res.redirect('/attendee/dashboard');
    }
    res.render('attendee_login', { title: 'Attendee Login', error: null, success: null });
});

// Purpose: Authenticates an attendee account and starts an attendee session.
// Inputs: Email and password from req.body.
// Outputs: Creates a session and redirects the attendee to the dashboard or shows an error.
router.post('/login', (req, res) => {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
        return res.render('attendee_login', {
            title: 'Attendee Login',
            error: 'Please enter both email and password.',
            success: null
        });
    }

    db.getAttendeeByEmail(email, (err, attendee) => {
        if (err || !attendee) {
            return res.render('attendee_login', {
                title: 'Attendee Login',
                error: 'Invalid email or password.',
                success: null
            });
        }

        bcrypt.compare(password, attendee.password_hash, (compareErr, isMatch) => {
            if (compareErr || !isMatch) {
                return res.render('attendee_login', {
                    title: 'Attendee Login',
                    error: 'Invalid email or password.',
                    success: null
                });
            }

            if (!attendee.confirmed) {
                return res.status(403).render('attendee_login', {
                    title: 'Attendee Login',
                    error: 'Please confirm your account using the simulated confirmation link before signing in.',
                    success: null
                });
            }

            req.session.regenerate((sessionErr) => {
                if (sessionErr) {
                    return res.status(500).render('error', {
                        title: 'Error',
                        message: 'Unable to create your attendee session.',
                        statusCode: 500
                    });
                }

                req.session.attendee = {
                    id: attendee.id,
                    name: attendee.name,
                    email: attendee.email
                };
                req.session.guestMode = false;

                db.updateAttendeeLastLogin(attendee.id, (updateErr) => {
                    if (updateErr) {
                        console.error('Error saving attendee last login:', updateErr.message);
                    }
                    res.redirect('/attendee/dashboard');
                });
            });
        });
    });
});

// Purpose: Renders the attendee registration form.
// Inputs: None.
// Outputs: Displays the registration page for new attendees.
router.get('/register', (req, res) => {
    res.render('attendee_register', { title: 'Create Attendee Account', error: null });
});

// Purpose: Creates a new attendee account with password hashing and simulated confirmation.
// Inputs: Name, email, and password from req.body.
// Outputs: Stores the attendee in SQLite and shows confirmation guidance.
router.post('/register', (req, res) => {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!name || !email || !password) {
        return res.render('attendee_register', {
            title: 'Create Attendee Account',
            error: 'Please fill in all fields.'
        });
    }

    // basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.render('attendee_register', { title: 'Create Attendee Account', error: 'Please enter a valid email address.' });
    }
    if (password.length < 6) {
        return res.render('attendee_register', { title: 'Create Attendee Account', error: 'Password must be at least 6 characters.' });
    }

    bcrypt.hash(password, 10, (hashErr, passwordHash) => {
        if (hashErr) {
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Unable to create your account right now.',
                statusCode: 500
            });
        }

        // generate a simple confirmation token (simulated email confirmation)
        const token = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
        db.createAttendee({ name, email, password_hash: passwordHash, confirmed: 0, confirmation_token: token }, (createErr, attendeeId) => {
            if (createErr) {
                return res.render('attendee_register', {
                    title: 'Create Attendee Account',
                    error: 'An account with that email already exists.'
                });
            }

            res.status(201).render('attendee_login', {
                title: 'Attendee Login',
                error: null,
                success: `Account created. This coursework uses a simulated confirmation link: /attendee/confirm/${token}`
            });
        });
    });
});

// Purpose: Confirms a newly registered attendee using the simulated confirmation token.
// Inputs: Confirmation token from req.params.token.
// Outputs: Marks the account confirmed and renders a success or error message.
router.get('/confirm/:token', (req, res) => {
    const token = req.params.token;
    db.getAttendeeByConfirmationToken(token, (err, attendee) => {
        if (err || !attendee) {
            return res.render('attendee_login', { title: 'Attendee Login', error: 'Invalid confirmation token', success: null });
        }
        db.confirmAttendeeById(attendee.id, (confErr) => {
            if (confErr) {
                return res.render('attendee_login', { title: 'Attendee Login', error: 'Unable to confirm account', success: null });
            }
            res.render('attendee_login', { title: 'Attendee Login', error: null, success: 'Email confirmed — you can now sign in.' });
        });
    });
});

// Purpose: Starts a guest browsing session without creating an attendee account.
// Inputs: Existing session state from req.session.
// Outputs: Enables guest mode and redirects to the attendee home page.
router.post('/guest', (req, res) => {
    req.session.regenerate((sessionErr) => {
        if (sessionErr) {
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Unable to activate guest mode right now.',
                statusCode: 500
            });
        }

        req.session.attendee = null;
        req.session.guestMode = true;
        res.redirect('/attendee');
    });
});

// Purpose: Ends the current attendee session.
// Inputs: Authenticated or guest session from req.session.
// Outputs: Destroys the session and redirects to attendee login.
router.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Attendee logout error:', err.message);
        }
        res.clearCookie('connect.sid');
        res.redirect('/attendee/login');
    });
});

// Purpose: Shows the attendee dashboard with personal bookings and a calendar view.
// Inputs: Authenticated attendee session from req.session.
// Outputs: Renders the attendee dashboard with booking history and calendar details.
router.get('/dashboard', ensureAttendeeAuthenticated, (req, res) => {
    db.getBookingsForAttendee(req.session.attendee.id, (err, bookings) => {
        if (err) {
            console.error('Error fetching attendee bookings:', err.message);
            bookings = [];
        }
        db.getPublishedEventPopularityCounts((popErr, popularityRows) => {
            if (popErr) {
                console.error('Error fetching popularity for calendar:', popErr.message);
                popularityRows = [];
            }

            const bookedDates = (bookings || [])
                .filter((booking) => booking.event_date)
                .map((booking) => booking.event_date)
                .sort();

            const calendarEventsByDate = (bookings || []).reduce((accumulator, booking) => {
                if (!booking.event_date) return accumulator;
                const dateKey = booking.event_date;
                accumulator[dateKey] = accumulator[dateKey] || [];
                accumulator[dateKey].push({
                    id: booking.event_id,
                    title: booking.event_title,
                    time: booking.event_time || 'TBC',
                    reference: booking.booking_reference || buildBookingReference(booking.id),
                    status: booking.status
                });
                return accumulator;
            }, {});

            const monthSeed = bookedDates.length > 0 ? bookedDates[0] : new Date().toISOString().slice(0, 10);
            const monthDate = new Date(`${monthSeed}T00:00:00`);
            const calendarMonth = monthDate.getMonth();
            const calendarYear = monthDate.getFullYear();
            const monthStart = new Date(calendarYear, calendarMonth, 1);
            const firstDay = monthStart.getDay();
            const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
            const totalCells = Math.ceil((firstDay + daysInMonth) / 7) * 7;
            const bookedDateSet = new Set(bookedDates);

            const calendarDays = [];
            for (let index = 0; index < totalCells; index += 1) {
                const dayDate = new Date(calendarYear, calendarMonth, index - firstDay + 1);
                const dateKey = `${dayDate.getFullYear().toString().padStart(4, '0')}-${String(dayDate.getMonth() + 1).padStart(2, '0')}-${String(dayDate.getDate()).padStart(2, '0')}`;
                const eventsForDay = calendarEventsByDate[dateKey] || [];
                calendarDays.push({
                    day: dayDate.getDate(),
                    dateKey,
                    isCurrentMonth: dayDate.getMonth() === calendarMonth,
                    hasBooking: bookedDateSet.has(dateKey),
                    dotType: bookedDateSet.has(dateKey) ? 'booking' : '',
                    events: eventsForDay
                });
            }

            const nextBookingLabel = bookedDates.length > 0 ? formatDateDisplay(bookedDates[0]) : 'No events booked yet';

            db.getWaitlistForAttendee(req.session.attendee.id, (waitErr, waitlistEntries) => {
                if (waitErr) {
                    console.error('Error fetching attendee waitlist:', waitErr.message);
                    waitlistEntries = [];
                }
                db.getFavoritesForAttendee(req.session.attendee.id, (favoriteErr, wishlistEvents) => {
                    if (favoriteErr) {
                        console.error('Error fetching attendee wishlist:', favoriteErr.message);
                        wishlistEvents = [];
                    }
                    res.render('attendee_dashboard', {
                        title: 'My Attendee Dashboard',
                        attendee: req.session.attendee,
                        bookings: bookings || [],
                        waitlistEntries: waitlistEntries || [],
                        wishlistEvents: wishlistEvents || [],
                        calendarDays,
                        calendarEventsByDate,
                        calendarMonthLabel: new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'Asia/Singapore' }).format(monthDate),
                        nextBookingLabel,
                        query: req.query
                    });
                });
            });
        });
    });
});
// Purpose: Cancels a confirmed booking belonging to the signed-in attendee.
// Inputs: Booking ID from req.params.id and attendee identity from req.session.
// Outputs: Restores inventory and redirects to the attendee dashboard with a result message.
router.post('/bookings/:id/cancel', ensureAttendeeAuthenticated, (req, res) => {
    const bookingId = req.params.id;
    // verify booking belongs to attendee
    db.getBookingById(bookingId, (err, booking) => {
        if (err || !booking) {
            return res.status(404).render('error', { title: 'Not found', message: 'Booking not found', statusCode: 404 });
        }
        if (booking.attendee_id !== req.session.attendee.id) {
            return res.status(403).render('error', { title: 'Forbidden', message: 'You may only cancel your own bookings', statusCode: 403 });
        }
        db.cancelBooking(bookingId, (cancelErr) => {
            if (cancelErr) {
                console.error('Error cancelling booking:', cancelErr.message);
                return res.redirect('/attendee/dashboard?error=cancel_failed');
            }
            res.redirect('/attendee/dashboard?success=cancelled');
        });
    });
});

// Purpose: Displays published events to attendees so they can browse and book.
// Inputs: Optional date filters from req.query.
// Outputs: Renders the attendee home page with ordered event cards and availability information.
router.get('/', (req, res) => {
    db.getSiteSettings((settingsErr, settings) => {
        if (settingsErr) settings = { name: 'PulsePoint Wellness', description: 'Strength, movement and recovery for every body.' };

        const dateFrom = req.query.date_from || '';
        const dateTo = req.query.date_to || '';

        db.getPublishedEvents((err, events) => {
            if (err) {
                console.error('Error fetching published events:', err.message);
                return res.status(500).render('error', {
                    title: 'Error',
                    message: 'Could not load events.',
                    statusCode: 500
                });
            }

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const msPerDay = 24 * 60 * 60 * 1000;

            const enrichedEvents = (events || []).map((event) => {
                const eventDate = event.event_date ? new Date(`${event.event_date}T00:00:00`) : null;
                const eventTime = eventDate ? eventDate.getTime() : null;
                const diffDays = eventTime !== null ? Math.floor((eventTime - today.getTime()) / msPerDay) : null;

                let countdownLabel = 'Date to be confirmed';
                if (diffDays !== null) {
                    if (diffDays < 0) {
                        countdownLabel = 'Past event';
                    } else if (diffDays === 0) {
                        countdownLabel = 'Today';
                    } else if (diffDays === 1) {
                        countdownLabel = 'Tomorrow';
                    } else {
                        countdownLabel = `In ${diffDays} days`;
                    }
                }

                const availableCosts = [];
                if (event.full_price_tickets > 0) availableCosts.push(parseFloat(event.full_price_cost || 0));
                if (event.concession_tickets > 0) availableCosts.push(parseFloat(event.concession_cost || 0));
                const minCost = availableCosts.length ? Math.min(...availableCosts) : null;

                return {
                    ...event,
                    eventDate,
                    countdownLabel,
                    minCost,
                    popularityScore: 0
                };
            });

            const filteredEvents = enrichedEvents.filter((event) => {
                if (event.eventDate && event.eventDate.getTime() < today.getTime()) {
                    return false;
                }

                if (dateFrom) {
                    const fromDate = new Date(`${dateFrom}T00:00:00`);
                    if (event.eventDate && event.eventDate < fromDate) {
                        return false;
                    }
                }

                if (dateTo) {
                    const toDate = new Date(`${dateTo}T23:59:59`);
                    if (event.eventDate && event.eventDate > toDate) {
                        return false;
                    }
                }

                return true;
            });

            db.getPublishedEventPopularityCounts((countErr, popularityRows) => {
                if (countErr) {
                    console.error('Error fetching popularity counts:', countErr.message);
                    popularityRows = [];
                }

                const popularityMap = (popularityRows || []).reduce((map, row) => {
                    map[row.id] = {
                        bookedSeats: Number(row.bookedSeats) || 0,
                        wishlistCount: Number(row.wishlistCount) || 0
                    };
                    return map;
                }, {});

                    const withPopularity = filteredEvents.map((event) => {
                        const popularity = popularityMap[event.id] || { bookedSeats: 0, wishlistCount: 0 };
                        const bookedSeats = popularity.bookedSeats;
                        const availableSeats = (Number(event.full_price_tickets) || 0) + (Number(event.concession_tickets) || 0);
                        const totalCapacity = availableSeats + bookedSeats;
                        const popularityRatio = totalCapacity > 0 ? bookedSeats / totalCapacity : 0;
                        let availabilityLabel = 'Plenty available';
                        let availabilityTone = 'plenty';

                        if (totalCapacity > 0 && availableSeats === 0) {
                            availabilityLabel = 'Fully booked';
                            availabilityTone = 'full';
                        } else if (totalCapacity > 0 && availableSeats <= 5) {
                            availabilityLabel = `Only ${availableSeats} left`;
                            availabilityTone = 'limited';
                        } else if (totalCapacity > 0 && availableSeats <= 15) {
                            availabilityLabel = 'Selling fast';
                            availabilityTone = 'selling';
                        }

                        return {
                            ...event,
                            popularityScore: bookedSeats,
                            bookedSeats,
                            totalCapacity,
                            availableSeats,
                            popularityRatio,
                            availabilityLabel,
                            availabilityTone,
                            isFullyBooked: totalCapacity > 0 && availableSeats === 0,
                            wishlistCount: popularity.wishlistCount
                        };
                    });

                    const sortedEvents = withPopularity.slice().sort((a, b) => {
                        if (!a.eventDate && !b.eventDate) return 0;
                        if (!a.eventDate) return 1;
                        if (!b.eventDate) return -1;
                        return a.eventDate - b.eventDate;
                    });

                    // Trending is based only on confirmed occupancy. Zero-sale events never qualify.
                    const popularEvents = withPopularity
                        .filter((event) => event.bookedSeats > 0 && event.totalCapacity > 0)
                        .slice()
                        .sort((a, b) => b.popularityRatio - a.popularityRatio || b.popularityScore - a.popularityScore)
                        .slice(0, 5)
                        .map((event) => ({
                            id: event.id,
                            title: event.title,
                            bookedSeats: event.popularityScore,
                            availableSeats: event.availableSeats,
                            totalCapacity: event.totalCapacity,
                            popularityRatio: event.popularityRatio,
                            availabilityLabel: event.availabilityLabel,
                            availabilityTone: event.availabilityTone,
                            isFullyBooked: event.isFullyBooked
                        }));

                    const renderHome = (favoriteRows) => {
                        const wishlistIds = new Set((favoriteRows || []).map((row) => Number(row.event_id)));
                        res.render('attendee_home', {
                            title: 'Attendee Home Page',
                            events: sortedEvents.map((event) => ({ ...event, isWishlisted: wishlistIds.has(Number(event.id)) })),
                            siteSettings: settings,
                            dateFrom,
                            dateTo,
                            popularEvents,
                            authMessage: req.query.auth === 'signin_required' ? 'Please sign in or continue as a guest to access your personal attendee area.' : null
                        });
                    };

                    if (req.session && req.session.attendee) {
                        return db.getFavoritesForAttendee(req.session.attendee.id, (favoriteErr, favoriteRows) => {
                            if (favoriteErr) console.error('Error loading wishlist state:', favoriteErr.message);
                            renderHome(favoriteErr ? [] : favoriteRows);
                        });
                    }
                    renderHome([]);
                }
            );
        });
    });
});

// Purpose: Saves a published event to the signed-in attendee's wishlist.
// Inputs: Event ID and authenticated attendee identity. Outputs: Duplicate-safe saved state.
router.post('/events/:id/wishlist', ensureAttendeeAuthenticated, (req, res) => {
    const eventId = req.params.id;
    db.getEventById(eventId, (eventErr, event) => {
        if (eventErr || !event || event.status !== 'published') {
            return res.status(404).render('error', { title: 'Not Available', message: 'This event is not available to save.', statusCode: 404 });
        }
        db.addFavorite(req.session.attendee.id, eventId, (favoriteErr) => {
            if (favoriteErr) {
                console.error('Error adding wishlist event:', favoriteErr.message);
                return res.redirect('/attendee?wishlist=error');
            }
            res.redirect('/attendee');
        });
    });
});

// Purpose: Removes an event from the signed-in attendee's wishlist.
// Inputs: Event ID and authenticated attendee identity. Outputs: Updated saved state.
router.post('/events/:id/wishlist/remove', ensureAttendeeAuthenticated, (req, res) => {
    const returnPath = String(req.get('referer') || '').includes('/attendee/dashboard')
        ? '/attendee/dashboard'
        : '/attendee';
    db.removeFavorite(req.session.attendee.id, req.params.id, (favoriteErr) => {
        if (favoriteErr) {
            console.error('Error removing wishlist event:', favoriteErr.message);
        }
        res.redirect(returnPath);
    });
});

// Purpose: Shows the booking page for a single published event.
// Inputs: Event ID from req.params.id.
// Outputs: Renders the attendee event page with event details and ticket availability.
router.get('/events/:id', (req, res) => {
    const eventId = req.params.id;
    db.getEventById(eventId, (err, event) => {
        if (err || !event) {
            return res.status(404).render('error', {
                title: 'Not Found',
                message: 'Event not found.',
                statusCode: 404
            });
        }
        if (event.status !== 'published') {
            return res.status(404).render('error', {
                title: 'Not Available',
                message: 'This event is not available for booking.',
                statusCode: 404
            });
        }
        db.getBookingCount(eventId, (err2, counts) => {
            if (err2) counts = { full_price_booked: 0, concession_booked: 0 };
            const signedInName = req.session && req.session.attendee ? req.session.attendee.name : '';
            const signedInEmail = req.session && req.session.attendee ? req.session.attendee.email : '';
            const remainingFull = Math.max(0, Number(event.full_price_tickets || 0));
            const remainingConcession = Math.max(0, Number(event.concession_tickets || 0));
            const totalFullCapacity = remainingFull + Number(counts?.full_price_booked || 0);
            const totalConcessionCapacity = remainingConcession + Number(counts?.concession_booked || 0);
            const availabilitySummary = {
                remaining: remainingFull + remainingConcession,
                total: totalFullCapacity + totalConcessionCapacity,
                remainingFull,
                totalFullCapacity,
                remainingConcession,
                totalConcessionCapacity
            };

            const renderEventPage = (waitlistEntry) => res.render('attendee_event', {
                title: event.title,
                event: event,
                bookings: counts,
                query: req.query,
                signedInName,
                signedInEmail,
                availabilitySummary,
                waitlistEntry: waitlistEntry || null
            });
            if (req.session && req.session.attendee) {
                return db.getWaitlistEntry(eventId, req.session.attendee.id, (waitErr, waitlistEntry) => {
                    if (waitErr) console.error('Error loading waitlist state:', waitErr.message);
                    renderEventPage(waitlistEntry);
                });
            }
            renderEventPage(null);
        });
    });
});

// Purpose: Adds a signed-in attendee to a sold-out event waitlist.
// Inputs: Event ID from req.params.id and attendee identity from req.session.
// Outputs: Stores one duplicate-safe queue entry and redirects with its position.
router.post('/events/:id/waitlist', ensureAttendeeAuthenticated, (req, res) => {
    const eventId = req.params.id;
    db.joinWaitlist(eventId, req.session.attendee.id, (err, result) => {
        if (err) {
            return res.redirect('/attendee/events/' + encodeURIComponent(eventId) + '?waitlist_error=' + encodeURIComponent(err.message));
        }
        res.redirect('/attendee/events/' + encodeURIComponent(eventId) + '?waitlist_success=' + encodeURIComponent(String(result.position)));
    });
});

// Purpose: Processes a booking request for one or more tickets.
// Inputs: Event ID from req.params.id and booking/payment fields from req.body.
// Outputs: Creates a booking in SQLite, updates ticket inventory, and renders a confirmation page with a QR receipt.
router.post('/events/:id/book', (req, res) => {
    const eventId = req.params.id;
    const attendeeName = (req.body.attendee_name || (req.session && req.session.attendee ? req.session.attendee.name : '') || '').trim();
    const paymentName = (req.body.payment_name || '').trim();
    const paymentMethod = (req.body.payment_method || '').trim();
    const paymentNumber = (req.body.payment_number || '').replace(/\s+/g, '');
    const paymentExpiry = (req.body.payment_expiry || '').trim();
    const paymentCvv = (req.body.payment_cvv || '').trim();
    const rawFullPriceQty = String(req.body.full_price_qty || '0').trim();
    const rawConcessionQty = String(req.body.concession_qty || '0').trim();
    const fullPriceQty = rawFullPriceQty === '' ? 0 : Number(rawFullPriceQty);
    const concessionQty = rawConcessionQty === '' ? 0 : Number(rawConcessionQty);

    if (!attendeeName || !paymentName || !paymentMethod || !paymentNumber || !paymentExpiry || !paymentCvv) {
        return res.redirect(`/attendee/events/${eventId}?error=payment_invalid`);
    }

    const cardLast4 = paymentNumber.slice(-4);
    if (!/^\d{13,19}$/.test(paymentNumber) || !/^\d{2}\/\d{2}$/.test(paymentExpiry) || !/^\d{3,4}$/.test(paymentCvv)) {
        return res.redirect(`/attendee/events/${eventId}?error=payment_invalid`);
    }

    if (!Number.isFinite(fullPriceQty) || !Number.isFinite(concessionQty) || !Number.isInteger(fullPriceQty) || !Number.isInteger(concessionQty) || fullPriceQty < 0 || concessionQty < 0) {
        return res.redirect(`/attendee/events/${eventId}?error=invalid_quantities`);
    }
    if (fullPriceQty === 0 && concessionQty === 0) {
        return res.redirect(`/attendee/events/${eventId}?error=no_tickets`);
    }

    db.getEventById(eventId, (eventErr, event) => {
        if (eventErr || !event) {
            return res.redirect(`/attendee/events/${eventId}?error=event_unavailable`);
        }
        db.createBooking({
            event_id: eventId,
            attendee_id: req.session && req.session.attendee ? req.session.attendee.id : null,
            attendee_name: attendeeName,
            full_price_qty: fullPriceQty,
            concession_qty: concessionQty,
            payment_name: paymentName,
            payment_method: paymentMethod,
            payment_last4: cardLast4,
            payment_brand: detectCardBrand(paymentNumber)
        }, (err, bookingId) => {
            if (err) {
                console.error('Error creating booking:', err.message);
                const normalizedMessage = String(err.message || '').toLowerCase();
                const errorKey = normalizedMessage.includes('tickets') || normalizedMessage.includes('remain')
                    ? 'availability'
                    : normalizedMessage.includes('deadline')
                        ? 'deadline'
                    : normalizedMessage.includes('not available') || normalizedMessage.includes('passed')
                        ? 'event_unavailable'
                        : 'booking_failed';
                return res.redirect(303, `/attendee/events/${eventId}?error=${errorKey}`);
            }
            db.getBookingById(bookingId, (detailsErr, booking) => {
                if (detailsErr || !booking) {
                    console.error('Error loading booking receipt:', detailsErr ? detailsErr.message : 'Booking missing');
                    return res.redirect(303, `/attendee/events/${eventId}?error=booking_failed`);
                }

                const qrPayload = buildCheckInUrl(req, booking);
                QRCode.toDataURL(qrPayload, { errorCorrectionLevel: 'M', margin: 1, width: 220 }, (qrErr, qrCodeDataUrl) => {
                    if (qrErr) {
                        console.error('Error generating booking QR code:', qrErr.message);
                        return res.redirect(303, `/attendee/events/${eventId}?error=booking_failed`);
                    }

                    if (req.session) {
                        req.session.lastBookingId = booking.id;
                    }

                    res.render('attendee_booking_confirmation', {
                        title: 'Booking Confirmed',
                        booking,
                        qrCodeDataUrl,
                        paymentSimulated: true,
                        eventDateText: formatDateDisplay(booking.event_date)
                    });
                });
            });
        });
    });
});

module.exports = router;
