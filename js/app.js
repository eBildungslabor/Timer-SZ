(function () {
    'use strict';

    // State
    let config = { persons: 0, rounds: 0, totalMinutes: 0, timePerSlot: 0 };
    let currentRound = 0;
    let currentPerson = 0;
    let timerInterval = null;
    let remainingSeconds = 0;
    let isRunning = false;
    let wakeLock = null;

    // DOM elements
    const setupScreen = document.getElementById('setup-screen');
    const timerScreen = document.getElementById('timer-screen');
    const endScreen = document.getElementById('end-screen');
    const personsGroup = document.getElementById('persons-group');
    const roundsGroup = document.getElementById('rounds-group');
    const minutesInput = document.getElementById('minutes');
    const calcPreview = document.getElementById('calculation-preview');
    const startBtn = document.getElementById('start-btn');
    const roundTabs = document.getElementById('round-tabs');
    const personTabs = document.getElementById('person-tabs');
    const timerDisplay = document.getElementById('timer-display');
    const timerLabel = document.getElementById('timer-label');
    const timerStartBtn = document.getElementById('timer-start-btn');
    const settingsBtn = document.getElementById('settings-btn');
    const restartBtn = document.getElementById('restart-btn');
    const progressFill = document.querySelector('.progress-ring-fill');

    // Circle circumference
    const CIRCUMFERENCE = 2 * Math.PI * 90; // r=90

    // Wake Lock
    async function requestWakeLock() {
        try {
            if ('wakeLock' in navigator) {
                wakeLock = await navigator.wakeLock.request('screen');
                wakeLock.addEventListener('release', () => { wakeLock = null; });
            }
        } catch (e) {
            // Wake Lock not supported or denied — no problem
        }
    }

    async function releaseWakeLock() {
        if (wakeLock) {
            try { await wakeLock.release(); } catch (e) {}
            wakeLock = null;
        }
    }

    // Re-acquire wake lock when page becomes visible again
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && timerScreen.classList.contains('active')) {
            requestWakeLock();
        }
    });

    // Audio: Gong via Web Audio API
    function playGong() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const t = ctx.currentTime;
            const duration = 5;

            // Singing bowl: multiple non-harmonic partials with slow decay and beating
            const partials = [
                { freq: 220,  gain: 0.35, decay: 4.5 },  // Grundton
                { freq: 221.5, gain: 0.25, decay: 4.0 }, // Leichte Schwebung zum Grundton
                { freq: 440,  gain: 0.20, decay: 3.5 },  // Oktave
                { freq: 441.8, gain: 0.12, decay: 3.2 },  // Schwebung zur Oktave
                { freq: 698,  gain: 0.10, decay: 2.8 },  // Typischer Klangschalen-Oberton
                { freq: 1047, gain: 0.06, decay: 2.0 },  // Hoher Oberton
                { freq: 1320, gain: 0.03, decay: 1.5 },  // Glanz
            ];

            // Soft reverb via delay
            const convGain = ctx.createGain();
            convGain.gain.setValueAtTime(0.15, t);
            const delay = ctx.createDelay(0.5);
            delay.delayTime.setValueAtTime(0.08, t);
            const feedbackGain = ctx.createGain();
            feedbackGain.gain.setValueAtTime(0.3, t);
            convGain.connect(delay);
            delay.connect(feedbackGain);
            feedbackGain.connect(delay);
            delay.connect(ctx.destination);

            partials.forEach(p => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(p.freq, t);

                // Quick attack, long exponential decay like a struck bowl
                gain.gain.setValueAtTime(0.001, t);
                gain.gain.linearRampToValueAtTime(p.gain, t + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.001, t + p.decay);

                osc.connect(gain);
                gain.connect(ctx.destination);
                gain.connect(convGain);
                osc.start(t);
                osc.stop(t + p.decay + 0.1);
            });

            // Initial strike transient — short noise burst
            const bufferSize = ctx.sampleRate * 0.03;
            const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
            const data = noiseBuffer.getChannelData(0);
            for (let i = 0; i < bufferSize; i++) {
                data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
            }
            const noise = ctx.createBufferSource();
            noise.buffer = noiseBuffer;
            const noiseGain = ctx.createGain();
            noiseGain.gain.setValueAtTime(0.12, t);
            noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
            const noiseFilter = ctx.createBiquadFilter();
            noiseFilter.type = 'bandpass';
            noiseFilter.frequency.setValueAtTime(800, t);
            noiseFilter.Q.setValueAtTime(1.5, t);
            noise.connect(noiseFilter);
            noiseFilter.connect(noiseGain);
            noiseGain.connect(ctx.destination);
            noise.start(t);
            noise.stop(t + 0.1);

            setTimeout(() => ctx.close(), (duration + 1) * 1000);
        } catch (e) {
            // Audio not supported
        }
    }

    // Setup: Button group selection
    function setupButtonGroup(group, callback) {
        group.addEventListener('click', (e) => {
            const btn = e.target.closest('button');
            if (!btn) return;
            group.querySelectorAll('button').forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            callback(parseInt(btn.dataset.value));
        });
    }

    setupButtonGroup(personsGroup, (val) => {
        config.persons = val;
        updatePreview();
    });

    setupButtonGroup(roundsGroup, (val) => {
        config.rounds = val;
        updatePreview();
    });

    minutesInput.addEventListener('input', () => {
        config.totalMinutes = parseInt(minutesInput.value) || 0;
        updatePreview();
    });

    // Initialize default
    config.totalMinutes = parseInt(minutesInput.value) || 0;

    function roundDownTo15(seconds) {
        return Math.floor(seconds / 15) * 15;
    }

    function formatTime(totalSeconds) {
        const min = Math.floor(totalSeconds / 60);
        const sec = totalSeconds % 60;
        return min + ':' + String(sec).padStart(2, '0');
    }

    function formatTimeLong(totalSeconds) {
        const min = Math.floor(totalSeconds / 60);
        const sec = totalSeconds % 60;
        let parts = [];
        if (min > 0) parts.push(min + (min === 1 ? ' Minute' : ' Minuten'));
        if (sec > 0) parts.push(sec + ' Sekunden');
        return parts.join(' ') || '0 Sekunden';
    }

    function updatePreview() {
        const valid = config.persons > 0 && config.rounds > 0 && config.totalMinutes > 0;
        startBtn.disabled = !valid;

        if (!valid) {
            calcPreview.textContent = '';
            return;
        }

        const totalSeconds = config.totalMinutes * 60;
        const slots = config.persons * config.rounds;
        const perSlot = roundDownTo15(totalSeconds / slots);

        if (perSlot < 15) {
            calcPreview.textContent = 'Zu wenig Zeit — mindestens 15 Sekunden pro Person nötig.';
            startBtn.disabled = true;
            return;
        }

        config.timePerSlot = perSlot;
        calcPreview.textContent = 'Redezeit pro Person: ' + formatTimeLong(perSlot);
    }

    // Start button
    startBtn.addEventListener('click', () => {
        if (startBtn.disabled) return;
        currentRound = 0;
        currentPerson = 0;
        showScreen(timerScreen);
        buildTabs();
        showSlot(0, 0);
        requestWakeLock();
    });

    // Screen management
    function showScreen(screen) {
        [setupScreen, timerScreen, endScreen].forEach(s => s.classList.remove('active'));
        screen.classList.add('active');
    }

    // Build navigation tabs
    function buildTabs() {
        roundTabs.innerHTML = '';
        personTabs.innerHTML = '';

        for (let r = 0; r < config.rounds; r++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tab-btn';
            btn.textContent = 'Runde ' + (r + 1);
            btn.dataset.round = r;
            btn.addEventListener('click', () => {
                if (isRunning) return;
                showSlot(r, 0);
            });
            roundTabs.appendChild(btn);
        }

        for (let p = 0; p < config.persons; p++) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'tab-btn';
            btn.textContent = (p + 1) + '. Person';
            btn.dataset.person = p;
            btn.addEventListener('click', () => {
                if (isRunning) return;
                showSlot(currentRound, p);
            });
            personTabs.appendChild(btn);
        }
    }

    // Track completed slots
    const completedSlots = new Set();

    function slotKey(r, p) {
        return r + '-' + p;
    }

    function showSlot(round, person) {
        stopTimer();
        currentRound = round;
        currentPerson = person;
        remainingSeconds = config.timePerSlot;

        // Update tabs
        roundTabs.querySelectorAll('.tab-btn').forEach(btn => {
            const r = parseInt(btn.dataset.round);
            btn.classList.toggle('active', r === round);
        });

        personTabs.querySelectorAll('.tab-btn').forEach(btn => {
            const p = parseInt(btn.dataset.person);
            btn.classList.toggle('active', p === person);
            btn.classList.toggle('done', completedSlots.has(slotKey(round, p)) && !(round === currentRound && p === person));
        });

        // Update display
        timerDisplay.textContent = formatTime(remainingSeconds);
        timerDisplay.classList.remove('running', 'warning');
        timerLabel.textContent = 'Redezeit ' + (person + 1) + '. Person (Runde ' + (round + 1) + ')';
        timerStartBtn.textContent = 'Start';
        timerStartBtn.classList.remove('running');

        // Reset progress
        setProgress(0);
        progressFill.classList.remove('warning');
    }

    function setProgress(fraction) {
        const offset = CIRCUMFERENCE * (1 - fraction);
        progressFill.style.strokeDashoffset = offset;
    }

    // Timer controls
    timerStartBtn.addEventListener('click', () => {
        if (isRunning) {
            pauseTimer();
        } else {
            startTimer();
        }
    });

    function startTimer() {
        if (remainingSeconds <= 0) return;
        isRunning = true;
        timerStartBtn.textContent = 'Pause';
        timerStartBtn.classList.add('running');
        timerDisplay.classList.add('running');

        const totalTime = config.timePerSlot;
        let lastTick = Date.now();

        timerInterval = setInterval(() => {
            const now = Date.now();
            const elapsed = now - lastTick;

            if (elapsed >= 1000) {
                lastTick += 1000;
                remainingSeconds--;

                timerDisplay.textContent = formatTime(remainingSeconds);

                const progress = 1 - (remainingSeconds / totalTime);
                setProgress(progress);

                // Warning at last 10 seconds
                if (remainingSeconds <= 10 && remainingSeconds > 0) {
                    timerDisplay.classList.add('warning');
                    progressFill.classList.add('warning');
                }

                if (remainingSeconds <= 0) {
                    timerFinished();
                }
            }
        }, 100);
    }

    function pauseTimer() {
        isRunning = false;
        clearInterval(timerInterval);
        timerInterval = null;
        timerStartBtn.textContent = 'Weiter';
        timerStartBtn.classList.remove('running');
        timerDisplay.classList.remove('running');
    }

    function stopTimer() {
        isRunning = false;
        if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
        }
    }

    function timerFinished() {
        stopTimer();
        playGong();

        completedSlots.add(slotKey(currentRound, currentPerson));

        // Mark current person tab as done
        personTabs.querySelectorAll('.tab-btn').forEach(btn => {
            const p = parseInt(btn.dataset.person);
            if (p === currentPerson) btn.classList.add('done');
        });

        timerDisplay.textContent = '0:00';
        timerDisplay.classList.remove('running');
        timerDisplay.classList.add('warning');
        setProgress(1);

        // Determine next slot
        let nextPerson = currentPerson + 1;
        let nextRound = currentRound;

        if (nextPerson >= config.persons) {
            nextPerson = 0;
            nextRound++;
        }

        if (nextRound >= config.rounds) {
            // All done
            setTimeout(() => {
                releaseWakeLock();
                showScreen(endScreen);
                completedSlots.clear();
            }, 1500);
        } else {
            // Show next slot after a brief pause
            setTimeout(() => {
                showSlot(nextRound, nextPerson);
            }, 1500);
        }
    }

    // Settings button — back to setup
    settingsBtn.addEventListener('click', () => {
        stopTimer();
        releaseWakeLock();
        completedSlots.clear();
        showScreen(setupScreen);
    });

    // Restart button
    restartBtn.addEventListener('click', () => {
        completedSlots.clear();
        showScreen(setupScreen);
    });

})();
