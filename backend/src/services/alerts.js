/**
 * alerts.js
 * --------------------------------------------------------------------------
 * Email notification dispatcher for Price Drops and Back-In-Stock events
 * via SendGrid API.
 *
 * SAFETY GUARANTEE:
 *   - Runs asynchronously after successful scrapes.
 *   - Completely non-blocking and isolated in try/catch.
 *   - Misconfigured keys or SendGrid network outages will NEVER fail,
 *     crash, or delay the scraping / logging flow.
 */

const https = require('https');

/**
 * Send an email alert if price dropped or item returned to stock.
 */
async function sendPriceDropOrStockAlert(product, alertData) {
  if (!alertData || (!alertData.isPriceDrop && !alertData.isPriceIncrease && !alertData.isBackInStock)) {
    return { sent: false, reason: 'no alert condition met' };
  }

  const apiKey = process.env.SENDGRID_API_KEY;
  const recipient = process.env.ALERT_EMAIL;
  const sender = process.env.SENDGRID_FROM_EMAIL || 'alerts@ine-tracker.local';

  // If SendGrid is not configured, log cleanly and return
  if (!apiKey || !recipient) {
    const triggerType = alertData.isPriceDrop && alertData.isBackInStock
      ? 'Price Drop & Back-in-Stock'
      : alertData.isPriceDrop
      ? 'Price Drop'
      : alertData.isPriceIncrease
      ? 'Price Increase'
      : 'Back-in-Stock';

    console.log(`[alerts] ${triggerType} detected for "${product.name}" (price: ₹${alertData.newPrice}, stock: ${alertData.newStock}). SendGrid unconfigured (SENDGRID_API_KEY / ALERT_EMAIL not set), skipping email dispatch.`);
    return { sent: false, reason: 'SendGrid unconfigured' };
  }

  try {
    let subject = `[INE Tracker] Alert for ${product.name}`;
    let messageBody = `Product Alert: ${product.name}\n\n`;

    if (alertData.isPriceDrop && alertData.isBackInStock) {
      subject = `[INE Alert] Price Drop & Back in Stock: ${product.name} (Now ₹${alertData.newPrice.toLocaleString('en-IN')})`;
      messageBody += `Great news! ${product.name} is back in stock AND dropped in price.\n\n` +
        `New Price: ₹${alertData.newPrice.toLocaleString('en-IN')} (Dropped by ₹${alertData.priceChange.toLocaleString('en-IN')} from ₹${alertData.prevPrice.toLocaleString('en-IN')})\n` +
        `Stock: ${alertData.newStock} units available (Previously Out of Stock)\n`;
    } else if (alertData.isPriceDrop) {
      subject = `[INE Alert] Price Dropped: ${product.name} (Now ₹${alertData.newPrice.toLocaleString('en-IN')})`;
      messageBody += `Price Drop Alert!\n\n` +
        `Product: ${product.name} (${product.brand || ''} ${product.category || ''})\n` +
        `New Price: ₹${alertData.newPrice.toLocaleString('en-IN')}\n` +
        `Previous Price: ₹${alertData.prevPrice.toLocaleString('en-IN')}\n` +
        `You Save: ₹${alertData.priceChange.toLocaleString('en-IN')}\n` +
        `Current Stock: ${alertData.newStock} units\n`;
    } else if (alertData.isPriceIncrease) {
      subject = `[INE Alert] Price Increased: ${product.name} (Now ₹${alertData.newPrice.toLocaleString('en-IN')})`;
      messageBody += `Price Increase Notice!\n\n` +
        `Product: ${product.name} (${product.brand || ''} ${product.category || ''})\n` +
        `New Price: ₹${alertData.newPrice.toLocaleString('en-IN')}\n` +
        `Previous Price: ₹${alertData.prevPrice.toLocaleString('en-IN')}\n` +
        `Increased By: +₹${alertData.priceChange.toLocaleString('en-IN')}\n` +
        `Current Stock: ${alertData.newStock} units\n`;
    } else if (alertData.isBackInStock) {
      subject = `[INE Alert] Back in Stock: ${product.name} (${alertData.newStock} available)`;
      messageBody += `Back in Stock Alert!\n\n` +
        `Product: ${product.name}\n` +
        `Stock: ${alertData.newStock} units available (previously 0)\n` +
        `Price: ₹${alertData.newPrice.toLocaleString('en-IN')}\n`;
    }

    messageBody += `\nTracked Product ID: #${product.source_product_id || product.id}\n` +
      `Check your dashboard: http://localhost:5173/product/${product.id}\n`;

    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: recipient }] }],
      from: { email: sender, name: 'INE Price Tracker' },
      subject,
      content: [{ type: 'text/plain', value: messageBody }],
    });

    const result = await new Promise((resolve) => {
      const req = https.request(
        'https://api.sendgrid.com/v3/mail/send',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(payload),
          },
        },
        (res) => {
          res.resume();
          req.setTimeout(0);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[alerts] SendGrid email successfully dispatched to ${recipient} for "${product.name}"`);
            resolve({ sent: true, statusCode: res.statusCode });
          } else {
            console.warn(`[alerts] SendGrid API returned status ${res.statusCode}`);
            resolve({ sent: false, statusCode: res.statusCode });
          }
        }
      );

      req.on('error', (err) => {
        console.warn('[alerts] SendGrid network request failed:', err.message);
        resolve({ sent: false, error: err.message });
      });

      req.setTimeout(8000, () => {
        req.destroy();
        console.warn('[alerts] SendGrid request timed out after 8s');
        resolve({ sent: false, error: 'timeout' });
      });

      req.write(payload);
      req.end();
    });

    return result;
  } catch (err) {
    console.warn('[alerts] Unexpected error during SendGrid dispatch (safely caught):', err.message);
    return { sent: false, error: err.message };
  }
}

module.exports = {
  sendPriceDropOrStockAlert,
};
