const SUPABASE_URL = "https://iamxgzkxtmcfmnfgozox.supabase.co";
const SUPABASE_KEY = "sb_publishable_h5tljDDYTqftX9aQX9opjQ_cVkNlTiX";
const TABLE = "inventory management";

/* ── REST API Helpers ───────────────────────── */

/**
 * SELECT a single row from a Supabase table.
 * @param {string} table - Table name
 * @param {Object} filters - Key-value filter pairs (PostgREST operators as values)
 */
async function sbSelect(table, filters) {
    const params = new URLSearchParams(filters);
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${params}&limit=1`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Accept': 'application/json'
        }
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json };
    return { data: json.length > 0 ? json[0] : null, error: null };
}

/**
 * INSERT a row into a Supabase table.
 * @param {string} table - Table name
 * @param {Object} row - Row data to insert
 */
async function sbInsert(table, row) {
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(row)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
        return { data: null, error: json };
    }
    return { data: Array.isArray(json) ? json[0] : json, error: null };
}

/**
 * SELECT all rows from a Supabase table with optional filters.
 * @param {string} table - Table name
 * @param {Object} filters - Key-value filter pairs (PostgREST operators as values)
 */
async function sbSelectAll(table, filters = {}) {
    const params = new URLSearchParams(filters);
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${params}&order=created_at.desc`;
    const res = await fetch(url, {
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Accept': 'application/json'
        }
    });
    const json = await res.json();
    if (!res.ok) return { data: null, error: json };
    return { data: json, error: null };
}

/**
 * UPDATE rows in a Supabase table matching a filter.
 * @param {string} table - Table name
 * @param {Object} filters - PostgREST filter params
 * @param {Object} updates - Fields to update
 */
async function sbUpdate(table, filters, updates) {
    const params = new URLSearchParams(filters);
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${params}`;
    const res = await fetch(url, {
        method: 'PATCH',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Content-Type': 'application/json',
            // 'return=representation' so we get back the row(s) that were actually
            // updated. With 'return=minimal', PostgREST returns 200 OK even when
            // the filter matches ZERO rows — there was no way to tell "updated
            // successfully" apart from "silently updated nothing", which is what
            // let edits appear to save but then revert on refresh.
            'Prefer': 'return=representation'
        },
        body: JSON.stringify(updates)
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
        return { error: json || { message: `Update failed (HTTP ${res.status})` } };
    }
    if (Array.isArray(json) && json.length === 0) {
        // Request succeeded, but the filter didn't match any row, so nothing changed.
        return { error: { message: 'No matching row found to update — nothing was saved.', code: 'NO_MATCH' } };
    }
    return { error: null, data: json };
}

/**
 * DELETE rows from a Supabase table matching a filter.
 * @param {string} table - Table name
 * @param {Object} filters - PostgREST filter params
 */
async function sbDelete(table, filters) {
    const params = new URLSearchParams(filters);
    const url = `${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}?${params}`;
    const res = await fetch(url, {
        method: 'DELETE',
        headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': 'Bearer ' + SUPABASE_KEY,
            'Prefer': 'return=minimal'
        }
    });
    if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        return { error: json };
    }
    return { error: null };
}

async function sbUpsertByStockId(table, row) {
    if (!table || !row || !row.stock_id) {
        return { error: { message: 'Missing table or stock_id for insert/upsert.' } };
    }

    const stockId = String(row.stock_id).trim();
    if (!stockId) {
        return { error: { message: 'stock_id cannot be empty.' } };
    }

    const { data: existingRows, error: lookupErr } = await sbSelectAll(table, { 'stock_id': `eq.${stockId}` });
    if (lookupErr) {
        return { error: lookupErr };
    }

    if (existingRows && existingRows.length > 0) {
        const existing = existingRows[0];
        const { error: updateErr, data: updated } = await sbUpdate(table, { 'id': `eq.${existing.id}` }, row);
        if (updateErr) {
            return { error: updateErr };
        }
        return { data: updated || existing, error: null };
    }

    return await sbInsert(table, row);
}
window.sbSelect = sbSelect;
window.sbInsert = sbInsert;
window.sbSelectAll = sbSelectAll;
window.sbUpdate = sbUpdate;
window.sbDelete = sbDelete;
window.sbUpsertByStockId = sbUpsertByStockId;
window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_KEY = SUPABASE_KEY;

/* ── UI Helpers ─────────────────────────────── */

function showError(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
}

function hideError(el) {
    if (!el) return;
    el.style.display = 'none';
    el.textContent = '';
}

function setButtonState(btn, loading, defaultText, loadingText = 'Please wait…') {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = loading ? loadingText : defaultText;
}

/* ── DOMContentLoaded ───────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

    /* ── LOGIN ── */
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const userInput = document.getElementById('loginIdentifier').value.trim().toLowerCase();
            const password = document.getElementById('password').value;
            const errorMsg = document.getElementById('errorMsg');
            const loginBtn = document.getElementById('loginBtn');

            hideError(errorMsg);

            if (!userInput) {
                showError(errorMsg, 'Please enter your username or email.');
                return;
            }

            if (!password) {
                showError(errorMsg, 'Please enter your password.');
                return;
            }

            setButtonState(loginBtn, true, 'Login', 'Signing in…');

            const safetyTimer = setTimeout(() => {
                setButtonState(loginBtn, false, 'Login');
                showError(errorMsg, 'Request timed out. Check your internet connection.');
            }, 12000);

            try {
                // Try matching by username first, then by email
                let result = await sbSelect(TABLE, {
                    'username': `ilike.${userInput}`,
                    'password': `eq.${password}`
                });

                if (!result.data && !result.error) {
                    result = await sbSelect(TABLE, {
                        'email': `ilike.${userInput}`,
                        'password': `eq.${password}`
                    });
                }

                clearTimeout(safetyTimer);

                if (result.error) {
                    setButtonState(loginBtn, false, 'Login');
                    showError(errorMsg, 'Error: ' + (result.error.message || JSON.stringify(result.error)));
                    return;
                }

                if (!result.data) {
                    setButtonState(loginBtn, false, 'Login');
                    showError(errorMsg, 'Invalid username/email or password.');
                    return;
                }

                // Store session
                localStorage.setItem('currentUser', JSON.stringify({
                    id: result.data.id,
                    username: result.data.username,
                    email: result.data.email || ''
                }));

                // Navigation to dashboard
                navigateToPage('dashboard');

            } catch (err) {
                clearTimeout(safetyTimer);
                setButtonState(loginBtn, false, 'Login');
                showError(errorMsg, 'Connection failed: ' + err.message);
            }
        });
    }

    /* ── REGISTER ── */
    const signupForm = document.getElementById('signupForm');
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const username = document.getElementById('username')?.value.trim() || '';
            const email = document.getElementById('email')?.value.trim().toLowerCase() || '';
            const passwordEl = document.getElementById('reg-password') || document.getElementById('password');
            const password = passwordEl ? passwordEl.value : '';
            const confirmPassword = document.getElementById('confirmPassword')?.value || password;
            const errorMsg = document.getElementById('regErrorMsg') || document.getElementById('errorMsg');
            const successMsg = document.getElementById('successMsg');
            const signupBtn = document.getElementById('signupBtn');

            hideError(errorMsg);
            if (successMsg) successMsg.style.display = 'none';

            // Client-side validation
            if (!username) {
                showError(errorMsg, 'Please enter a username.');
                return;
            }

            if (password.length < 8) {
                showError(errorMsg, 'Password must be at least 8 characters.');
                return;
            }

            if (password !== confirmPassword) {
                showError(errorMsg, 'Passwords do not match.');
                return;
            }

            setButtonState(signupBtn, true, 'Sign up', 'Creating account…');

            try {
                // Check if username or email already exists before creating the account.
                const { data: existingUser } = await sbSelect(TABLE, {
                    'username': `ilike.${username}`
                });

                if (existingUser) {
                    setButtonState(signupBtn, false, 'Sign up');
                    showError(errorMsg, 'That username is already taken.');
                    return;
                }

                if (email) {
                    const { data: existingEmail } = await sbSelect(TABLE, {
                        'email': `ilike.${email}`
                    });

                    if (existingEmail) {
                        setButtonState(signupBtn, false, 'Sign up');
                        showError(errorMsg, 'That email is already registered.');
                        return;
                    }
                }

                // Insert new user
                const { error } = await sbInsert(TABLE, {
                    username,
                    email: email || null,
                    password
                });

                if (error) {
                    setButtonState(signupBtn, false, 'Sign up');
                    showError(errorMsg, error.message || JSON.stringify(error));
                    return;
                }

                // Success
                signupBtn.textContent = '✓ Account Created';
                if (successMsg) {
                    successMsg.textContent = 'Account created! Redirecting to sign in…';
                    successMsg.style.display = 'block';
                }

                setTimeout(() => {
                    navigateToPage('login');
                }, 1800);

            } catch (err) {
                setButtonState(signupBtn, false, 'Sign up');
                showError(errorMsg, 'Connection failed: ' + err.message);
            }
        });
    }
});

/**
 * Thin navigation shim — delegates to dashboard.js's full navigateToPage which
 * handles chart inits and data loading. Falls back to a basic SPA switch if
 * dashboard.js hasn't loaded yet (e.g. standalone login.html / register.html).
 */
function _fallbackNavigate(pageName) {
    const targetPage = document.getElementById('page-' + pageName);
    if (targetPage) {
        document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        const targetNav = document.querySelector(`.nav-item[data-page="${pageName}"]`);
        if (targetNav) targetNav.classList.add('active');
        targetPage.classList.add('active');
    } else {
        // Standalone page redirects
        const redirects = { dashboard: 'index.html', login: 'login.html', register: 'register.html' };
        if (redirects[pageName]) window.location.href = redirects[pageName];
    }
}

// If dashboard.js's full navigateToPage isn't registered yet, install the fallback.
// dashboard.js sets window.navigateToPage itself; this only runs if it's absent.
if (typeof window.navigateToPage !== 'function') {
    window.navigateToPage = _fallbackNavigate;
}

// After DOMContentLoaded, always prefer the full version from dashboard.js.
document.addEventListener('DOMContentLoaded', () => {
    // Re-wire to dashboard.js's version if it has been registered
    if (typeof window._dashboardNavigate === 'function') {
        window.navigateToPage = window._dashboardNavigate;
    }
});

function navigateToPage(pageName) {
    // Always call through window.navigateToPage so the full version from
    // dashboard.js is used when available.
    if (window.navigateToPage && window.navigateToPage !== navigateToPage) {
        return window.navigateToPage(pageName);
    }
    _fallbackNavigate(pageName);
}