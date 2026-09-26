// Purpose: Initialises non-critical interface interactions after the page is ready.
// Inputs: Browser DOMContentLoaded event. Outputs: Adds animations and client-side display helpers.
document.addEventListener('DOMContentLoaded', function () {
    // Auto-dismiss alerts after 5 seconds
    var alerts = document.querySelectorAll('.alert');
    alerts.forEach(function (alert) {
        setTimeout(function () {
            alert.style.transition = 'opacity 0.5s ease';
            alert.style.opacity = '0';
            setTimeout(function () { alert.remove(); }, 500);
        }, 5000);
    });

    // Reveal homepage sections on scroll with lightweight motion
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var revealElements = document.querySelectorAll('.reveal-on-scroll');

    if (reducedMotion || !('IntersectionObserver' in window)) {
        revealElements.forEach(function (element) {
            element.classList.add('is-visible');
        });
    } else {
        var revealObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    revealObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.16 });

        revealElements.forEach(function (element) {
            revealObserver.observe(element);
        });
    }

    // Animate KPI counters on booking-management and other pages
    var counterElements = document.querySelectorAll('[data-counter]');
    counterElements.forEach(function (counter) {
        var rawValue = counter.getAttribute('data-counter') || '0';
        var decimals = Number(counter.getAttribute('data-counter-decimals')) || 0;
        var prefix = counter.getAttribute('data-counter-prefix') || '';
        var suffix = counter.getAttribute('data-counter-suffix') || '';
        var targetValue = Number(rawValue) || 0;
        var duration = 1200;
        var startTime = null;

        // Purpose: Formats an animated counter for display.
        // Inputs: Current numeric animation value. Outputs: Prefix/value/suffix display string.
        function formatValue(value) {
            if (decimals > 0) {
                return prefix + value.toFixed(decimals) + suffix;
            }
            return prefix + Math.floor(value).toLocaleString() + suffix;
        }

        // Purpose: Advances one counter animation frame.
        // Inputs: Browser animation timestamp. Outputs: Updates counter text and schedules the next frame.
        function updateCount(timestamp) {
            if (!startTime) startTime = timestamp;
            var progress = Math.min((timestamp - startTime) / duration, 1);
            var currentValue = targetValue * progress;
            counter.textContent = formatValue(currentValue);

            if (progress < 1) {
                window.requestAnimationFrame(updateCount);
            } else {
                counter.textContent = formatValue(targetValue);
            }
        }

        window.requestAnimationFrame(updateCount);
    });

    // Auto-scroll to calendar card when the page loads with a calendar hash
    if (window.location.hash === '#calendar-card') {
        var calendarCard = document.getElementById('calendar-card');
        if (calendarCard) {
            setTimeout(function () {
                calendarCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 150);
        }
    }

    // Add coordinated motion to content across all pages without hiding it when JavaScript is unavailable.
    var motionItems = document.querySelectorAll('.page-header .container, .section-head, .kpi-card, .kpi-tile, .metric-card, .insight-card, .calendar-card, .event-card, .side-card, .form-card, .table-card, .booking-card, .confirmation-card, .home-feature-card, .event-overview-card, .payment-inline-block, .ticket-line, .organiser-control-copy, .organiser-action, .organiser-section-count');
    motionItems.forEach(function (item, index) {
        item.classList.add('motion-item');
        item.style.setProperty('--motion-delay', ((index % 6) * 55) + 'ms');
    });
    document.documentElement.classList.add('motion-ready');

    if (reducedMotion || !('IntersectionObserver' in window)) {
        motionItems.forEach(function (item) { item.classList.add('is-visible'); });
    } else {
        var motionObserver = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isIntersecting) {
                    entry.target.classList.add('is-visible');
                    motionObserver.unobserve(entry.target);
                }
            });
        }, { threshold: 0.08, rootMargin: '0px 0px -35px 0px' });

        motionItems.forEach(function (item) { motionObserver.observe(item); });
    }

    // Prepare optional event photographs as validated data URLs for the normal URL-encoded form.
    var imageUploaders = document.querySelectorAll('[data-image-uploader]');
    imageUploaders.forEach(function (uploader) {
        var input = uploader.querySelector('[data-image-input]');
        var hiddenInput = uploader.querySelector('[data-image-data]');
        var preview = uploader.querySelector('[data-image-preview]');
        var previewWrap = uploader.querySelector('[data-image-preview-wrap]');
        var placeholder = uploader.querySelector('[data-image-placeholder]');
        var errorText = uploader.querySelector('[data-image-error]');
        if (!input || !hiddenInput) return;

        // Purpose: Shows an image-selection problem beside the optional photo field.
        // Inputs: Human-readable message. Outputs: Updates the field error and clears invalid data.
        function showImageError(message) {
            hiddenInput.value = '';
            uploader.dataset.loading = '0';
            if (errorText) errorText.textContent = message;
        }

        input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (errorText) errorText.textContent = '';
            if (!file) return;
            if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
                input.value = '';
                return showImageError('Choose a JPG, PNG, or WEBP image.');
            }
            if (file.size > 2 * 1024 * 1024) {
                input.value = '';
                return showImageError('Choose an image smaller than 2 MB.');
            }

            uploader.dataset.loading = '1';
            var reader = new FileReader();
            reader.onload = function () {
                hiddenInput.value = String(reader.result || '');
                uploader.dataset.loading = '0';
                if (preview) {
                    preview.src = hiddenInput.value;
                    preview.hidden = false;
                }
                if (placeholder) placeholder.hidden = true;
                if (previewWrap) previewWrap.classList.add('has-image');
            };
            reader.onerror = function () { showImageError('The selected image could not be read.'); };
            reader.readAsDataURL(file);
        });

        var eventForm = uploader.closest('form');
        if (eventForm) {
            eventForm.addEventListener('submit', function (event) {
                if (uploader.dataset.loading === '1') {
                    event.preventDefault();
                    showImageError('Please wait a moment for the photo preview, then submit again.');
                }
            });
        }
    });

    var calendar = document.getElementById('attendee-calendar');
    var calendarDetail = document.querySelector('[data-calendar-detail]');

    if (calendar && calendarDetail) {
        calendar.addEventListener('click', function (event) {
            var button = event.target.closest('[data-calendar-day]');
            if (!button) return;

            calendar.querySelectorAll('[data-calendar-day]').forEach(function (dayButton) {
                dayButton.classList.remove('is-selected');
                dayButton.setAttribute('aria-pressed', 'false');
            });
            button.classList.add('is-selected');
            button.setAttribute('aria-pressed', 'true');

            var encodedEvents = button.getAttribute('data-calendar-events') || '';
            var selectedLabel = button.getAttribute('data-calendar-label') || 'Selected date';
            var dayEvents = [];

            try {
                dayEvents = JSON.parse(decodeURIComponent(encodedEvents));
            } catch (error) {
                dayEvents = [];
            }

            var detailHtml = '<p class="calendar-detail-panel__heading">' + selectedLabel + '</p>';

            if (!dayEvents.length) {
                detailHtml += '<p class="calendar-detail-panel__empty">No booked events on this date.</p>';
            } else {
                detailHtml += '<ul class="calendar-detail-panel__list">';
                dayEvents.forEach(function (item) {
                    detailHtml += '<li class="calendar-detail-panel__item">';
                    detailHtml += '<strong>' + item.title + '</strong>';
                    detailHtml += '<span>' + item.time + '</span>';
                    detailHtml += '<span class="calendar-detail-panel__meta">' + item.reference + ' · ' + item.status + '</span>';
                    detailHtml += '</li>';
                });
                detailHtml += '</ul>';
            }

            calendarDetail.innerHTML = detailHtml;
        });
    }

    var fullQty = document.getElementById('full_price_qty');
    var concessionQty = document.getElementById('concession_qty');
    var bookingTotal = document.getElementById('bookingTotal');

    if (bookingTotal && (fullQty || concessionQty)) {
        // Purpose: Calculates the attendee's live booking total.
        // Inputs: Current quantity controls and their unit-price data. Outputs: Updates the displayed SGD total.
        function updateBookingTotal() {
            var fullQtyValue = fullQty ? Number(fullQty.value) : 0;
            var concessionQtyValue = concessionQty ? Number(concessionQty.value) : 0;
            var fullPrice = fullQty && fullQty.dataset.unitPrice ? Number(fullQty.dataset.unitPrice) : 0;
            var concessionPrice = concessionQty && concessionQty.dataset.unitPrice ? Number(concessionQty.dataset.unitPrice) : 0;
            var total = (fullQtyValue * fullPrice) + (concessionQtyValue * concessionPrice);
            bookingTotal.textContent = 'SGD $' + total.toFixed(2);
        }

        [fullQty, concessionQty].forEach(function (input) {
            if (!input) return;
            input.addEventListener('input', updateBookingTotal);
            input.addEventListener('change', updateBookingTotal);
        });

        updateBookingTotal();
    }

    // No interception for favorite/save forms — let the browser handle POSTs directly
});
