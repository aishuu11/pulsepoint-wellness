const express = require('express');
const router = express.Router();
const db = require('./db');

// Purpose: Renders the landing page for the application.
// Inputs: None.
// Outputs: Shows the main home page with links to the organiser and attendee areas.
router.get('/', (req, res) => {
    db.getRevenueOverview((err, summary) => {
        if (err) {
            console.error('Error loading homepage summary:', err.message);
            summary = {};
        }
        res.render('main_home', { title: 'Home', summary: summary || {} });
    });
});

module.exports = router;
