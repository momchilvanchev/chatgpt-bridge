// ==UserScript==
// @name         ChatGPT Bridge
// @namespace    chatgpt_bridge
// @version      0.3.3
// @description  Exposes the ChatGPT web interface as a simple curl API
// @match        https://chatgpt.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    if (window.__lifesqlBridgeRunning) {
        console.log(
            '[ChatGPT Bridge] Already running; skipping duplicate instance.'
        );
        return;
    }

    window.__lifesqlBridgeRunning = true;

    const BRIDGE = 'http://127.0.0.1:8765';

    const POLL_INTERVAL = 500;
    const WAIT_INTERVAL = 100;

    const START_TIMEOUT = 60_000;
    const FINISH_TIMEOUT = 300_000;
    const COMPOSER_TIMEOUT = 30_000;

    console.log('[ChatGPT Bridge] Loaded');

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function request(method, path, body = undefined) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: `${BRIDGE}${path}`,

                headers: {
                    'Content-Type': 'application/json',
                },

                data: body === undefined
                    ? undefined
                    : JSON.stringify(body),

                onload(response) {
                    if (response.status < 200 || response.status >= 300) {
                        reject(
                            new Error(
                                `HTTP ${response.status}: ${response.responseText}`
                            )
                        );

                        return;
                    }

                    try {
                        resolve(JSON.parse(response.responseText));
                    } catch (error) {
                        reject(
                            new Error(
                                `Invalid JSON response: ${error.message}`
                            )
                        );
                    }
                },

                onerror() {
                    reject(
                        new Error('Bridge request failed')
                    );
                },
            });
        });
    }

    async function waitForSelector(
        selector,
        timeout,
        description
    ) {
        const start = Date.now();

        while (Date.now() - start < timeout) {
            const element = document.querySelector(selector);

            if (element) {
                return element;
            }

            await sleep(WAIT_INTERVAL);
        }

        throw new Error(
            `Timed out waiting for ${description || selector
            }`
        );
    }

    async function waitForGenerationToStart() {
        console.log(
            '[ChatGPT Bridge] Waiting for generation to start...'
        );

        await waitForSelector(
            '[data-testid="stop-button"]',
            START_TIMEOUT,
            'generation to start'
        );

        console.log(
            '[ChatGPT Bridge] Generation started.'
        );
    }

    async function waitForGenerationToFinish() {
        console.log(
            '[ChatGPT Bridge] Waiting for generation to finish...'
        );

        const start = Date.now();

        while (Date.now() - start < FINISH_TIMEOUT) {
            const stopButton = document.querySelector(
                'button[data-testid="stop-button"][aria-label="Stop answering"]'
            );

            if (!stopButton) {
                console.log(
                    '[ChatGPT Bridge] Generation finished.'
                );

                return;
            }

            await sleep(WAIT_INTERVAL);
        }

        throw new Error(
            'Timed out waiting for generation to finish'
        );
    }

    async function waitForAssistantResponse(
        assistantBefore,
        assistantTextBefore
    ) {
        console.log(
            '[ChatGPT Bridge] Waiting for final assistant response...'
        );

        const start = Date.now();

        while (Date.now() - start < FINISH_TIMEOUT) {
            const assistants = [
                ...document.querySelectorAll(
                    '[data-message-author-role="assistant"]'
                ),
            ];

            const latest = assistants.at(-1);

            if (latest) {
                const text = latest.innerText?.trim() || '';

                const isNewAssistant =
                    latest !== assistantBefore;

                const isChangedExistingAssistant =
                    latest === assistantBefore &&
                    text !== assistantTextBefore;

                if (
                    text &&
                    (isNewAssistant || isChangedExistingAssistant)
                ) {
                    console.log(
                        '[ChatGPT Bridge] Final assistant response found.'
                    );

                    return text;
                }
            }

            await sleep(WAIT_INTERVAL);
        }

        throw new Error(
            'Timed out waiting for assistant response'
        );
    }

    async function sendPrompt(prompt) {
        const editor = await waitForSelector(
            '#prompt-textarea[contenteditable="true"]',
            COMPOSER_TIMEOUT,
            'ChatGPT composer'
        );

        const assistantsBefore = [
            ...document.querySelectorAll(
                '[data-message-author-role="assistant"]'
            ),
        ];

        const assistantBefore = assistantsBefore.at(-1);
        const assistantTextBefore =
            assistantBefore?.innerText?.trim() || '';

        console.log(
            '[ChatGPT Bridge] Assistant messages before send:',
            assistantsBefore.length
        );

        console.log(
            '[ChatGPT Bridge] Latest assistant text before send:',
            assistantTextBefore
        );

        console.log(
            '[ChatGPT Bridge] Inserting prompt...'
        );

        editor.focus();

        document.execCommand(
            'selectAll',
            false
        );

        document.execCommand(
            'insertText',
            false,
            prompt
        );
        // COMMENTED OUT BECAUSE IT'S CAUSING PROBLEMS - MINOR FORMATTING CHANGES IN THE UI CAUSE IT TO NOT MATCH
        // if (editor.innerText !== prompt) {
        //     throw new Error(
        //         'Prompt insertion failed: composer text does not match'
        //     );
        // } 


        console.log(
            '[ChatGPT Bridge] Prompt inserted.'
        );

        const sendButton = await waitForSelector(
            'button[data-testid="send-button"]',
            COMPOSER_TIMEOUT,
            'send button'
        );

        console.log(
            '[ChatGPT Bridge] Clicking Send...'
        );

        sendButton.click();

        await waitForGenerationToStart();

        await waitForGenerationToFinish();

        const response = await waitForAssistantResponse(
            assistantBefore,
            assistantTextBefore
        );

        console.log(
            '[ChatGPT Bridge] Assistant response received:'
        );

        console.log(response);

        return response;
    }

    async function handleRequest(requestData) {
        const { id, prompt } = requestData;

        console.log(
            `[ChatGPT Bridge] Processing request ${id}`
        );

        try {
            const response = await sendPrompt(prompt);

            console.log(
                `[ChatGPT Bridge] Sending result for request ${id}...`
            );

            await request(
                'POST',
                '/result',
                {
                    id,
                    response,
                }
            );

            console.log(
                `[ChatGPT Bridge] Request ${id} completed.`
            );
        } catch (error) {
            console.error(
                `[ChatGPT Bridge] Request ${id} failed:`,
                error
            );

            try {
                await request(
                    'POST',
                    '/result',
                    {
                        id,
                        error: error instanceof Error
                            ? error.message
                            : String(error),
                    }
                );
            } catch (reportError) {
                console.error(
                    '[ChatGPT Bridge] Failed to report error:',
                    reportError
                );
            }
        }
    }

    let processing = false;

    async function poll() {
        if (processing) {
            setTimeout(
                poll,
                POLL_INTERVAL
            );

            return;
        }

        try {
            const data = await request(
                'GET',
                '/next'
            );

            if (data.request) {
                processing = true;

                console.log(
                    '[ChatGPT Bridge] Received request:',
                    data.request
                );

                await handleRequest(
                    data.request
                );

                processing = false;
            }
        } catch (error) {
            console.error(
                '[ChatGPT Bridge] Poll failed:',
                error
            );
        }

        setTimeout(
            poll,
            POLL_INTERVAL
        );
    }

    request('GET', '/health')
        .then(data => {
            console.log(
                '[ChatGPT Bridge] Server response:',
                JSON.stringify(data)
            );

            poll();
        })
        .catch(error => {
            console.error(
                '[ChatGPT Bridge] Connection failed:',
                error
            );
        });
})();