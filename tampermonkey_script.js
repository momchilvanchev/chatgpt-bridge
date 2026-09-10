// ==UserScript==
// @name         LifeSQL ChatGPT Bridge
// @namespace    lifesql
// @version      0.3.1
// @description  Local bridge between LifeSQL and ChatGPT
// @match        https://chatgpt.com/*
// @connect      127.0.0.1
// @connect      localhost
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function () {
    'use strict';

    if (window.__lifesqlBridgeRunning) {
        console.log(
            '[LifeSQL Bridge] Already running; skipping duplicate instance.'
        );
        return;
    }

    window.__lifesqlBridgeRunning = true;

    const BRIDGE = 'http://127.0.0.1:8765';

    const POLL_INTERVAL = 500;
    const WAIT_INTERVAL = 100;

    const START_TIMEOUT = 30_000;
    const FINISH_TIMEOUT = 300_000;
    const COMPOSER_TIMEOUT = 10_000;

    console.log('[LifeSQL Bridge] Loaded');

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
            '[LifeSQL Bridge] Waiting for generation to start...'
        );

        await waitForSelector(
            '[data-testid="stop-button"]',
            START_TIMEOUT,
            'generation to start'
        );

        console.log(
            '[LifeSQL Bridge] Generation started.'
        );
    }

    async function waitForGenerationToFinish() {
        console.log(
            '[LifeSQL Bridge] Waiting for generation to finish...'
        );

        const start = Date.now();

        while (Date.now() - start < FINISH_TIMEOUT) {
            const stopButton = document.querySelector(
                '[data-testid="stop-button"]'
            );

            if (!stopButton) {
                console.log(
                    '[LifeSQL Bridge] Generation finished.'
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
            '[LifeSQL Bridge] Waiting for assistant response text...'
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

                /*
                 * ChatGPT may create the assistant message container before
                 * generation finishes and populate it afterward.
                 *
                 * Therefore we accept either:
                 *
                 * 1. a different assistant element, or
                 * 2. the same assistant element containing new text.
                 */

                if (
                    latest !== assistantBefore &&
                    text
                ) {
                    console.log(
                        '[LifeSQL Bridge] New assistant response is available.'
                    );

                    return text;
                }

                if (
                    latest === assistantBefore &&
                    text &&
                    text !== assistantTextBefore
                ) {
                    console.log(
                        '[LifeSQL Bridge] Existing assistant message was populated.'
                    );

                    return text;
                }
            }

            await sleep(WAIT_INTERVAL);
        }

        throw new Error(
            'Timed out waiting for assistant response text'
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
            '[LifeSQL Bridge] Assistant messages before send:',
            assistantsBefore.length
        );

        console.log(
            '[LifeSQL Bridge] Latest assistant text before send:',
            assistantTextBefore
        );

        console.log(
            '[LifeSQL Bridge] Inserting prompt...'
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

        if (editor.innerText !== prompt) {
            throw new Error(
                'Prompt insertion failed: composer text does not match'
            );
        }

        console.log(
            '[LifeSQL Bridge] Prompt inserted.'
        );

        const sendButton = await waitForSelector(
            'button[data-testid="send-button"]',
            COMPOSER_TIMEOUT,
            'send button'
        );

        console.log(
            '[LifeSQL Bridge] Clicking Send...'
        );

        sendButton.click();

        /*
         * Generation monitoring starts immediately after the click.
         *
         * First wait for the Stop button to appear so an idle ChatGPT
         * interface cannot be mistaken for a completed generation.
         *
         * Then wait for the Stop button to disappear.
         *
         * Finally, wait for a NEW assistant message containing actual
         * text. ChatGPT can remove the Stop button slightly before the
         * response text has been committed to the DOM.
         */

        await waitForGenerationToStart();

        await waitForGenerationToFinish();

        const response = await waitForAssistantResponse(
            assistantBefore,
            assistantTextBefore
        );

        console.log(
            '[LifeSQL Bridge] Assistant response received:'
        );

        console.log(response);

        return response;
    }

    async function handleRequest(requestData) {
        const { id, prompt } = requestData;

        console.log(
            `[LifeSQL Bridge] Processing request ${id}`
        );

        try {
            const response = await sendPrompt(prompt);

            console.log(
                `[LifeSQL Bridge] Sending result for request ${id}...`
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
                `[LifeSQL Bridge] Request ${id} completed.`
            );
        } catch (error) {
            console.error(
                `[LifeSQL Bridge] Request ${id} failed:`,
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
                    '[LifeSQL Bridge] Failed to report error:',
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
                    '[LifeSQL Bridge] Received request:',
                    data.request
                );

                await handleRequest(
                    data.request
                );

                processing = false;
            }
        } catch (error) {
            console.error(
                '[LifeSQL Bridge] Poll failed:',
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
                '[LifeSQL Bridge] Server response:',
                JSON.stringify(data)
            );

            poll();
        })
        .catch(error => {
            console.error(
                '[LifeSQL Bridge] Connection failed:',
                error
            );
        });
})();