// Purpose: Guards organiser routes so only authenticated organisers may access protected pages.
// Inputs: Express request, response, and next middleware.
// Outputs: Continues to the next middleware or redirects unauthenticated users to the organiser login page.
function ensureAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        return next();
    }
    res.redirect('/organiser/login');
}

// Purpose: Guards attendee pages so only authenticated attendees may access private dashboard features.
// Inputs: Express request, response, and next middleware.
// Outputs: Continues to the next middleware or redirects unauthenticated users to the attendee home page.
function ensureAttendeeAuthenticated(req, res, next) {
    if (req.session && req.session.attendee) {
        return next();
    }
    if (req.method && req.method.toUpperCase() !== 'GET') {
        return res.redirect(303, '/attendee?auth=signin_required');
    }
    res.redirect('/attendee?auth=signin_required');
}

module.exports = {
    ensureAuthenticated,
    ensureAttendeeAuthenticated
};
