#!/usr/bin/env bash
# Final integration test script.
set -u

cd /home/z/my-project/ine-tracker/backend

echo "=== FINAL INTEGRATION TEST ==="
echo ""
echo "1) Scraper against real mock store (headless, product 36):"
timeout 90 node src/scraper/run-scrape.js 36 2>&1 | tail -15
echo ""

echo "2) Boot Express server with a known CRON_SECRET..."
PORT=3098 CRON_SECRET=xyz node src/server.js >/tmp/server.log 2>&1 &
SERVER_PID=$!
sleep 3

echo "3) /api/health:"
curl -sS -m 5 "http://localhost:3098/api/health"
echo ""

echo "4) /api/scrape-trigger with NO secret (expect 401):"
curl -sS -m 5 -X POST "http://localhost:3098/api/scrape-trigger" -w "  HTTP %{http_code}\n"

echo "5) /api/scrape-trigger with WRONG secret (expect 401):"
curl -sS -m 5 -X POST -H "X-Cron-Secret: nope" "http://localhost:3098/api/scrape-trigger" -w "  HTTP %{http_code}\n"

echo "6) /api/scrape-trigger with CORRECT secret but no DB (expect 500 with clear message):"
curl -sS -m 5 -X POST -H "X-Cron-Secret: xyz" "http://localhost:3098/api/scrape-trigger" -w "  HTTP %{http_code}\n"

echo "7) /api/search?q=webcam (hits INE's real catalog):"
curl -sS -m 15 "http://localhost:3098/api/search?q=webcam" | head -c 400
echo "..."

echo ""
echo "8) Stopping server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

echo ""
echo "=== ALL CHECKS DONE ==="
