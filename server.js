const express = require('express');

const app = express();
const PORT = 8765;

app.use(express.json());

let pendingRequest = null;
let nextRequestId = 1;

const waitingRequests = new Map();

app.get('/health', (req, res) => {
    res.json({
        ok: true,
        service: 'chatgpt-bridge',
    });
});

// Tampermonkey polls this endpoint for work.
app.get('/next', (req, res) => {
    if (!pendingRequest) {
        return res.json({
            ok: true,
            request: null,
        });
    }

    const request = pendingRequest;
    pendingRequest = null;

    console.log(`[${request.id}] Delivered to Tampermonkey`);

    res.json({
        ok: true,
        request,
    });
});

// This request stays open until Tampermonkey returns the ChatGPT response.
app.post('/chat', (req, res) => {
    const { prompt } = req.body;

    if (typeof prompt !== 'string' || !prompt.trim()) {
        return res.status(400).json({
            ok: false,
            error: 'prompt must be a non-empty string',
        });
    }

    if (pendingRequest) {
        return res.status(409).json({
            ok: false,
            error: 'A request is already pending',
        });
    }

    const id = nextRequestId++;

    pendingRequest = {
        id,
        prompt,
    };

    console.log(`[${id}] Queued: ${prompt}`);

    // Store the HTTP response so /result can complete it later.
    waitingRequests.set(id, res);
});

// Tampermonkey posts the completed ChatGPT response here.
app.post('/result', (req, res) => {
    const { id, response, error } = req.body;

    if (!Number.isInteger(id)) {
        return res.status(400).json({
            ok: false,
            error: 'id must be an integer',
        });
    }

    const waitingResponse = waitingRequests.get(id);

    if (!waitingResponse) {
        return res.status(404).json({
            ok: false,
            error: `No waiting request found for ID ${id}`,
        });
    }

    waitingRequests.delete(id);

    if (typeof error === 'string') {
        console.error(`[${id}] Failed: ${error}`);

        waitingResponse.status(500).json({
            ok: false,
            error,
        });

        return res.json({
            ok: true,
        });
    }

    if (typeof response !== 'string') {
        return res.status(400).json({
            ok: false,
            error: 'response must be a string',
        });
    }

    console.log(
        `[${id}] Completed (${response.length} characters)`
    );

    waitingResponse.json({
        ok: true,
        response,
    });

    res.json({
        ok: true,
    });
});

app.listen(PORT, '127.0.0.1', () => {
    console.log(
        `ChatGPT bridge listening on http://127.0.0.1:${PORT}`
    );
});