/* =============================================================
   Virtual Piano
   - 4 octaves of sampled piano (Web Audio, with an <audio> fallback)
   - mouse / touch / computer-keyboard playing with a sustain pedal
   - every note played is engraved on a live grand staff
   ============================================================= */

(function () {
    'use strict';

    /* ---------------------------------------------------------------
       Musical constants
       --------------------------------------------------------------- */

    const CHROMATIC = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const WHITE_IN_OCTAVE = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
    const DIATONIC_INDEX = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
    const OCTAVES = 4;
    const WHITE_KEYS_TOTAL = OCTAVES * 7;

    /* The instrument is labelled "small, first, second, third" octave, i.e.
       octave 2 of this keyboard holds middle C. Scientific pitch is two higher. */
    const SCIENTIFIC_OFFSET = 2;

    /* Black keys are nudged off the white-key boundary the way they are on a
       real instrument: C# sits low in its pair, A# sits high in its triplet. */
    const BLACK_NUDGE = { 'C#': -0.1, 'D#': 0.1, 'F#': -0.13, 'G#': 0, 'A#': 0.13 };

    const ALL_NOTES = [];
    for (let octave = 1; octave <= OCTAVES; octave += 1) {
        CHROMATIC.forEach(function (name) {
            ALL_NOTES.push(name + octave);
        });
    }

    const DEMO_MELODY = [
        'E2', 'E2', 'F2', 'G2', 'G2', 'F2', 'E2', 'D2',
        'C2', 'C2', 'D2', 'E2', 'E2', 'D2', 'D2'
    ];

    /* Computer keyboard: two octaves laid out like a tracker keyboard.
       Values are semitones above the C of the current lower typing octave. */
    const TYPING_MAP = {
        KeyZ: 0, KeyS: 1, KeyX: 2, KeyD: 3, KeyC: 4, KeyV: 5, KeyG: 6,
        KeyB: 7, KeyH: 8, KeyN: 9, KeyJ: 10, KeyM: 11, Comma: 12,
        KeyQ: 12, Digit2: 13, KeyW: 14, Digit3: 15, KeyE: 16, KeyR: 17,
        Digit5: 18, KeyT: 19, Digit6: 20, KeyY: 21, Digit7: 22, KeyU: 23, KeyI: 24
    };
    const TYPING_GLYPH = {
        Comma: ',', Digit2: '2', Digit3: '3', Digit5: '5', Digit6: '6', Digit7: '7'
    };

    function prettyNote(note) {
        return note.replace('#', '\u266F');
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const coarsePointer = window.matchMedia('(pointer: coarse)');

    /* ---------------------------------------------------------------
       Audio engine
       --------------------------------------------------------------- */

    const Sampler = {
        ctx: null,
        master: null,
        buffers: new Map(),
        voices: new Map(),      // note -> array of ringing voices
        pedalled: [],           // voices held by the sustain pedal
        elements: new Map(),    // fallback <audio> elements
        volume: 0.8,
        pedal: false,
        sampled: false,

        fileFor: function (note) {
            return 'sounds/' + note.replace('#', 'd') + '.mp3';
        },

        context: function () {
            if (this.ctx) return this.ctx;
            const Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return null;
            this.ctx = new Ctor();
            this.master = this.ctx.createGain();
            this.master.gain.value = this.volume;
            this.master.connect(this.ctx.destination);
            return this.ctx;
        },

        unlock: function () {
            if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
        },

        setVolume: function (value) {
            this.volume = clamp(value, 0, 1);
            if (this.master) {
                this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.015);
            }
            this.elements.forEach(function (list) {
                list.forEach(function (el) { el.volume = Sampler.volume; });
            });
        },

        /* Fetch + decode every sample up front: the whole set is well under a
           megabyte, and pre-decoded buffers keep the keys latency-free. */
        preload: function (onProgress) {
            /* Opened straight off the disk there is no origin to fetch from, so
               skip decoding and let the <audio> fallback carry the sound. */
            const ctx = location.protocol === 'file:' ? null : this.context();
            if (!ctx) {
                onProgress(ALL_NOTES.length, ALL_NOTES.length);
                return Promise.resolve();
            }

            const queue = ALL_NOTES.slice();
            const total = queue.length;
            let done = 0;
            const self = this;

            function decode(data) {
                return new Promise(function (resolve, reject) {
                    const result = ctx.decodeAudioData(data, resolve, reject);
                    if (result && typeof result.then === 'function') result.then(resolve, reject);
                });
            }

            function worker() {
                const note = queue.shift();
                if (!note) return Promise.resolve();
                return fetch(self.fileFor(note))
                    .then(function (res) {
                        if (!res.ok) throw new Error(res.status);
                        return res.arrayBuffer();
                    })
                    .then(decode)
                    .then(function (buffer) { self.buffers.set(note, buffer); })
                    .catch(function () { /* this note falls back to <audio> */ })
                    .then(function () {
                        done += 1;
                        onProgress(done, total);
                        return worker();
                    });
            }

            const lanes = [];
            for (let i = 0; i < 6; i += 1) lanes.push(worker());
            return Promise.all(lanes).then(function () {
                self.sampled = self.buffers.size > 0;
            });
        },

        start: function (note) {
            this.unlock();
            const buffer = this.buffers.get(note);
            if (!buffer || !this.ctx) {
                this.startElement(note);
                return;
            }

            const now = this.ctx.currentTime;
            const source = this.ctx.createBufferSource();
            const gain = this.ctx.createGain();
            source.buffer = buffer;
            gain.gain.setValueAtTime(0.0001, now);
            gain.gain.exponentialRampToValueAtTime(1, now + 0.006);
            source.connect(gain);
            gain.connect(this.master);
            source.start(now);

            const voice = { source: source, gain: gain };
            source.onended = function () {
                try { gain.disconnect(); } catch (err) { /* already gone */ }
            };

            const ringing = this.voices.get(note) || [];
            ringing.push(voice);
            this.voices.set(note, ringing);
        },

        release: function (note) {
            const ringing = this.voices.get(note);
            this.voices.delete(note);
            if (!ringing) {
                this.releaseElement(note);
                return;
            }
            if (this.pedal) {
                this.pedalled = this.pedalled.concat(ringing);
                return;
            }
            const self = this;
            ringing.forEach(function (voice) { self.damp(voice, 0.38); });
            this.releaseElement(note);
        },

        damp: function (voice, seconds) {
            const now = this.ctx.currentTime;
            try {
                voice.gain.gain.cancelScheduledValues(now);
                voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
                voice.gain.gain.linearRampToValueAtTime(0.0001, now + seconds);
                voice.source.stop(now + seconds + 0.02);
            } catch (err) { /* voice already finished */ }
        },

        setPedal: function (down) {
            this.pedal = down;
            if (down) return;
            const self = this;
            const held = this.pedalled;
            this.pedalled = [];
            held.forEach(function (voice) { self.damp(voice, 0.5); });
        },

        /* --- fallback for browsers (or file:// pages) without decoded buffers --- */

        startElement: function (note) {
            const el = new window.Audio(this.fileFor(note));
            el.volume = this.volume;
            const list = this.elements.get(note) || [];
            list.push(el);
            this.elements.set(note, list);
            el.addEventListener('ended', function () {
                const current = Sampler.elements.get(note) || [];
                const index = current.indexOf(el);
                if (index > -1) current.splice(index, 1);
            });
            const played = el.play();
            if (played && typeof played.catch === 'function') played.catch(function () { });
        },

        releaseElement: function (note) {
            if (this.pedal) return;
            const list = this.elements.get(note);
            if (!list || !list.length) return;
            this.elements.set(note, []);
            list.forEach(function (el) {
                const step = el.volume / 8;
                const timer = window.setInterval(function () {
                    el.volume = Math.max(0, el.volume - step);
                    if (el.volume <= 0.01) {
                        window.clearInterval(timer);
                        el.pause();
                    }
                }, 35);
            });
        }
    };

    /* ---------------------------------------------------------------
       DOM references
       --------------------------------------------------------------- */

    const dom = {
        keyboard: document.getElementById('piano'),
        keybed: document.getElementById('keybed'),
        pianoShell: document.querySelector('.piano-shell'),
        octaveNav: document.getElementById('octaveNav'),
        readout: document.getElementById('noteReadout'),
        loadStatus: document.getElementById('loadStatus'),
        volume: document.getElementById('volume'),
        volumeOut: document.getElementById('volumeOut'),
        octaveValue: document.getElementById('octaveValue'),
        octaveUp: document.getElementById('octaveUp'),
        octaveDown: document.getElementById('octaveDown'),
        sustainToggle: document.getElementById('sustainToggle'),
        letterToggle: document.getElementById('letterToggle'),
        nameToggle: document.getElementById('nameToggle'),
        canvas: document.getElementById('staffCanvas'),
        clefCanvas: document.getElementById('clefCanvas'),
        sheetScroll: document.getElementById('sheetScroll'),
        sheetEmpty: document.getElementById('sheetEmpty'),
        noteCount: document.getElementById('noteCount'),
        playBtn: document.getElementById('playBtn'),
        demoBtn: document.getElementById('demoBtn'),
        undoBtn: document.getElementById('undoBtn'),
        clearBtn: document.getElementById('clearBtn'),
        helpBtn: document.getElementById('helpBtn'),
        helpDialog: document.getElementById('helpDialog'),
        toastStack: document.getElementById('toastStack')
    };

    const keyElements = new Map();   // note -> button
    let typingOctave = 1;
    let pedalHeld = false;
    let pedalLatched = false;

    /* ---------------------------------------------------------------
       Toasts
       --------------------------------------------------------------- */

    function toast(message) {
        const el = document.createElement('p');
        el.className = 'toast';
        el.textContent = message;
        dom.toastStack.appendChild(el);
        window.setTimeout(function () {
            el.classList.add('is-leaving');
            window.setTimeout(function () { el.remove(); }, 320);
        }, 2200);
    }

    /* ---------------------------------------------------------------
       Building the keyboard
       --------------------------------------------------------------- */

    function buildKeyboard() {
        const fragment = document.createDocumentFragment();
        const blacks = [];

        for (let octave = 1; octave <= OCTAVES; octave += 1) {
            WHITE_IN_OCTAVE.forEach(function (letter) {
                const note = letter + octave;
                fragment.appendChild(createKey(note, false));

                const sharp = letter + '#';
                if (CHROMATIC.indexOf(sharp) > -1) {
                    blacks.push(createKey(sharp + octave, true));
                }
            });
        }

        blacks.forEach(function (key) { fragment.appendChild(key); });
        dom.keyboard.appendChild(fragment);
        layoutKeyboard();
    }

    function createKey(note, isBlack) {
        const letter = note.slice(0, -1);
        const octave = note.slice(-1);
        const key = document.createElement('button');
        key.type = 'button';
        key.className = 'key ' + (isBlack ? 'black' : 'white');
        key.dataset.note = note;
        key.setAttribute('aria-label',
            letter.replace('#', ' sharp') + ', octave ' + octave);

        const glow = document.createElement('span');
        glow.className = 'key-glow';

        const labels = document.createElement('span');
        labels.className = 'key-labels';

        const hint = document.createElement('span');
        hint.className = 'key-letter';

        const name = document.createElement('span');
        name.className = 'key-name' + (letter === 'C' ? ' is-c' : '');
        name.textContent = isBlack ? prettyNote(letter) : note;

        labels.appendChild(hint);
        labels.appendChild(name);
        key.appendChild(glow);
        key.appendChild(labels);

        keyElements.set(note, key);
        return key;
    }

    /* Keys are sized to the available width so the whole instrument fits on a
       laptop, and stay thumb-sized on a phone, where the keyboard scrolls. */
    function layoutKeyboard() {
        const bed = window.getComputedStyle(dom.keybed);
        const padding = parseFloat(bed.paddingLeft) + parseFloat(bed.paddingRight);
        /* every white key carries a 1px gap, so take those out before dividing */
        const available = dom.keybed.clientWidth - padding - WHITE_KEYS_TOTAL;

        /* Show all four octaves when they still look like keys; otherwise keep
           them comfortably wide and let the keyboard scroll instead. */
        const ifItAllFits = Math.floor(available / WHITE_KEYS_TOTAL);
        const comfortable = coarsePointer.matches ? 44 : 40;
        const whiteWidth = ifItAllFits >= 30 ? Math.min(ifItAllFits, 46) : comfortable;
        const blackWidth = Math.round(whiteWidth * 0.62);
        const whiteHeight = clamp(Math.round(whiteWidth * 4.7), 150, 205);

        dom.keyboard.style.setProperty('--white-w', whiteWidth + 'px');
        dom.keyboard.style.setProperty('--black-w', blackWidth + 'px');
        dom.keyboard.style.setProperty('--white-h', whiteHeight + 'px');
        dom.keyboard.style.setProperty('--black-h', Math.round(whiteHeight * 0.62) + 'px');

        const pitch = whiteWidth + 1;
        let whiteIndex = 0;

        for (let octave = 1; octave <= OCTAVES; octave += 1) {
            WHITE_IN_OCTAVE.forEach(function (letter) {
                const sharp = letter + '#';
                const black = keyElements.get(sharp + octave);
                if (black) {
                    const nudge = (BLACK_NUDGE[sharp] || 0) * whiteWidth;
                    const left = (whiteIndex + 1) * pitch - blackWidth / 2 + nudge;
                    black.style.left = Math.round(left) + 'px';
                }
                whiteIndex += 1;
            });
        }
    }

    /* ---------------------------------------------------------------
       Playing a note
       --------------------------------------------------------------- */

    const pressed = new Set();

    function pressNote(note, options) {
        const settings = options || {};
        if (pressed.has(note)) return;
        if (!keyElements.has(note)) return;

        pressed.add(note);
        Sampler.start(note);

        const key = keyElements.get(note);
        key.classList.add('is-active');
        showReadout(note);
        if (!reducedMotion.matches) spark(key);

        if (settings.record !== false) {
            Score.add(note);
        }
    }

    function releaseNote(note) {
        if (!pressed.has(note)) return;
        pressed.delete(note);
        Sampler.release(note);
        const key = keyElements.get(note);
        if (key) key.classList.remove('is-active');
    }

    function flashNote(note, duration) {
        pressNote(note);
        window.setTimeout(function () { releaseNote(note); }, duration || 240);
    }

    function showReadout(note) {
        dom.readout.textContent = prettyNote(note);
        dom.readout.dataset.empty = 'false';
        dom.readout.classList.remove('is-hit');
        void dom.readout.offsetWidth;
        dom.readout.classList.add('is-hit');
    }

    function spark(key) {
        const box = key.getBoundingClientRect();
        const el = document.createElement('span');
        el.className = 'note-spark';
        el.textContent = Math.random() > 0.5 ? '\u266A' : '\u266B';
        el.style.left = (box.left + box.width / 2) + 'px';
        el.style.top = (box.top + 12) + 'px';
        el.style.setProperty('--drift', (Math.random() * 46 - 23).toFixed(0) + 'px');
        el.style.setProperty('--spin', (Math.random() * 40 - 20).toFixed(0) + 'deg');
        document.body.appendChild(el);
        el.addEventListener('animationend', function () { el.remove(); });
    }

    /* ---------------------------------------------------------------
       Pointer input
       --------------------------------------------------------------- */

    /* Each finger (or the mouse) is tracked on its own, so chords survive one
       finger lifting and a drag slides from key to key. */
    const pointerNotes = new Map();

    function keyAtPoint(x, y) {
        const element = document.elementFromPoint(x, y);
        return element && element.closest ? element.closest('.key') : null;
    }

    function releaseForPointer(pointerId) {
        const note = pointerNotes.get(pointerId);
        pointerNotes.delete(pointerId);
        if (!note) return;
        let heldByAnother = false;
        pointerNotes.forEach(function (other) {
            if (other === note) heldByAnother = true;
        });
        if (!heldByAnother) releaseNote(note);
    }

    function bindPointer() {
        dom.keyboard.addEventListener('pointerdown', function (event) {
            const key = event.target.closest('.key');
            if (!key) return;
            event.preventDefault();
            key.blur();
            if (dom.keyboard.setPointerCapture) {
                try { dom.keyboard.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
            }
            pointerNotes.set(event.pointerId, key.dataset.note);
            pressNote(key.dataset.note);
        });

        /* Glissando: sliding across the keys keeps sounding them. */
        dom.keyboard.addEventListener('pointermove', function (event) {
            if (!pointerNotes.has(event.pointerId)) return;
            const key = keyAtPoint(event.clientX, event.clientY);
            const note = key ? key.dataset.note : null;
            if (note === pointerNotes.get(event.pointerId)) return;
            releaseForPointer(event.pointerId);
            pointerNotes.set(event.pointerId, note);
            if (note) pressNote(note);
        });

        ['pointerup', 'pointercancel'].forEach(function (type) {
            window.addEventListener(type, function (event) {
                releaseForPointer(event.pointerId);
            });
        });

        /* Keys are real buttons, so keep Enter/Space working for screen readers. */
        dom.keyboard.addEventListener('keydown', function (event) {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            const key = event.target.closest('.key');
            if (!key) return;
            event.preventDefault();
            flashNote(key.dataset.note, 320);
        });
    }

    /* ---------------------------------------------------------------
       Octave navigator — how you reach the far octaves on a small screen
       --------------------------------------------------------------- */

    function octaveOffset(octave) {
        const key = keyElements.get('C' + octave);
        if (!key) return 0;
        return key.getBoundingClientRect().left - dom.keybed.getBoundingClientRect().left;
    }

    function scrollToOctave(octave, instant) {
        const target = dom.keybed.scrollLeft + octaveOffset(octave) - 12;
        dom.keybed.scrollTo({
            left: Math.max(0, target),
            behavior: instant || reducedMotion.matches ? 'auto' : 'smooth'
        });
    }

    function updateOctaveNav() {
        const overflow = dom.keybed.scrollWidth - dom.keybed.clientWidth;
        dom.pianoShell.classList.toggle('is-scrollable', overflow > 4);

        /* The octave on show is the first one whose C has not scrolled off the
           left edge; past the last C, it is the top octave. */
        let nearest = OCTAVES;
        let smallest = Infinity;
        for (let octave = 1; octave <= OCTAVES; octave += 1) {
            const offset = octaveOffset(octave);
            if (offset >= -4 && offset < smallest) {
                smallest = offset;
                nearest = octave;
            }
        }
        dom.octaveNav.querySelectorAll('.octave-chip').forEach(function (chip) {
            chip.setAttribute('aria-current', String(Number(chip.dataset.octave) === nearest));
        });
    }

    function bindOctaveNav() {
        dom.octaveNav.addEventListener('click', function (event) {
            const chip = event.target.closest('.octave-chip');
            if (!chip) return;
            scrollToOctave(Number(chip.dataset.octave));
        });

        let frame = null;
        dom.keybed.addEventListener('scroll', function () {
            if (frame) return;
            frame = window.requestAnimationFrame(function () {
                updateOctaveNav();
                frame = null;
            });
        }, { passive: true });

        updateOctaveNav();

        /* On a narrow screen, open on the middle of the instrument rather than
           the deepest bass octave. */
        if (dom.keybed.clientWidth < dom.keybed.scrollWidth * 0.6) {
            scrollToOctave(2, true);
            updateOctaveNav();
        }
    }

    /* ---------------------------------------------------------------
       Computer keyboard input
       --------------------------------------------------------------- */

    function noteForCode(code) {
        const semitone = TYPING_MAP[code];
        if (semitone === undefined) return null;
        const absolute = (typingOctave - 1) * 12 + semitone;
        if (absolute < 0 || absolute >= ALL_NOTES.length) return null;
        return ALL_NOTES[absolute];
    }

    function refreshKeyHints() {
        keyElements.forEach(function (key) {
            key.classList.remove('is-mapped');
            key.querySelector('.key-letter').textContent = '';
        });

        Object.keys(TYPING_MAP).forEach(function (code) {
            const note = noteForCode(code);
            if (!note) return;
            const key = keyElements.get(note);
            if (!key) return;
            const glyph = TYPING_GLYPH[code] || code.replace('Key', '');
            key.querySelector('.key-letter').textContent = glyph;
            key.classList.add('is-mapped');
        });

        dom.octaveValue.textContent = typingOctave + '\u2013' + (typingOctave + 1);
        dom.octaveDown.disabled = typingOctave <= 1;
        dom.octaveUp.disabled = typingOctave >= OCTAVES - 1;
    }

    function shiftOctave(delta) {
        const next = clamp(typingOctave + delta, 1, OCTAVES - 1);
        if (next === typingOctave) return;
        typingOctave = next;
        refreshKeyHints();
        toast('Typing range: octaves ' + typingOctave + ' and ' + (typingOctave + 1));
    }

    function setPedal(down) {
        if (down === pedalHeld) return;
        pedalHeld = down;
        Sampler.setPedal(down);
        dom.sustainToggle.setAttribute('aria-checked', String(down));
    }

    function bindTyping() {
        document.addEventListener('keydown', function (event) {
            if (event.metaKey || event.ctrlKey || event.altKey) return;
            const target = event.target;
            if (target && typeof target.closest === 'function' &&
                target.closest('input, textarea, select, [contenteditable]')) {
                return;
            }

            if (event.key === 'Shift' && !event.repeat) {
                setPedal(true);
                return;
            }
            if (event.key === 'ArrowLeft') { shiftOctave(-1); return; }
            if (event.key === 'ArrowRight') { shiftOctave(1); return; }
            if (event.key === 'Backspace') {
                event.preventDefault();
                Score.undo();
                return;
            }
            if (event.key === '?') {
                openGuide();
                return;
            }

            const note = noteForCode(event.code);
            if (!note) return;
            event.preventDefault();
            if (event.repeat) return;
            pressNote(note);
        });

        document.addEventListener('keyup', function (event) {
            if (event.key === 'Shift' && !pedalLatched) {
                setPedal(false);
                return;
            }
            const note = noteForCode(event.code);
            if (note) releaseNote(note);
        });

        window.addEventListener('blur', function () {
            pointerNotes.clear();
            Array.from(pressed).forEach(releaseNote);
            if (!pedalLatched) setPedal(false);
        });
    }

    /* ---------------------------------------------------------------
       Notation — a real grand staff engraved with the Bravura music font
       --------------------------------------------------------------- */

    const GLYPH = {
        trebleClef: '\uE050',
        bassClef: '\uE062',
        noteHead: '\uE0A4',
        sharp: '\uE262'
    };

    const Score = {
        notes: [],
        ctx: dom.canvas.getContext('2d'),
        clefCtx: dom.clefCanvas.getContext('2d'),
        smufl: false,
        popIndex: -1,
        popStart: 0,
        activeIndex: -1,
        metrics: null,

        /* Staff geometry derived from one staff space (`gap`). */
        measure: function () {
            const height = window.innerWidth < 760 ? 264 : 300;
            const gap = Math.round(height / 20);
            const step = gap / 2;
            /* The system sits a little above centre so the highest octave has
               room for its ledger lines without crowding the page. */
            const middleC = Math.round(height * 0.58);
            const firstNoteX = Math.round(gap * 8.6);
            const spacing = Math.round(gap * 3.4);
            return {
                height: height, gap: gap, step: step, middleC: middleC,
                firstNoteX: firstNoteX, spacing: spacing
            };
        },

        /* y position of a scientific diatonic step (C4 === 28). */
        y: function (diatonic) {
            return this.metrics.middleC - (diatonic - 28) * this.metrics.step;
        },

        diatonicOf: function (note) {
            const letter = note[0];
            const octave = Number(note.slice(-1)) + SCIENTIFIC_OFFSET;
            return octave * 7 + DIATONIC_INDEX[letter];
        },

        resize: function () {
            this.metrics = this.measure();
            const ratio = window.devicePixelRatio || 1;
            const visible = dom.sheetScroll.clientWidth;
            const needed = this.metrics.firstNoteX +
                this.notes.length * this.metrics.spacing + this.metrics.gap * 5;
            const width = Math.max(visible, needed, 640);

            dom.canvas.width = Math.round(width * ratio);
            dom.canvas.height = Math.round(this.metrics.height * ratio);
            dom.canvas.style.width = width + 'px';
            dom.canvas.style.height = this.metrics.height + 'px';
            this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
            this.width = width;

            this.clefWidth = this.metrics.firstNoteX - this.metrics.gap * 0.7;
            dom.clefCanvas.width = Math.round(this.clefWidth * ratio);
            dom.clefCanvas.height = dom.canvas.height;
            dom.clefCanvas.style.width = this.clefWidth + 'px';
            dom.clefCanvas.style.height = this.metrics.height + 'px';
            dom.clefCanvas.style.marginTop = '-' + this.metrics.height + 'px';
            this.clefCtx.setTransform(ratio, 0, 0, ratio, 0, 0);

            this.draw();
        },

        add: function (note) {
            this.notes.push(note);
            this.popIndex = this.notes.length - 1;
            this.popStart = performance.now();
            dom.noteCount.textContent = String(this.notes.length);
            dom.sheetEmpty.classList.add('is-hidden');
            this.describe();
            this.resize();
            this.scrollToEnd();
            if (!reducedMotion.matches) this.animatePop();
        },

        undo: function () {
            if (!this.notes.length) {
                toast('There is nothing to undo yet');
                return;
            }
            this.notes.pop();
            this.popIndex = -1;
            dom.noteCount.textContent = String(this.notes.length);
            if (!this.notes.length) dom.sheetEmpty.classList.remove('is-hidden');
            this.describe();
            this.resize();
        },

        clear: function () {
            if (!this.notes.length) return;
            this.notes = [];
            this.popIndex = -1;
            this.activeIndex = -1;
            dom.noteCount.textContent = '0';
            dom.sheetEmpty.classList.remove('is-hidden');
            this.describe();
            this.resize();
            dom.sheetScroll.scrollTo({ left: 0, behavior: 'smooth' });
        },

        describe: function () {
            dom.sheetScroll.setAttribute('aria-label', this.notes.length
                ? 'Musical staff with ' + this.notes.length + ' notes: ' +
                this.notes.map(prettyNote).join(', ')
                : 'Empty musical staff — play a key to write your first note');
        },

        scrollToEnd: function () {
            const x = this.metrics.firstNoteX + this.notes.length * this.metrics.spacing;
            const target = x - dom.sheetScroll.clientWidth + this.metrics.spacing * 2;
            if (target > dom.sheetScroll.scrollLeft) {
                dom.sheetScroll.scrollTo({
                    left: target,
                    behavior: reducedMotion.matches ? 'auto' : 'smooth'
                });
            }
        },

        animatePop: function () {
            if (this.popRaf) return;
            const self = this;
            const tick = function () {
                self.draw();
                if (performance.now() - self.popStart < 320) {
                    self.popRaf = window.requestAnimationFrame(tick);
                } else {
                    self.popRaf = null;
                    self.popIndex = -1;
                    self.draw();
                }
            };
            this.popRaf = window.requestAnimationFrame(tick);
        },

        font: function (spaces) {
            return (this.metrics.gap * spaces) + 'px Bravura, serif';
        },

        /* Staff edges, by scientific diatonic step. */
        edges: function () {
            return {
                trebleTop: this.y(38),    // F5
                trebleBottom: this.y(30), // E4
                bassTop: this.y(26),      // A3
                bassBottom: this.y(18)    // G2
            };
        },

        drawStaffLines: function (ctx, left, right) {
            const m = this.metrics;
            const e = this.edges();
            ctx.lineWidth = Math.max(1, m.gap * 0.08);
            [[e.trebleBottom, e.trebleTop], [e.bassBottom, e.bassTop]].forEach(function (pair) {
                for (let i = 0; i < 5; i += 1) {
                    const y = pair[0] - i * m.gap;
                    ctx.beginPath();
                    ctx.moveTo(left, y);
                    ctx.lineTo(right, y);
                    ctx.stroke();
                }
            });
        },

        inkUp: function (ctx) {
            ctx.fillStyle = '#231a10';
            ctx.strokeStyle = '#2c2116';
            ctx.lineCap = 'butt';
        },

        draw: function () {
            const ctx = this.ctx;
            const m = this.metrics;
            const e = this.edges();
            const left = Math.round(m.gap * 1.4);
            const right = this.width - m.gap * 2;

            ctx.clearRect(0, 0, this.width, m.height);
            this.inkUp(ctx);
            this.drawStaffLines(ctx, left, right);
            this.drawNotes();
            this.drawFinalBarline(ctx, right, e.trebleTop, e.bassBottom);
            this.drawClefPanel();
        },

        /* Redrawn on the pinned canvas that floats over the left edge. */
        drawClefPanel: function () {
            const ctx = this.clefCtx;
            const m = this.metrics;
            const e = this.edges();
            const left = Math.round(m.gap * 1.4);

            ctx.clearRect(0, 0, this.clefWidth, m.height);
            this.inkUp(ctx);
            this.drawStaffLines(ctx, left, this.clefWidth);
            this.drawBrace(ctx, left - m.gap * 0.75, e.trebleTop, e.bassBottom);

            // opening barline joining both staves
            ctx.lineWidth = Math.max(1.4, m.gap * 0.11);
            ctx.beginPath();
            ctx.moveTo(left, e.trebleTop);
            ctx.lineTo(left, e.bassBottom);
            ctx.stroke();

            this.drawClefs(ctx, left + m.gap * 0.9);
        },

        drawBrace: function (ctx, x, top, bottom) {
            const mid = (top + bottom) / 2;
            const w = this.metrics.gap * 0.9;
            ctx.save();
            ctx.lineWidth = Math.max(1.6, this.metrics.gap * 0.13);
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(x + w, top);
            ctx.bezierCurveTo(x - w * 0.2, top + (mid - top) * 0.35, x + w * 1.1, mid - (mid - top) * 0.2, x, mid);
            ctx.bezierCurveTo(x + w * 1.1, mid + (bottom - mid) * 0.2, x - w * 0.2, bottom - (bottom - mid) * 0.35, x + w, bottom);
            ctx.stroke();
            ctx.restore();
        },

        drawClefs: function (ctx, x) {
            if (this.smufl) {
                ctx.font = this.font(4);
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(GLYPH.trebleClef, x, this.y(32));  // baseline on the G line
                ctx.fillText(GLYPH.bassClef, x, this.y(24));    // baseline on the F line
                return;
            }
            // Fallback: the bundled treble-clef artwork, plus a Unicode bass clef.
            if (this.clefImage && this.clefImage.complete && this.clefImage.naturalWidth) {
                const h = this.metrics.gap * 6.4;
                ctx.save();
                ctx.globalCompositeOperation = 'multiply';
                ctx.drawImage(this.clefImage, x - this.metrics.gap * 0.6, this.y(38) - h * 0.18, h * 0.62, h);
                ctx.restore();
            }
            ctx.font = (this.metrics.gap * 3.4) + 'px serif';
            ctx.textBaseline = 'middle';
            ctx.fillText('\uD834\uDD22', x, this.y(25));
            ctx.textBaseline = 'alphabetic';
        },

        /* The system always closes with a double barline at the far right, the
           way a printed sheet does. */
        drawFinalBarline: function (ctx, right, top, bottom) {
            const m = this.metrics;
            const thick = Math.max(2.5, m.gap * 0.26);
            ctx.lineWidth = Math.max(1, m.gap * 0.08);
            ctx.beginPath();
            ctx.moveTo(right - m.gap * 0.55, top);
            ctx.lineTo(right - m.gap * 0.55, bottom);
            ctx.stroke();
            ctx.fillRect(right - thick, top, thick, bottom - top);
        },

        drawNotes: function () {
            const self = this;
            const m = this.metrics;
            this.notes.forEach(function (note, index) {
                const x = m.firstNoteX + index * m.spacing;
                let scale = 1;
                if (index === self.popIndex && !reducedMotion.matches) {
                    const t = clamp((performance.now() - self.popStart) / 320, 0, 1);
                    scale = 1 + 0.5 * Math.sin(Math.PI * t) * (1 - t * 0.4);
                }
                self.drawNote(note, x, index === self.activeIndex, scale);
            });
        },

        drawNote: function (note, x, isActive, scale) {
            const ctx = this.ctx;
            const m = this.metrics;
            const diatonic = this.diatonicOf(note);
            const y = this.y(diatonic);
            const onTreble = diatonic >= 28;
            const color = isActive ? '#b4472c' : '#231a10';

            ctx.save();
            ctx.fillStyle = color;
            ctx.strokeStyle = color;
            if (scale !== 1) {
                ctx.translate(x, y);
                ctx.scale(scale, scale);
                ctx.translate(-x, -y);
            }

            this.drawLedgerLines(diatonic, x, onTreble);

            const headWidth = this.smufl
                ? this.measureGlyph(GLYPH.noteHead)
                : m.gap * 1.22;

            if (note.indexOf('#') > -1) {
                if (this.smufl) {
                    ctx.font = this.font(4);
                    ctx.textBaseline = 'alphabetic';
                    const w = this.measureGlyph(GLYPH.sharp);
                    ctx.fillText(GLYPH.sharp, x - headWidth / 2 - w - m.gap * 0.18, y);
                } else {
                    ctx.font = (m.gap * 1.9) + 'px serif';
                    ctx.textBaseline = 'middle';
                    ctx.fillText('\u266F', x - headWidth / 2 - m.gap * 1.1, y);
                }
            }

            if (this.smufl) {
                ctx.font = this.font(4);
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(GLYPH.noteHead, x - headWidth / 2, y);
            } else {
                ctx.save();
                ctx.translate(x, y);
                ctx.rotate(-0.34);
                ctx.beginPath();
                ctx.ellipse(0, 0, m.gap * 0.62, m.gap * 0.46, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            // stem: up when the note sits below the middle line of its staff
            const middleLine = onTreble ? 34 : 22;
            const stemUp = diatonic < middleLine;
            const stemLength = m.gap * 3.4;
            const stemX = stemUp ? x + headWidth / 2 - m.gap * 0.06 : x - headWidth / 2 + m.gap * 0.06;
            ctx.lineWidth = Math.max(1.3, m.gap * 0.12);
            ctx.beginPath();
            ctx.moveTo(stemX, y + (stemUp ? -m.gap * 0.1 : m.gap * 0.1));
            ctx.lineTo(stemX, y + (stemUp ? -stemLength : stemLength));
            ctx.stroke();

            if (isActive) {
                ctx.globalAlpha = 0.18;
                ctx.beginPath();
                ctx.arc(x, y, m.gap * 1.5, 0, Math.PI * 2);
                ctx.fill();
            }

            ctx.restore();
        },

        drawLedgerLines: function (diatonic, x, onTreble) {
            const ctx = this.ctx;
            const m = this.metrics;
            const half = m.gap * 1.0;
            const topLine = onTreble ? 38 : 26;
            const bottomLine = onTreble ? 30 : 18;

            ctx.lineWidth = Math.max(1, m.gap * 0.09);
            for (let d = bottomLine - 2; d >= diatonic; d -= 2) {
                ctx.beginPath();
                ctx.moveTo(x - half, this.y(d));
                ctx.lineTo(x + half, this.y(d));
                ctx.stroke();
            }
            for (let d = topLine + 2; d <= diatonic; d += 2) {
                ctx.beginPath();
                ctx.moveTo(x - half, this.y(d));
                ctx.lineTo(x + half, this.y(d));
                ctx.stroke();
            }
        },

        measureGlyph: function (glyph) {
            this.ctx.font = this.font(4);
            return this.ctx.measureText(glyph).width;
        },

        highlight: function (index) {
            this.activeIndex = index;
            this.draw();
            if (index < 0) return;
            const x = this.metrics.firstNoteX + index * this.metrics.spacing;
            const view = dom.sheetScroll;
            if (x < view.scrollLeft + 60 || x > view.scrollLeft + view.clientWidth - 60) {
                view.scrollTo({
                    left: Math.max(0, x - view.clientWidth / 2),
                    behavior: reducedMotion.matches ? 'auto' : 'smooth'
                });
            }
        }
    };

    /* ---------------------------------------------------------------
       Playback
       --------------------------------------------------------------- */

    const Player = {
        timer: null,
        index: 0,
        queue: [],
        mode: null,

        isBusy: function () {
            return this.timer !== null;
        },

        play: function (notes, mode, options) {
            const settings = options || {};
            this.stop();
            if (!notes.length) {
                toast('Play a few notes first, then listen back');
                return;
            }
            this.queue = notes.slice();
            this.index = 0;
            this.mode = mode;
            const button = mode === 'demo' ? dom.demoBtn : dom.playBtn;
            button.classList.add('is-playing');

            const self = this;
            const stepTime = settings.tempo || 420;

            const step = function () {
                if (self.index >= self.queue.length) {
                    self.stop();
                    return;
                }
                const note = self.queue[self.index];
                if (settings.record) {
                    Score.add(note);
                    pressNote(note, { record: false });
                } else {
                    Score.highlight(self.index);
                    pressNote(note, { record: false });
                }
                window.setTimeout(function () { releaseNote(note); }, stepTime * 0.8);
                self.index += 1;
                self.timer = window.setTimeout(step, stepTime);
            };

            step();
        },

        stop: function () {
            if (this.timer) window.clearTimeout(this.timer);
            this.timer = null;
            dom.playBtn.classList.remove('is-playing');
            dom.demoBtn.classList.remove('is-playing');
            Array.from(pressed).forEach(releaseNote);
            if (Score.activeIndex > -1) Score.highlight(-1);
        }
    };

    /* ---------------------------------------------------------------
       Controls
       --------------------------------------------------------------- */

    function syncSlider(input) {
        input.style.setProperty('--fill', input.value + '%');
    }

    function setSwitch(button, on) {
        button.setAttribute('aria-checked', String(on));
    }

    function openGuide() {
        if (typeof dom.helpDialog.showModal === 'function') {
            if (!dom.helpDialog.open) dom.helpDialog.showModal();
        } else {
            dom.helpDialog.setAttribute('open', '');
        }
    }

    function bindControls() {
        dom.volume.addEventListener('input', function () {
            const value = Number(dom.volume.value);
            dom.volumeOut.textContent = String(value);
            syncSlider(dom.volume);
            Sampler.setVolume(value / 100);
        });
        syncSlider(dom.volume);

        dom.octaveUp.addEventListener('click', function () { shiftOctave(1); });
        dom.octaveDown.addEventListener('click', function () { shiftOctave(-1); });

        dom.sustainToggle.addEventListener('click', function () {
            pedalLatched = !pedalLatched;
            setPedal(pedalLatched);
            toast(pedalLatched ? 'Sustain pedal down' : 'Sustain pedal up');
        });

        dom.letterToggle.addEventListener('click', function () {
            const on = dom.letterToggle.getAttribute('aria-checked') !== 'true';
            setSwitch(dom.letterToggle, on);
            dom.keyboard.classList.toggle('hide-letters', !on);
        });

        dom.nameToggle.addEventListener('click', function () {
            const on = dom.nameToggle.getAttribute('aria-checked') !== 'true';
            setSwitch(dom.nameToggle, on);
            dom.keyboard.classList.toggle('hide-names', !on);
        });

        dom.playBtn.addEventListener('click', function () {
            if (Player.isBusy()) {
                Player.stop();
                return;
            }
            Sampler.unlock();
            Player.play(Score.notes, 'score');
        });

        dom.demoBtn.addEventListener('click', function () {
            if (Player.isBusy()) {
                Player.stop();
                return;
            }
            Sampler.unlock();
            Score.clear();
            Player.play(DEMO_MELODY, 'demo', { record: true, tempo: 480 });
        });

        dom.undoBtn.addEventListener('click', function () { Score.undo(); });

        dom.clearBtn.addEventListener('click', function () {
            Player.stop();
            if (!Score.notes.length) {
                toast('The staff is already empty');
                return;
            }
            Score.clear();
            toast('Staff cleared — ready for the next idea');
        });

        dom.helpBtn.addEventListener('click', openGuide);
    }

    /* ---------------------------------------------------------------
       Loading samples + page reveals
       --------------------------------------------------------------- */

    function loadSamples() {
        Sampler.preload(function (done, total) {
            if (done >= total) return;
            dom.loadStatus.textContent = 'Loading samples \u00b7 ' + done + '/' + total;
        }).then(function () {
            dom.loadStatus.textContent = '48 keys \u00b7 ready to play';
            dom.loadStatus.classList.add('is-ready');
            window.setTimeout(function () {
                dom.loadStatus.classList.add('is-faded');
            }, 2600);
        });
    }

    function bindReveals() {
        const sections = document.querySelectorAll('.reveal');
        if (!('IntersectionObserver' in window)) {
            sections.forEach(function (el) { el.classList.add('is-visible'); });
            return;
        }
        const observer = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
                if (!entry.isIntersecting) return;
                entry.target.classList.add('is-visible');
                observer.unobserve(entry.target);
            });
        }, { threshold: 0.12 });
        sections.forEach(function (el) { observer.observe(el); });
    }

    function bindResize() {
        let frame = null;
        window.addEventListener('resize', function () {
            if (frame) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(function () {
                layoutKeyboard();
                updateOctaveNav();
                Score.resize();
                frame = null;
            });
        });
    }

    /* Bravura gives us real engraved clefs and noteheads; if it cannot be
       loaded we fall back to the bundled clef artwork and drawn noteheads. */
    function loadMusicFont() {
        const done = function (ok) {
            Score.smufl = ok;
            if (!ok) {
                Score.clefImage = new Image();
                Score.clefImage.onload = function () { Score.draw(); };
                Score.clefImage.src = 'Key.jpg';
            }
            Score.resize();
        };

        if (!document.fonts || !document.fonts.load) {
            done(false);
            return;
        }
        document.fonts.load('64px Bravura', '\uE050')
            .then(function (faces) { done(faces.length > 0); })
            .catch(function () { done(false); });
    }

    /* ---------------------------------------------------------------
       Boot
       --------------------------------------------------------------- */

    function init() {
        buildKeyboard();
        refreshKeyHints();

        /* A touchscreen has no keys to hint at, so start with the note names
           only and hand the octave chips the job of moving around. */
        if (coarsePointer.matches) {
            dom.letterToggle.setAttribute('aria-checked', 'false');
            dom.keyboard.classList.add('hide-letters');
        }

        bindPointer();
        bindOctaveNav();
        bindTyping();
        bindControls();
        bindReveals();
        bindResize();
        Score.resize();
        loadMusicFont();
        loadSamples();

        const unlock = function () { Sampler.unlock(); };
        window.addEventListener('pointerdown', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
