/**
 * notifications.js
 * --------------------------------------------------------------------------
 * Express routes for in-app notifications:
 *   GET   /api/notifications             List all active (undismissed) notifications
 *   POST  /api/notifications/:id/dismiss Dismiss a single notification
 *   POST  /api/notifications/dismiss-all Dismiss all active notifications
 */

const express = require('express');
const db = require('../db/store');

const router = express.Router();

// List active notifications
router.get('/', async (_req, res) => {
  try {
    const items = await db.listNotifications();
    res.json({ items: items || [] });
  } catch (err) {
    console.error('[notifications GET] Error:', err.message);
    res.status(500).json({ error: 'Failed to list notifications', detail: err.message });
  }
});

// Dismiss a single notification
router.post('/:id/dismiss', async (req, res) => {
  try {
    const ok = await db.dismissNotification(req.params.id);
    res.json({ success: true, dismissed: req.params.id, found: ok });
  } catch (err) {
    console.error('[notifications dismiss] Error:', err.message);
    res.status(500).json({ error: 'Failed to dismiss notification', detail: err.message });
  }
});

// Dismiss all active notifications
router.post('/dismiss-all', async (_req, res) => {
  try {
    await db.dismissAllNotifications();
    res.json({ success: true, dismissedAll: true });
  } catch (err) {
    console.error('[notifications dismiss-all] Error:', err.message);
    res.status(500).json({ error: 'Failed to dismiss all notifications', detail: err.message });
  }
});

module.exports = router;
