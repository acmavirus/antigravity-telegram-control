(function () {
    // --- Guard: prevent double execution (workbench.js + HTML script tag) ---
    if (window._agAutoLoaded) return;
    window._agAutoLoaded = true;

    // --- Dọn dẹp bản cũ ---
    if (window._agToolIntervals) {
        window._agToolIntervals.forEach(clearInterval);
        if (window._agScrollListener) {
            window.removeEventListener('scroll', window._agScrollListener, true);
        }
    }
    window._agToolIntervals = [];

    // --- Auto-dismiss "corrupt installation" notification ---
    (function suppressCorruptBanner() {
        function dismissCorrupt() {
            var banners = document.querySelectorAll('.notifications-toasts .notification-toast, .notification-list-item');
            banners.forEach(function (b) {
                var text = b.textContent || '';
                if (text.indexOf('corrupt') !== -1 || text.indexOf('reinstall') !== -1) {
                    var closeBtn = b.querySelector('.codicon-notifications-clear, .codicon-close, .action-label[aria-label*="Close"], .action-label[aria-label*="clear"], .clear-notification-action');
                    if (closeBtn) {
                        closeBtn.click();
                        console.log('[AG Auto] 🧹 Dismissed corrupt notification');
                    } else {
                        b.style.display = 'none';
                        console.log('[AG Auto] 🧹 Hidden corrupt notification');
                    }
                }
            });
        }
        dismissCorrupt();
        var attempts = 0;
        var timer = setInterval(function () {
            dismissCorrupt();
            if (++attempts > 30) clearInterval(timer);
        }, 1000);
        try {
            var observer = new MutationObserver(function () { dismissCorrupt(); });
            var target = document.body || document.documentElement;
            observer.observe(target, { childList: true, subtree: true });
            setTimeout(function () { observer.disconnect(); }, 30000);
        } catch (e) { }
    })();

    var PAUSE_SCROLL_MS = /*{{PAUSE_SCROLL_MS}}*/7000;
    var SCROLL_INTERVAL_MS = /*{{SCROLL_INTERVAL_MS}}*/500;
    var CLICK_INTERVAL_MS = /*{{CLICK_INTERVAL_MS}}*/1000;
    var CLICK_PATTERNS = /*{{CLICK_PATTERNS}}*/["Allow", "Always Allow", "Run", "Keep Waiting", "Accept all"];
    window._agAcceptChatOnly = false;

    // Live ON/OFF flags — exposed on window
    window._agAutoEnabled = /*{{ENABLED}}*/true;
    window._agScrollEnabled = /*{{SCROLL_ENABLED}}*/true;

    // --- ON/OFF polling via HTTP server (dynamic port discovery) ---
    var AG_HTTP_PORT_START = 48787;
    var AG_HTTP_PORT_END = 48850;
    var AG_HTTP_PORT = 0; // Will be discovered dynamically
    var _agPollCount = 0;
    var _agPollErrors = 0;
    var _agPortScanning = false;
    // Track ONLY this session's clicks (delta since last send)
    var _agSessionStats = {};
    var _agSessionTotal = 0;

    // --- Port Discovery: scan range to find our server ---
    function _agDiscoverPort(callback) {
        if (_agPortScanning) return;
        _agPortScanning = true;
        var found = false;
        var pending = 0;
        var startPort = AG_HTTP_PORT_START;
        // Try ports in batches of 8 to avoid too many simultaneous XHRs
        function tryBatch(from) {
            if (from > AG_HTTP_PORT_END || found) {
                if (!found) {
                    _agPortScanning = false;
                    console.log('[AG Auto] Port scan: no server found in range ' + AG_HTTP_PORT_START + '-' + AG_HTTP_PORT_END);
                }
                return;
            }
            var batchEnd = Math.min(from + 7, AG_HTTP_PORT_END);
            pending = 0;
            for (var p = from; p <= batchEnd; p++) {
                (function (port) {
                    pending++;
                    var xhr = new XMLHttpRequest();
                    xhr.open('GET', 'http://127.0.0.1:' + port + '/ag-status?t=' + Date.now(), true);
                    xhr.timeout = 800;
                    xhr.onload = function () {
                        if (found) return;
                        if (xhr.status === 200) {
                            try {
                                var cfg = JSON.parse(xhr.responseText);
                                if (typeof cfg.enabled === 'boolean') {
                                    found = true;
                                    AG_HTTP_PORT = port;
                                    _agPortScanning = false;
                                    console.log('[AG Auto] ✅ Discovered server on port ' + port);
                                    if (callback) callback(port, cfg);
                                }
                            } catch (_e) { }
                        }
                        pending--;
                        if (pending <= 0 && !found) tryBatch(batchEnd + 1);
                    };
                    xhr.onerror = function () { pending--; if (pending <= 0 && !found) tryBatch(batchEnd + 1); };
                    xhr.ontimeout = function () { pending--; if (pending <= 0 && !found) tryBatch(batchEnd + 1); };
                    xhr.send();
                })(p);
            }
        }
        tryBatch(startPort);
    }

    function _agApplyConfig(cfg) {
        if (typeof cfg.enabled === 'boolean') {
            if (window._agAutoEnabled !== cfg.enabled) {
                console.log('[AG Auto] AutoAccept: ' + (cfg.enabled ? '✅ ON' : '❌ OFF') + ' (live toggle)');
            }
            window._agAutoEnabled = cfg.enabled;
        }
        if (typeof cfg.scrollEnabled === 'boolean') {
            if (window._agScrollEnabled !== cfg.scrollEnabled) {
                console.log('[AG Auto] SmartScroll: ' + (cfg.scrollEnabled ? '✅ ON' : '❌ OFF') + ' (live toggle)');
            }
            window._agScrollEnabled = cfg.scrollEnabled;
        }
        if (typeof cfg.scrollPauseMs === 'number') PAUSE_SCROLL_MS = cfg.scrollPauseMs;
        if (typeof cfg.scrollIntervalMs === 'number') SCROLL_INTERVAL_MS = cfg.scrollIntervalMs;
        if (cfg.clickPatterns && Array.isArray(cfg.clickPatterns)) {
            CLICK_PATTERNS = cfg.clickPatterns.filter(function (p) { return p !== 'Accept'; });
        }
        if (typeof cfg.acceptInChatOnly === 'boolean') window._agAcceptChatOnly = cfg.acceptInChatOnly;
        if (cfg.clickIntervalMs) CLICK_INTERVAL_MS = cfg.clickIntervalMs;
        if (cfg.clickStats) window._agClickStats = cfg.clickStats;
        if (typeof cfg.totalClicks === 'number') window._agTotalClicks = cfg.totalClicks;
        if (cfg.resetStats) {
            window._agClickStats = {};
            window._agTotalClicks = 0;
            _agSessionStats = {};
            _agSessionTotal = 0;
            console.log('[AG Auto] 🔄 Stats reset by user');
        }
    }

    // Initial port discovery
    _agDiscoverPort(function (port, cfg) {
        _agApplyConfig(cfg);
        _agPollErrors = 0;
    });

    var _agConfigReload = setInterval(function () {
        _agPollCount++;
        // If port not discovered yet, re-scan every 5 polls
        if (AG_HTTP_PORT === 0) {
            if (_agPollCount % 5 === 0) _agDiscoverPort(function (port, cfg) { _agApplyConfig(cfg); _agPollErrors = 0; });
            return;
        }
        // If too many errors, try to re-discover port (server may have restarted on new port)
        if (_agPollErrors > 3) {
            AG_HTTP_PORT = 0;
            _agPollErrors = 0;
            _agDiscoverPort(function (port, cfg) { _agApplyConfig(cfg); });
            return;
        }
        try {
            var xhr = new XMLHttpRequest();
            var statsParam = '';
            if (_agSessionTotal > 0) {
                statsParam = '&total=' + _agSessionTotal + '&stats=' + encodeURIComponent(JSON.stringify(_agSessionStats));
                _agSessionStats = {};
                _agSessionTotal = 0;
            }
            xhr.open('GET', 'http://127.0.0.1:' + AG_HTTP_PORT + '/ag-status?t=' + Date.now() + statsParam, true);
            xhr.timeout = 1500;
            xhr.onload = function () {
                if (xhr.status === 200) {
                    _agPollErrors = 0;
                    var cfg = JSON.parse(xhr.responseText);
                    _agApplyConfig(cfg);
                    if (_agPollCount <= 2) console.log('[AG Auto] HTTP Poll #' + _agPollCount + ' OK on port ' + AG_HTTP_PORT + ', enabled=' + window._agAutoEnabled + ', patterns=' + CLICK_PATTERNS.length);
                }
            };
            xhr.onerror = function () { _agPollErrors++; };
            xhr.ontimeout = function () { _agPollErrors++; };
            xhr.send();
        } catch (e) {
            _agPollErrors++;
            if (_agPollCount <= 3) console.log('[AG Auto] HTTP Poll #' + _agPollCount + ' error:', e.message);
        }
    }, 2000);
    window._agToolIntervals.push(_agConfigReload);

    // =================================================================
    // Only click APPROVAL buttons (NOT random UI buttons)
    // =================================================================
    var REJECT_WORDS = ['Reject', 'Deny', 'Cancel', 'Dismiss', 'Don\'t Allow', 'Decline', 'hủy', 'từ chối'];

    function isApprovalButton(btn) {
        var parent = btn.parentElement;
        if (!parent) return false;
        for (var level = 0; level < 3; level++) {
            if (!parent) break;
            var siblingBtns = parent.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background');
            for (var i = 0; i < siblingBtns.length; i++) {
                var sib = siblingBtns[i];
                if (sib === btn) continue;
                var sibText = (sib.innerText || '').trim().toLowerCase();
                for (var j = 0; j < REJECT_WORDS.length; j++) {
                    if (sibText === REJECT_WORDS[j] || sibText.indexOf(REJECT_WORDS[j]) === 0) {
                        return true;
                    }
                }
            }
            parent = parent.parentElement;
        }
        return false;
    }

    // Words in buttons that should NEVER be auto-clicked (editor/diff UI buttons)
    var EDITOR_SKIP_WORDS = ['Accept Changes', 'Accept All', 'Accept Incoming', 'Accept Current', 'Accept Both', 'Accept Combination'];

    var _clicked = new WeakSet();

    // --- Click Stats tracking ---
    if (!window._agClickStats) window._agClickStats = {};
    if (!window._agTotalClicks) window._agTotalClicks = 0;

    // --- Helper to traverse DOM and shadow roots recursively ---
    function getAllRoots(root) {
        var roots = [root];
        try {
            var iframes = root.querySelectorAll('iframe, frame');
            for (var i = 0; i < iframes.length; i++) {
                try {
                    var doc = iframes[i].contentDocument || iframes[i].contentWindow.document;
                    if (doc) roots.push.apply(roots, getAllRoots(doc));
                } catch (e) { }
            }
            var allElements = root.querySelectorAll('*');
            for (var j = 0; j < allElements.length; j++) {
                if (allElements[j].shadowRoot) {
                    roots.push.apply(roots, getAllRoots(allElements[j].shadowRoot));
                }
            }
        } catch (e) { }
        return roots;
    }

    // --- 1. AUTO CLICK ---
    var autoClick = setInterval(function () {
        if (!window._agAutoEnabled) return;

        var roots = getAllRoots(document);
        var clickables = [];
        roots.forEach(function (r) {
            var elms = r.querySelectorAll('button, a.action-label, [role="button"], .monaco-button, span.bg-ide-button-background, span.cursor-pointer');
            for (var i = 0; i < elms.length; i++) {
                if (elms[i].offsetParent !== null) {
                    clickables.push(elms[i]);
                }
            }
        });

        var targetBtn = null;
        var matchedPattern = '';
        for (var i = 0; i < clickables.length; i++) {
            var b = clickables[i];
            if (_clicked.has(b)) continue;

            var text = (b.innerText || b.textContent || '').trim();
            var textLower = text.toLowerCase();
            if (!text || text.length > 40) continue;

            if (textLower.indexOf('.js') !== -1 || textLower.indexOf('.ts') !== -1 || textLower.indexOf('.py') !== -1) continue;

            // Skip diff/merge editor buttons — NEVER click these
            var skipEditor = false;
            for (var se = 0; se < EDITOR_SKIP_WORDS.length; se++) {
                if (textLower.indexOf(EDITOR_SKIP_WORDS[se].toLowerCase()) === 0) { skipEditor = true; break; }
            }
            if (skipEditor) continue;

            // Skip diff/merge editor containers + view-zones (inline widgets)
            if (b.closest && (
                b.closest('.monaco-diff-editor') || b.closest('.merge-editor-view') ||
                b.closest('.inline-merge-region') || b.closest('.merged-editor') ||
                b.closest('.view-zones') || b.closest('.view-lines') ||
                b.closest('[id*="workbench.parts.editor"]') || b.closest('.editor-scrollable')
            )) continue;

            // Skip diff hunk buttons (inline accept/reject in editor) — NEVER auto-click these
            if (b.classList && (b.classList.contains('diff-hunk-button') || b.classList.contains('revert'))) {
                var editorAncestor = b.closest && b.closest('[class*="editor"], [id*="editor"]');
                if (editorAncestor) continue;
            }

            var matchesPattern = false;
            for (var p = 0; p < CLICK_PATTERNS.length; p++) {
                var pat = CLICK_PATTERNS[p];
                if (textLower === pat.toLowerCase() || textLower.indexOf(pat.toLowerCase()) === 0) {
                    matchesPattern = true;
                    matchedPattern = pat;
                    break;
                }
            }
            if (!matchesPattern) continue;

            if (b.tagName === 'SPAN' && b.classList.contains('cursor-pointer')) {
                targetBtn = b;
                break;
            }

            if (isApprovalButton(b)) {
                targetBtn = b;
                break;
            }
        }

        // --- SEPARATE Accept handling (chat-only, never via CLICK_PATTERNS) ---
        if (!targetBtn && window._agAcceptChatOnly) {
            for (var ai = 0; ai < clickables.length; ai++) {
                var ab = clickables[ai];
                if (_clicked.has(ab)) continue;
                var aText = (ab.innerText || ab.textContent || '').trim();
                var aTextLower = aText.toLowerCase();

                // Must start with "Accept"
                if (aTextLower.indexOf('accept') !== 0) continue;

                // Block known editor/bulk accept patterns (case-insensitive)
                if (/^Accept\s+(all|changes|incoming|current|both|combination)/i.test(aText)) continue;

                // BLOCK: skip if inside editor area
                if (ab.closest && (
                    ab.closest('.editor-scrollable') ||
                    ab.closest('.monaco-diff-editor') ||
                    ab.closest('.view-zones') ||
                    ab.closest('.merge-editor-view')
                )) {
                    continue;
                }

                // Skip diff hunk buttons by CSS class
                if (ab.classList && (ab.classList.contains('diff-hunk-button') || ab.classList.contains('revert'))) {
                    continue;
                }

                // PASSED all checks → click it
                targetBtn = ab;
                matchedPattern = 'Accept';
                break;
            }
        }

        if (targetBtn) {
            // Log click before executing
            try {
                var _lx = new XMLHttpRequest();
                _lx.open('POST', 'http://127.0.0.1:' + AG_HTTP_PORT + '/api/click-log', true);
                _lx.setRequestHeader('Content-Type', 'application/json');
                _lx.timeout = 3000;
                _lx.send(JSON.stringify({ button: targetBtn.innerText.trim().substring(0, 100), pattern: matchedPattern }));
            } catch (_e) { }
            console.log("[AG Auto] 🎯 Click: [" + targetBtn.innerText.trim() + "]");
            _clicked.add(targetBtn);
            
            // Mouse event dispatch to simulate click correctly in complex elements
            try {
                targetBtn.click();
                var rect = targetBtn.getBoundingClientRect();
                var opts = { view: window, bubbles: true, cancelable: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2, buttons: 1 };
                targetBtn.dispatchEvent(new MouseEvent('mousedown', opts));
                targetBtn.dispatchEvent(new MouseEvent('mouseup', opts));
                targetBtn.dispatchEvent(new MouseEvent('click', opts));
            } catch (e) { }
            
            // Track click in session delta (server will accumulate)
            _agSessionTotal++;
            if (!_agSessionStats[matchedPattern]) _agSessionStats[matchedPattern] = 0;
            _agSessionStats[matchedPattern]++;
            // Also update window display stats immediately
            window._agTotalClicks++;
            if (!window._agClickStats[matchedPattern]) window._agClickStats[matchedPattern] = 0;
            window._agClickStats[matchedPattern]++;
        }
    }, CLICK_INTERVAL_MS);
    window._agToolIntervals.push(autoClick);

    // --- 2. SMART AUTO SCROLL ---
    var _agUserPausedUntil = 0;
    var _agLastScrollTopMap = new WeakMap();

    function _agFindChatScrollContainers() {
        var roots = getAllRoots(document);
        var containers = [];
        roots.forEach(function (root) {
            try {
                var elms = root.querySelectorAll(
                    '.antigravity-agent-side-panel, .react-app-container, [class*="chat"], [class*="conversation"], [class*="message-list"], .monaco-scrollable-element'
                );
                for (var i = 0; i < elms.length; i++) {
                    var el = elms[i];
                    if (el.scrollHeight > el.clientHeight && el.clientHeight > 0) {
                        containers.push(el);
                    }
                }
            } catch (e) {}
        });
        return containers;
    }

    // Scroll listener to detect manual scroll up by user
    window._agScrollListener = function (e) {
        var target = e.target;
        if (!target || !target.scrollHeight || !target.clientHeight) return;
        
        var lastTop = _agLastScrollTopMap.get(target) || 0;
        var currentTop = target.scrollTop;
        var distanceToBottom = target.scrollHeight - target.clientHeight - currentTop;

        // If user scrolls UP and is not at the very bottom (> 30px away from bottom)
        if (currentTop < lastTop && distanceToBottom > 30) {
            _agUserPausedUntil = Date.now() + PAUSE_SCROLL_MS;
            console.log('[AG Auto] 📜 User manually scrolled up -> pause auto-scroll for ' + (PAUSE_SCROLL_MS / 1000) + 's');
        }
        _agLastScrollTopMap.set(target, currentTop);
    };
    window.addEventListener('scroll', window._agScrollListener, true);

    var autoScroll = setInterval(function () {
        if (!window._agAutoEnabled || !window._agScrollEnabled) return;
        if (Date.now() < _agUserPausedUntil) return;

        var containers = _agFindChatScrollContainers();
        containers.forEach(function (c) {
            var distanceToBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
            if (distanceToBottom > 5) {
                c.scrollTop = c.scrollHeight;
            }
        });
    }, SCROLL_INTERVAL_MS);
    window._agToolIntervals.push(autoScroll);

    console.log("[AG Auto] 🚀 Injected Script Initialized | Patterns:", JSON.stringify(CLICK_PATTERNS) + " | SmartScroll: " + window._agScrollEnabled);
})();
