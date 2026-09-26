const express = require('express');
const router = express.Router();
const db = require('./db');
const { ensureAuthenticated } = require('../middleware/auth');
const { formatDateTimeDisplay, countWords } = require('../utils/formatDate');

const allowedFontFamilies = ['Barlow Condensed', 'Inter', 'Georgia', 'Times New Roman'];

router.use(ensureAuthenticated);

// Purpose: Renders the site settings form for the organiser.
// Inputs: Authenticated organiser session from req.session.
// Outputs: Displays the current site name, description, and display preferences from SQLite.
router.get('/', (req, res) => {
    db.getSiteSettings((err, settings) => {
        if (err || !settings) {
            settings = {
                name: 'PulsePoint Wellness',
                description: 'Strength, movement and recovery — built for every body.',
                display_font_family: 'Barlow Condensed',
                description_italic: 0,
                last_modified_at: null
            };
        }
        res.render('settings', {
            title: 'Site Settings Page',
            settings: settings,
            lastModifiedText: formatDateTimeDisplay(settings.last_modified_at),
            descriptionWordCount: countWords(settings.description)
        });
    });
});

// Purpose: Updates the saved site settings values.
// Inputs: Site name, description, font choice, and italic preference from req.body.
// Outputs: Saves validated settings to SQLite and redirects back to the organiser home page.
router.post('/update', (req, res) => {
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const displayFontFamily = allowedFontFamilies.includes(req.body.display_font_family) ? req.body.display_font_family : 'Barlow Condensed';
    const descriptionItalic = req.body.description_italic === 'on' || req.body.description_italic === '1';

    if (!name || !description) {
        return db.getSiteSettings((err, settings) => {
            if (err || !settings) {
                settings = {
                    name: 'PulsePoint Wellness',
                    description: 'Strength, movement and recovery — built for every body.',
                    display_font_family: 'Barlow Condensed',
                    description_italic: 0,
                    last_modified_at: null
                };
            }

            return res.status(400).render('settings', {
                title: 'Site Settings Page',
                settings: {
                    ...settings,
                    name,
                    description,
                    display_font_family: displayFontFamily,
                    description_italic: descriptionItalic ? 1 : 0
                },
                error: 'Both the site name and description are required.',
                lastModifiedText: formatDateTimeDisplay(settings.last_modified_at),
                descriptionWordCount: countWords(description)
            });
        });
    }

    if (countWords(description) > 100) {
        return db.getSiteSettings((err, settings) => {
            if (err || !settings) {
                settings = {
                    name: 'PulsePoint Wellness',
                    description: 'Strength, movement and recovery — built for every body.',
                    display_font_family: 'Barlow Condensed',
                    description_italic: 0,
                    last_modified_at: null
                };
            }

            return res.status(400).render('settings', {
                title: 'Site Settings Page',
                settings: {
                    ...settings,
                    name,
                    description,
                    display_font_family: displayFontFamily,
                    description_italic: descriptionItalic ? 1 : 0
                },
                error: 'The site description must be 100 words or fewer.',
                lastModifiedText: formatDateTimeDisplay(settings.last_modified_at),
                descriptionWordCount: countWords(description)
            });
        });
    }

    db.updateSiteSettings({
        name,
        description,
        display_font_family: displayFontFamily,
        description_italic: descriptionItalic
    }, (err) => {
        if (err) {
            console.error('Error updating settings:', err.message);
            return res.status(500).render('error', {
                title: 'Error',
                message: 'Could not update settings.',
                statusCode: 500
            });
        }

        db.getSiteSettings((reloadErr, updatedSettings) => {
            if (reloadErr || !updatedSettings) {
                return res.redirect('/organiser');
            }

            return res.redirect('/organiser');
        });
    });
});

module.exports = router;
