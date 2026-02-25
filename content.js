// MultiMango Autofill — Content Script
// Injected on ai.joinhandshake.com pages
// Listens for autofill commands from the popup

(() => {
    'use strict';

    // ---- React-compatible value setters ----
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype, 'value'
    )?.set;

    const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype, 'value'
    )?.set;

    function setInputValue(el, value) {
        if (el.tagName === 'TEXTAREA') {
            nativeTextareaValueSetter?.call(el, value);
        } else {
            nativeInputValueSetter?.call(el, value);
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // ---- Helpers ----

    /**
     * Find the currently visible form card on the page.
     * The Handshake AI interface shows form cards fixed at the bottom.
     */
    function findFormCard() {
        // The form cards have a specific structure with rounded corners and shadow
        const cards = document.querySelectorAll('[tabindex="0"]');
        for (const card of cards) {
            // Look for cards that contain a label with a question
            const label = card.querySelector('label');
            if (label && card.querySelector('button[type="submit"]')) {
                return card;
            }
            // Or look for cards with just a "Continue" button
            const continueBtn = card.querySelector('button[aria-label="Continue"]');
            if (continueBtn) {
                return card;
            }
        }
        return null;
    }

    /**
     * Get the question text from a form card
     */
    function getQuestionText(card) {
        const label = card.querySelector('label');
        if (label) return label.textContent.trim();

        if (card.querySelector('button[aria-label="Continue"]')) {
            return 'CONTINUE_SCREEN';
        }

        return '';
    }

    /**
     * Click the submit button inside a form card
     */
    function clickSubmit(card) {
        const submitBtn = card.querySelector('button[type="submit"][aria-label="Submit"]');
        if (submitBtn && submitBtn.getAttribute('aria-disabled') !== 'true') {
            submitBtn.click();
            return true;
        }

        const continueBtn = card.querySelector('button[aria-label="Continue"]');
        if (continueBtn && continueBtn.getAttribute('aria-disabled') !== 'true') {
            continueBtn.click();
            return true;
        }

        return false;
    }

    /**
     * Wait for a condition to be true, polling every interval ms
     */
    function waitFor(condFn, timeoutMs = 8000, intervalMs = 300) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            const check = () => {
                const result = condFn();
                if (result) {
                    resolve(result);
                } else if (Date.now() - start > timeoutMs) {
                    reject(new Error('Timed out waiting for condition'));
                } else {
                    setTimeout(check, intervalMs);
                }
            };
            check();
        });
    }

    /**
     * Wait for the form card to change (new question appears)
     */
    function waitForNewQuestion(oldQuestion, timeoutMs = 8000) {
        return waitFor(() => {
            const card = findFormCard();
            if (!card) return false;
            const newQuestion = getQuestionText(card);
            if (newQuestion && newQuestion !== oldQuestion) {
                return card;
            }
            return false;
        }, timeoutMs);
    }

    // ---- Step Handlers ----

    /**
     * Detect the current step type based on question text
     */
    function detectStep(questionText) {
        if (questionText === 'CONTINUE_SCREEN') return 'continueScreen';

        const q = questionText.toLowerCase();

        if (q.includes('which task type did you complete')) return 'taskSelect';
        if (q.includes('please paste the full task type label') ||
            q.includes('please put') && q.includes('below')) return 'otherLabel';
        if (q.includes('current quality score average')) return 'qualityScore';
        if (q.includes('marked') && q.includes('excellent')) return 'excellent';
        if (q.includes('marked') && q.includes('good')) return 'good';
        if (q.includes('marked') && q.includes('fair')) return 'fair';
        if (q.includes('marked') && q.includes('bad')) return 'bad';

        return 'unknown';
    }

    /**
     * Handle task selection step — click the matching button
     */
    function handleTaskSelect(card, config) {
        const buttons = card.querySelectorAll('button[type="button"][aria-pressed]');
        const taskType = config.taskType;

        for (const btn of buttons) {
            const btnText = btn.textContent.trim();
            if (btnText === taskType) {
                btn.click();
                return { success: true, message: `Selected task: "${taskType}"` };
            }
        }

        // If exact match not found, try partial match
        for (const btn of buttons) {
            const btnText = btn.textContent.trim().toLowerCase();
            if (btnText.includes(taskType.toLowerCase()) ||
                taskType.toLowerCase().includes(btnText)) {
                btn.click();
                return { success: true, message: `Selected task (partial match): "${btn.textContent.trim()}"` };
            }
        }

        return { success: false, message: `Task type "${taskType}" not found on the page.` };
    }

    /**
     * Handle the "Other" label textarea step
     */
    function handleOtherLabel(card, config) {
        const textarea = card.querySelector('textarea');
        if (!textarea) {
            return { success: false, message: 'Textarea not found for "Other" label step.' };
        }

        const value = config.taskType === 'Other' ? config.otherLabel : 'X';
        setInputValue(textarea, value);
        return { success: true, message: `Filled textarea with "${value}"` };
    }

    /**
     * Handle number input steps (quality score, excellent, good, fair, bad)
     */
    function handleNumberInput(card, value, label) {
        const input = card.querySelector('input[type="number"]');
        if (!input) {
            return { success: false, message: `Number input not found for "${label}" step.` };
        }

        setInputValue(input, value);
        return { success: true, message: `Set ${label} to ${value}` };
    }

    /**
     * Process a single step: detect, fill, and optionally submit
     */
    async function processStep(card, config) {
        const question = getQuestionText(card);
        const step = detectStep(question);
        let result;

        switch (step) {
            case 'continueScreen':
                result = { success: true, message: 'On continue screen' };
                break;
            case 'taskSelect':
                result = handleTaskSelect(card, config);
                break;
            case 'otherLabel':
                result = handleOtherLabel(card, config);
                break;
            case 'qualityScore':
                result = handleNumberInput(card, config.qualityScore, 'Quality Score');
                break;
            case 'excellent':
                result = handleNumberInput(card, config.excellent, 'Excellent');
                break;
            case 'good':
                result = handleNumberInput(card, config.good, 'Good');
                break;
            case 'fair':
                result = handleNumberInput(card, config.fair, 'Fair');
                break;
            case 'bad':
                result = handleNumberInput(card, config.bad, 'Bad');
                break;
            default:
                result = { success: false, message: `Unknown step. Question: "${question.slice(0, 80)}..."` };
        }

        return { ...result, step, question };
    }

    // ---- Main autofill handler ----

    async function runAutofill(config) {
        const card = findFormCard();
        if (!card) {
            return { success: false, message: 'No form card found on the page. Make sure you are on a task step.' };
        }

        const result = await processStep(card, config);

        if (!result.success) {
            return result;
        }

        // Wait a moment for React to process the value change
        await new Promise(r => setTimeout(r, 300));

        // Try to submit
        const submitted = clickSubmit(card);

        if (!config.autoAdvance || !submitted) {
            return {
                success: true,
                message: result.message + (submitted ? ' → Submitted.' : ' (Submit button not ready — click manually.)')
            };
        }

        // Auto-advance: wait for next step and process it too
        const stepsCompleted = [result.message];
        let currentQuestion = getQuestionText(card);

        const MAX_STEPS = 8; // Safety limit
        for (let i = 0; i < MAX_STEPS; i++) {
            try {
                // Wait for the next form card to appear with a new question
                const newCard = await waitForNewQuestion(currentQuestion, 10000);
                const newResult = await processStep(newCard, config);
                stepsCompleted.push(newResult.message);

                if (!newResult.success) {
                    return {
                        success: false,
                        message: `Completed ${stepsCompleted.length - 1} step(s), then failed: ${newResult.message}`
                    };
                }

                // Wait for React to update
                await new Promise(r => setTimeout(r, 300));

                currentQuestion = getQuestionText(newCard);
                const didSubmit = clickSubmit(newCard);

                if (!didSubmit) {
                    return {
                        success: true,
                        message: `Completed ${stepsCompleted.length} step(s). Last step submit button not ready.`
                    };
                }

            } catch (e) {
                // Timeout waiting for next step — we're probably done
                return {
                    success: true,
                    message: `Completed ${stepsCompleted.length} step(s): ${stepsCompleted.join(' → ')}`
                };
            }
        }

        return {
            success: true,
            message: `Completed all ${stepsCompleted.length} steps: ${stepsCompleted.join(' → ')}`
        };
    }

    // ---- Message listener ----
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'autofill') {
            runAutofill(request.config)
                .then(result => sendResponse(result))
                .catch(err => sendResponse({
                    success: false,
                    message: `Error: ${err.message}`
                }));

            // Return true to indicate async response
            return true;
        }
    });

    console.log('[MultiMango Autofill] Content script loaded.');
})();
