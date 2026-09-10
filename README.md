Place tampermonkey_script.js into the tampermonkey extension then reload chatgpt.com
Run node server.js
And send requests using curl like:
❯ curl -X POST http://127.0.0.1:8765/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Top 10 scariest dinosaurs"}'

It's still buggy and fragile.
Make sure to only have on chatgpt tab open at a time and leave it be, don't interact with it while the script is running.