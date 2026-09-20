/**
 * NotificationsBell.jsx
 * --------------------------------------------------------------------------
 * In-app notifications dropdown displaying price drops, price increases,
 * and back-in-stock alerts.
 * Matches the user's specification with "NOTIFICATIONS", "Dismiss all",
 * and individual "Click to dismiss" items.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api.js';

export default function NotificationsBell() {
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const wrapperRef = useRef(null);

  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.getNotifications();
      setNotifications(res.items || []);
    } catch (err) {
      // Quietly ignore network failures in background poll
    }
  }, []);

  useEffect(() => {
    loadNotifications();
    const timer = setInterval(loadNotifications, 8000);
    return () => clearInterval(timer);
  }, [loadNotifications]);

  // Close when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [open]);

  const handleDismiss = async (id) => {
    // Optimistic UI update
    setNotifications((prev) => prev.filter((n) => String(n.id) !== String(id)));
    try {
      await api.dismissNotification(id);
    } catch (err) {
      console.warn('Failed to dismiss notification:', err);
      loadNotifications();
    }
  };

  const handleDismissAll = async () => {
    // Optimistic UI update
    setNotifications([]);
    try {
      await api.dismissAllNotifications();
    } catch (err) {
      console.warn('Failed to dismiss all notifications:', err);
      loadNotifications();
    }
  };

  const count = notifications.length;

  return (
    <div className="notif-wrapper" ref={wrapperRef}>
      <button
        className="notif-bell-btn"
        onClick={() => setOpen((prev) => !prev)}
        title="View price alerts and notifications"
        aria-label={`Notifications (${count} unread)`}
      >
        <svg
          className="notif-bell-icon"
          viewBox="0 0 24 24"
          width="20"
          height="20"
          stroke="currentColor"
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
          <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
        </svg>
        {count > 0 && <span className="notif-badge">{count}</span>}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <span className="notif-title">NOTIFICATIONS</span>
            {count > 0 && (
              <button
                type="button"
                className="notif-dismiss-all"
                onClick={handleDismissAll}
              >
                Dismiss all
              </button>
            )}
          </div>

          <div className="notif-body">
            {count === 0 ? (
              <div className="notif-empty">
                <p className="muted small" style={{ margin: 0 }}>No active notifications.</p>
              </div>
            ) : (
              <ul className="notif-list">
                {notifications.map((n) => (
                  <li key={n.id} className="notif-item">
                    <div className="notif-message">
                      {n.message}
                    </div>
                    <button
                      type="button"
                      className="notif-dismiss-btn"
                      onClick={() => handleDismiss(n.id)}
                    >
                      Click to dismiss
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
