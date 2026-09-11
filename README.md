## Usage

1. Install the Tampermonkey extension in Chrome or another Chromium-based browser.

2. Open Tampermonkey and create a new userscript. Copy the contents of `tampermonkey_script.js` into it and save the script.

3. Reload `https://chatgpt.com`.

4. Start the local bridge server:

```bash
node server.js
```

The server listens on:

```text
http://127.0.0.1:8765
```

5. Send prompts to the bridge using `curl`:

```bash
curl -X POST http://127.0.0.1:8765/chat \
  -H 'Content-Type: application/json' \
  -d '{"prompt":"Top 10 scariest dinosaurs"}'
```

The bridge sends the prompt to the currently open ChatGPT conversation and returns the assistant's response.

## Important limitations

This bridge is currently **fragile and experimental**. It relies on the ChatGPT web interface and its DOM rather than an official API, so changes to ChatGPT's UI can break the script. It may also occasionally fail or behave unexpectedly.

**Only have one ChatGPT tab open while using the bridge.** The script interacts with the currently loaded ChatGPT page and is not designed to coordinate multiple ChatGPT tabs or conversations.

The bridge also works most reliably when Chrome (or another Chromium-based browser) is **active and visible on screen**. Backgrounded, minimized, or otherwise non-visible browser windows may cause rendering or DOM updates to be delayed, which can interfere with the bridge.

Treat the current implementation as a development tool rather than a reliable production service.
