// ======== PRODUCTS DATABASE INTEGRATION ========
// Maps to Supabase `products` table columns:
// - product_id (or id)
// - client_tag_number (varchar)
// - item_name (varchar)
// - category (varchar)
// - serial_number (varchar)
// - project (varchar)
// - date_received (date)
// - issued_do (varchar)
// - status (varchar)
// - warranty_description (text)
// - remarks (text)
// - attachments (jsonb / text)
// - created_at (timestamptz)

window.PRODUCTS_TABLE = window.PRODUCTS_TABLE || 'products';

// Global cache of master products
window._allMasterProducts = [];

/**
 * Safe HTML escaper helper.
 * @param {any} str
 * @returns {string}
 */
if (typeof window.escapeHtml !== 'function') {
    window.escapeHtml = function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    };
}

/**
 * Normalize attachment formats into a consistent array of { url, name, data } objects.
 * @param {any} attachments
 * @returns {Array<{ url: string, name: string, data?: string }>}
 */
function normalizeProductAttachments(attachments) {
    if (!attachments) return [];

    let list = [];
    if (typeof attachments === 'string') {
        const trimmed = attachments.trim();
        if ((trimmed.startsWith('[') && trimmed.endsWith(']')) || (trimmed.startsWith('{') && trimmed.endsWith('}'))) {
            try {
                const parsed = JSON.parse(trimmed);
                list = Array.isArray(parsed) ? parsed : [parsed];
            } catch (e) {
                list = [{ url: trimmed, name: trimmed.split('/').pop() || 'Attachment' }];
            }
        } else if (trimmed.length > 0) {
            list = [{ url: trimmed, name: trimmed.split('/').pop() || 'Attachment' }];
        }
    } else if (Array.isArray(attachments)) {
        list = attachments;
    } else if (typeof attachments === 'object') {
        list = [attachments];
    }

    return list.map(item => {
        if (typeof item === 'string') {
            return { url: item, name: item.split('/').pop() || 'Attachment' };
        }
        return {
            url: item.data || item.url || '',
            name: item.name || 'Attachment',
            data: item.data
        };
    }).filter(item => Boolean(item.url));
}

// ---- Fetch & Cache Master Products ----
async function fetchMasterProductsList(forceRefresh = false) {
    if (!forceRefresh && Array.isArray(window._allMasterProducts) && window._allMasterProducts.length > 0) {
        return window._allMasterProducts;
    }
    const { data, error } = await sbSelectAll(window.PRODUCTS_TABLE);
    if (!error && data) {
        window._allMasterProducts = data;
    }
    return window._allMasterProducts || [];
}
window.fetchMasterProductsList = fetchMasterProductsList;

// Force refresh the master products cache from Supabase
async function refreshProductsCache() {
    window._allMasterProducts = [];
    return await fetchMasterProductsList(true);
}
window.refreshProductsCache = refreshProductsCache;

// ---- Populate all Linked Product Dropdowns across pages/modals ----
async function populateLinkedProductDropdowns(forceRefresh = false) {
    const products = await fetchMasterProductsList(forceRefresh);
    const dropdowns = document.querySelectorAll('.linked-product-select');

    // Fetch live stock balances to attach to dropdown options
    window._stockBalanceMap = window._stockBalanceMap || {};
    let liveStockRows = [];
    if (typeof sbSelectAll === 'function') {
        try {
            const { data: stockData } = await sbSelectAll(window.PRODUCT_STOCK_TABLE);
            if (stockData && Array.isArray(stockData)) {
                liveStockRows = stockData;
                stockData.forEach(s => {
                    const sid = (s.stock_id || '').trim().toLowerCase();
                    const bal = s.balance !== undefined && s.balance !== null
                        ? (parseInt(s.balance, 10) || 0)
                        : Math.max(0, (parseInt(s.qty_in, 10) || 0) - (parseInt(s.qty_out, 10) || 0));
                    if (sid) window._stockBalanceMap[sid] = bal;
                });
            }
        } catch (e) {
            console.warn('Could not fetch stock balances for dropdowns:', e);
        }
    }

    // Deduplicate so each Product ID / Stock ID appears only once with no duplicates
    const seenStockIds = new Set();
    const uniqueProducts = [];

    products.forEach(p => {
        const stockId = (p.client_tag_number || '').trim().toLowerCase();
        const pid = (p.product_id !== undefined && p.product_id !== null && String(p.product_id).trim() !== '')
            ? String(p.product_id).trim().toLowerCase()
            : '';
        const nameCat = `${(p.item_name || '').trim().toLowerCase()}||${(p.category || '').trim().toLowerCase()}`;
        const dedupeKey = stockId || (pid ? `pid_${pid}` : nameCat);

        if (!seenStockIds.has(dedupeKey) && (!stockId || !seenStockIds.has(stockId)) && (!pid || !seenStockIds.has(`pid_${pid}`))) {
            seenStockIds.add(dedupeKey);
            if (stockId) seenStockIds.add(stockId);
            if (pid) seenStockIds.add(`pid_${pid}`);
            uniqueProducts.push(p);
        }
    });

    // Also include any product_stock items that might not yet be in products table
    liveStockRows.forEach(s => {
        const stockId = (s.stock_id || '').trim().toLowerCase();
        const pid = (s.product_id !== undefined && s.product_id !== null && String(s.product_id).trim() !== '')
            ? String(s.product_id).trim().toLowerCase()
            : '';
        const nameCat = `${(s.product_name || '').trim().toLowerCase()}||${(s.category || '').trim().toLowerCase()}`;
        const dedupeKey = stockId || (pid ? `pid_${pid}` : nameCat);

        if (stockId && !seenStockIds.has(dedupeKey) && !seenStockIds.has(stockId) && (!pid || !seenStockIds.has(`pid_${pid}`))) {
            seenStockIds.add(dedupeKey);
            seenStockIds.add(stockId);
            if (pid) seenStockIds.add(`pid_${pid}`);
            uniqueProducts.push({
                product_id: s.product_id || '',
                client_tag_number: s.stock_id || '',
                item_name: s.product_name || s.stock_name || '',
                category: s.category || '',
                project: '',
                serial_number: ''
            });
        }
    });

    dropdowns.forEach(select => {
        const currentVal = select.value;
        select.innerHTML = '<option value="">-- Choose 1 Stock ID (or enter manually) --</option>';

        uniqueProducts.forEach(p => {
            const opt = document.createElement('option');
            const numericId = (p.product_id !== undefined && p.product_id !== null && !isNaN(parseInt(p.product_id)))
                ? parseInt(p.product_id)
                : (p.id && !isNaN(parseInt(p.id)) ? parseInt(p.id) : '');
            opt.value = numericId;
            const tag = (p.client_tag_number || '').trim();
            opt.dataset.tag = tag;
            opt.dataset.name = p.item_name || '';
            opt.dataset.category = p.category || '';
            opt.dataset.project = p.project || '';
            opt.dataset.serial = p.serial_number || '';

            const liveBal = window._stockBalanceMap[tag.toLowerCase()] ?? 0;
            opt.dataset.balance = liveBal;

            const tagStr = tag ? ` [${tag}]` : '';
            opt.textContent = `${p.item_name} (${p.category})${tagStr}`;
            select.appendChild(opt);
        });

        if (currentVal) {
            select.value = currentVal;
        }
    });

    // Populate filter dropdowns across pages with smart canonical product names
    const filterSelectIds = ['products-name-filter', 'stock-name-filter', 'stock-in-name-filter', 'stock-out-name-filter', 'adj-name-filter'];
    const allRawNames = [
        ...products.map(p => (p.item_name || '').trim()),
        ...liveStockRows.map(s => (s.product_name || s.stock_name || '').trim())
    ].filter(Boolean);

    // Group similar / typo names together under their canonical master name
    const canonicalNames = [];
    const isSimilar = typeof window.isSimilarProductName === 'function'
        ? window.isSimilarProductName
        : (a, b) => a.toLowerCase().trim() === b.toLowerCase().trim();

    allRawNames.forEach(rawName => {
        const existing = canonicalNames.find(c => isSimilar(c, rawName));
        if (!existing) {
            canonicalNames.push(rawName);
        } else {
            // Prefer the capitalized, longer, cleaner master name (e.g. "Biometric kiosk" over "bioemtric kiosk" or "kiosk")
            const isBetter = (rawName.length > existing.length && /^[A-Z]/.test(rawName)) ||
                (!/^[A-Z]/.test(existing) && /^[A-Z]/.test(rawName));
            if (isBetter) {
                const idx = canonicalNames.indexOf(existing);
                canonicalNames[idx] = rawName;
            }
        }
    });

    canonicalNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));

    filterSelectIds.forEach(id => {
        const select = document.getElementById(id);
        if (!select) return;
        const currentVal = select.value;
        select.innerHTML = '<option value="">All Products</option>' + canonicalNames.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
        if (currentVal) {
            const matched = canonicalNames.find(c => isSimilar(c, currentVal)) || currentVal;
            select.value = matched;
        }
    });
}
window.populateLinkedProductDropdowns = populateLinkedProductDropdowns;

// ---- Linked Product OnChange Handler ----
window.onLinkedProductSelect = function (selectEl, stockIdFieldId, nameFieldId, categoryFieldId) {
    const selectedOpt = selectEl.options[selectEl.selectedIndex];
    const idEl = document.getElementById(stockIdFieldId);
    const nameEl = document.getElementById(nameFieldId);
    const catEl = document.getElementById(categoryFieldId);

    if (!selectedOpt || !selectedOpt.value) {
        // Unlock inputs for manual entry if selection cleared
        if (idEl) {
            idEl.value = '';
            idEl.readOnly = false;
        }
        if (nameEl) {
            nameEl.value = '';
            nameEl.readOnly = false;
        }
        if (catEl) {
            catEl.value = '';
            catEl.readOnly = false;
        }
        if (stockIdFieldId === 'so-stock-id') {
            const qtyOutEl = document.getElementById('so-qty-out');
            if (qtyOutEl) qtyOutEl.dataset.available = '0';
            const balEl = document.getElementById('so-balance');
            if (balEl) balEl.value = '0';
        }
        return;
    }

    const tag = selectedOpt.dataset.tag || selectedOpt.value || '';
    const name = selectedOpt.dataset.name || '';
    const category = selectedOpt.dataset.category || '';
    const initialBal = parseInt(selectedOpt.dataset.balance, 10) || 0;

    if (idEl) {
        idEl.value = tag;
        idEl.readOnly = true; // Auto-synced with chosen 1 unique stock ID
    }
    if (nameEl) {
        nameEl.value = name;
        nameEl.readOnly = true; // Kept strictly in sync with master product
    }
    if (catEl) {
        catEl.value = category;
        catEl.readOnly = true; // Kept strictly in sync with master product
    }

    if (stockIdFieldId === 'so-stock-id') {
        const qtyOutEl = document.getElementById('so-qty-out');
        if (qtyOutEl) qtyOutEl.dataset.available = initialBal;
        const qtyOutNum = parseInt(qtyOutEl?.value, 10) || 0;
        const balEl = document.getElementById('so-balance');
        if (balEl) {
            balEl.value = Math.max(0, initialBal - qtyOutNum);
        }
    }
};

// ---- Load all products from Supabase ----
async function loadProductsFromDB() {
    const tbody = document.getElementById('products-tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:28px;color:#64748b;"><i class="ph ph-spinner ph-spin" style="margin-right:6px;"></i>Loading products...</td></tr>';

    try {
        if (typeof sbSelectAll !== 'function') {
            throw new Error('Supabase client not ready (sbSelectAll undefined). Serve via http://localhost:8000 not File://');
        }
        const { data, error } = await sbSelectAll(window.PRODUCTS_TABLE);

        if (error) {
            console.error('Products load error:', error);
            tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:28px;color:#ef4444;"><i class="ph ph-warning-circle" style="margin-right:6px;"></i>Failed to load products: ${escapeHtml(error.message || JSON.stringify(error))}<br><span style="font-size:0.8rem;color:#94a3b8;">Run via http://localhost:8000, not File://</span></td></tr>`;
            return;
        }

        // Deduplicate by stock_id / client_tag_number to handle DB duplicates
        const uniqueData = [];
        const seenIds = new Set();
        if (data) {
            data.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
            data.forEach(row => {
                const sid = (row.client_tag_number || '').toString().trim().toLowerCase();
                if (sid) {
                    if (!seenIds.has(sid)) {
                        seenIds.add(sid);
                        uniqueData.push(row);
                    }
                } else {
                    const rid = (row.id || row.product_id || '').toString();
                    if (rid && !seenIds.has(rid)) {
                        seenIds.add(rid);
                        uniqueData.push(row);
                    } else if (!rid) {
                        uniqueData.push(row);
                    }
                }
            });
        }

        window._allMasterProducts = uniqueData;
        populateLinkedProductDropdowns();

        const emptyEl = document.getElementById('products-empty');

        if (uniqueData.length === 0) {
            tbody.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        if (emptyEl) emptyEl.classList.add('hidden');
        tbody.innerHTML = '';
        uniqueData.forEach(p => tbody.appendChild(buildProductRow(p)));
    } catch (e) {
        console.error('Products load exception:', e);
        tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:28px;color:#ef4444;"><i class="ph ph-warning-circle" style="margin-right:6px;"></i>Failed to load products: ${escapeHtml(e.message || String(e))}<br><span style="font-size:0.8rem;color:#94a3b8;">Run via http://localhost:8000, not File://</span></td></tr>`;
    }
}
window.loadProductsFromDB = loadProductsFromDB;

function getProductStatusBadge(status) {
    let s = (status || 'In Stock').trim();
    const lower = s.toLowerCase();
    if (lower === 'available') s = 'In Stock';
    if (lower === 'in stock' || lower === 'available') {
        return `<span class="badge badge-in">${escapeHtml(s)}</span>`;
    } else if (lower === 'low stock') {
        return `<span class="badge badge-low">${escapeHtml(s)}</span>`;
    } else if (lower === 'out of stock' || lower === 'disposed') {
        return `<span class="badge badge-out">${escapeHtml(s)}</span>`;
    } else if (lower === 'issued') {
        return `<span class="badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;">${escapeHtml(s)}</span>`;
    } else if (lower === 'under repair') {
        return `<span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;">${escapeHtml(s)}</span>`;
    } else {
        return `<span class="badge" style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;">${escapeHtml(s)}</span>`;
    }
}
window.getProductStatusBadge = getProductStatusBadge;

// ---- Render Attachment Thumbnails with Delete Buttons ----
function renderProductAttachmentsHTML(attachments, productId, clientTag = '') {
    const list = normalizeProductAttachments(attachments);
    if (list.length === 0) return '<span class="cell-muted">—</span>';

    const safePid = encodeURIComponent(productId || '');
    const safeTag = encodeURIComponent(clientTag || '');

    return `
        <div class="attachment-list">
            ${list.map((item, idx) => {
        const url = item.url || '';
        const name = item.name || 'Attachment';
        const isImage = url.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name || url);

        if (isImage) {
            return `
                        <div class="attachment-card">
                            <img src="${escapeHtml(url)}" 
                                 class="attachment-thumb" 
                                 alt="${escapeHtml(name)}" 
                                 title="Click to view full preview: ${escapeHtml(name)}"
                                 onclick="if(window.openLightbox) openLightbox(this.src)">
                            <button type="button" 
                                    class="attachment-delete-btn" 
                                    title="Remove attachment"
                                    onclick="deleteProductAttachment(decodeURIComponent('${safePid}'), ${idx}, decodeURIComponent('${safeTag}'))">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                    `;
        } else {
            return `
                        <div class="attachment-card">
                            <div class="attachment-thumb" 
                                 style="display:flex; align-items:center; justify-content:center; background:#eff6ff; color:#2563eb; font-size:1.3rem; cursor:pointer;"
                                 title="Click to open ${escapeHtml(name)}"
                                 data-url="${escapeHtml(url)}"
                                 data-name="${escapeHtml(name)}"
                                 onclick="if(window.openAttachmentOutside) openAttachmentOutside(this.dataset.url, this.dataset.name)">
                                <i class="ph ph-file-text"></i>
                            </div>
                            <button type="button" 
                                    class="attachment-delete-btn" 
                                    title="Remove attachment"
                                    onclick="deleteProductAttachment(decodeURIComponent('${safePid}'), ${idx}, decodeURIComponent('${safeTag}'))">
                                <i class="ph ph-trash"></i>
                            </button>
                        </div>
                    `;
        }
    }).join('')}
        </div>
    `;
}

// ---- Delete an Attachment from Product Record ----
async function deleteProductAttachment(productId, index, clientTagNumber = '') {
    if (!productId && !clientTagNumber) {
        alert('Product ID not found.');
        return;
    }

    if (!confirm('Are you sure you want to remove this attachment?')) return;

    // Fetch current product with fallback to `product_id` or `client_tag_number`
    let currentProduct = null;
    if (productId) {
        const res1 = await sbSelect(window.PRODUCTS_TABLE, { 'product_id': `eq.${productId}` });
        if (res1.data) {
            currentProduct = res1.data;
        }
    }
    if (!currentProduct && clientTagNumber) {
        const res3 = await sbSelect(window.PRODUCTS_TABLE, { 'client_tag_number': `eq.${clientTagNumber}` });
        if (res3.data) currentProduct = res3.data;
    }

    if (!currentProduct) {
        alert('Product not found in database.');
        return;
    }

    let updatedAttachments = null;
    const list = normalizeProductAttachments(currentProduct.attachments);
    if (list.length > 0) {
        list.splice(index, 1);
        updatedAttachments = list.length > 0 ? list : null;
    }

    const ok = await updateProductInDB(productId, { attachments: updatedAttachments }, clientTagNumber);
    if (ok) {
        await loadProductsFromDB();
        await populateLinkedProductDropdowns(true);
    }
}
window.deleteProductAttachment = deleteProductAttachment;

// ---- Format Date Helper ----
function formatDisplayDate(dateStr) {
    if (!dateStr) return '—';
    try {
        // Handle YYYY-MM-DD or standard ISO strings safely
        const parts = String(dateStr).split('-');
        if (parts.length === 3 && parts[0].length === 4) {
            const year = parseInt(parts[0], 10);
            const month = parseInt(parts[1], 10) - 1;
            const day = parseInt(parts[2], 10);
            const d = new Date(year, month, day);
            if (!isNaN(d.getTime())) {
                return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
        }
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }
        return dateStr;
    } catch (e) {
        return dateStr;
    }
}

// ---- Build a table row from a Supabase product record ----
function buildProductRow(p) {
    const tr = document.createElement('tr');
    const pid = p.product_id || p.id || '';
    const clientTag = p.client_tag_number || '';
    tr.dataset.productId = pid;
    tr.dataset.clientTag = clientTag;
    tr.dataset.dateReceived = p.date_received || '';
    tr.dataset.createdAt = p.created_at || '';
    tr.dataset.updatedAt = p.updated_at || '';
    tr._productData = p;

    const formattedDate = formatDisplayDate(p.date_received);
    const attachmentHtml = renderProductAttachmentsHTML(p.attachments, pid, clientTag);
    const warranty = escapeHtml(p.warranty_description || '—');
    const remarks = escapeHtml(p.remarks || '—');

    tr.innerHTML = `
        <td class="cell-muted">${escapeHtml(p.client_tag_number || '—')}</td>
        <td class="cell-bold">${escapeHtml(p.item_name || '—')}</td>
        <td class="cell-muted">${escapeHtml(p.category || '—')}</td>
        <td class="cell-muted">${escapeHtml(p.serial_number || '—')}</td>
        <td class="cell-muted">${escapeHtml(p.project || '—')}</td>
        <td class="cell-muted">${escapeHtml(formattedDate)}</td>
        <td class="cell-muted">${escapeHtml(p.issued_do || '—')}</td>
        <td>${getProductStatusBadge(p.status)}</td>
        <td style="max-width:140px;white-space:normal;font-size:0.8rem;color:#475569;">${warranty}</td>
        <td style="max-width:140px;white-space:normal;font-size:0.8rem;color:#475569;">${remarks}</td>
        <td>${attachmentHtml}</td>
        <td>
            <div style="display:inline-flex; align-items:center; gap:6px;">
                <button class="icon-btn" title="Edit Product" onclick="editProductRow(this)" style="color:#2563eb;">
                    <i class="ph ph-pencil-simple"></i>
                </button>
                <button class="icon-btn" title="Delete Product" onclick="deleteProductRow(this)" style="color:#ef4444;">
                    <i class="ph ph-trash"></i>
                </button>
            </div>
        </td>
    `;
    return tr;
}
window.buildProductRow = buildProductRow;

// ---- Delete a product from Supabase ----
async function deleteProductRow(btn) {
    const tr = btn.closest('tr');
    if (!tr) return;

    const productId = tr.dataset.productId || tr._productData?.product_id || tr._productData?.id;
    const itemName = tr._productData?.item_name || tr.cells[1]?.textContent.trim() || 'Product';
    const tag = tr.dataset.clientTag || tr._productData?.client_tag_number || tr.cells[0]?.textContent.trim() || '';

    if (!productId && !tag) {
        alert('Product ID not found.');
        return;
    }

    const tagDisplay = tag ? ` (${tag})` : '';
    if (!confirm(`Are you sure you want to delete "${itemName}"${tagDisplay}?\n\nThis will permanently remove the product from the database.`)) {
        return;
    }

    // 1) First remove or unlink referencing records in stock_in, stock_out, adjustments, and product_stock so foreign keys do not block deletion
    if (typeof sbDelete === 'function') {
        const stockInTable = window.STOCK_IN_TABLE || 'stock_in';
        const stockOutTable = window.STOCK_OUT_TABLE || 'stock_out';
        const adjTable = window.ADJUSTMENTS_TABLE || 'adjustments';
        if (tag) {
            try { await sbDelete(stockInTable, { 'stock_id': `eq.${tag}` }); } catch (e) { }
            try { await sbDelete(stockOutTable, { 'stock_id': `eq.${tag}` }); } catch (e) { }
            try { await sbDelete(adjTable, { 'stock_id': `eq.${tag}` }); } catch (e) { }
        }
        if (productId) {
            try { await sbDelete(stockInTable, { 'product_id': `eq.${productId}` }); } catch (e) { }
            try { await sbDelete(stockOutTable, { 'product_id': `eq.${productId}` }); } catch (e) { }
            try { await sbDelete(window.PRODUCT_STOCK_TABLE, { 'product_id': `eq.${productId}` }); } catch (e) { }
        }
        if (tag) {
            try { await sbDelete(window.PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${tag}` }); } catch (e) { }
        }
    }

    // 2) Delete from products table using product_id (or client_tag_number as fallback)
    let res = null;
    if (productId) {
        res = await sbDelete(window.PRODUCTS_TABLE, { 'product_id': `eq.${productId}` });
    }
    if ((!res || res.error) && tag) {
        res = await sbDelete(window.PRODUCTS_TABLE, { 'client_tag_number': `eq.${tag}` });
    }

    if (res && res.error) {
        alert('Failed to delete product from database: ' + (res.error.message || JSON.stringify(res.error)));
        return;
    }

    if (typeof logAudit === 'function' && typeof getCurrentUser === 'function') {
        logAudit('Deleted', 'Products', `${getCurrentUser()} deleted master product "${itemName}"${tagDisplay}`, tag || String(productId), itemName);
    }

    // Reload products table and refresh linked dropdowns
    await loadProductsFromDB();
    if (typeof window.loadProductStockFromDB === 'function') {
        await window.loadProductStockFromDB();
    }
    if (typeof window.loadStockInFromDB === 'function') {
        await window.loadStockInFromDB();
    }
    if (typeof window.loadStockOutFromDB === 'function') {
        await window.loadStockOutFromDB();
    }
    if (typeof window.updateDashboardStats === 'function') {
        window.updateDashboardStats();
    }
    await populateLinkedProductDropdowns(true);
}
window.deleteProductRow = deleteProductRow;

// ---- Format DB Error Helper ----
function getFriendlyDBErrorMessage(error, defaultAction = 'save') {
    if (!error) return `Failed to ${defaultAction} product.`;
    const msg = error.message || (typeof error === 'string' ? error : JSON.stringify(error));
    const details = error.details || '';

    if (msg.includes('products_serial_number_key') || details.includes('serial_number') || (error.code === '23505' && (msg.includes('serial') || details.includes('serial')))) {
        return 'Duplicate Serial Number: A product with this serial number already exists in the database. Please enter a unique serial number.';
    }
    if (error.code === '23505' || msg.includes('duplicate key value')) {
        return `Duplicate record error: ${msg}`;
    }
    return `Failed to ${defaultAction} product in database: ${msg}`;
}

// ---- Insert a new product into Supabase ----
async function saveNewProductToDB(data) {
    const res = await sbInsert(window.PRODUCTS_TABLE, data);
    if (res.error) {
        alert(getFriendlyDBErrorMessage(res.error, 'save'));
        return false;
    }

    // Automatically sync initial product_stock record so it appears in Stock In/Out and satisfies foreign keys.
    // Keep the default status aligned with the product state instead of inverting valid values to "Out of Stock".
    const stockId = data.client_tag_number;
    if (stockId && typeof sbUpsertByStockId === 'function') {
        try {
            const numProdId = res.data?.product_id && !isNaN(parseInt(res.data.product_id, 10))
                ? parseInt(res.data.product_id, 10)
                : null;
            const rawStatus = String(data.status ?? 'In Stock').trim();
            const normalizedStatus = rawStatus.toLowerCase() === 'available' ? 'In Stock' : (rawStatus || 'In Stock');
            const upsertRes = await sbUpsertByStockId(window.PRODUCT_STOCK_TABLE, {
                stock_id: stockId,
                product_name: data.item_name,
                category: data.category,
                qty_in: 0,
                qty_out: 0,
                status: normalizedStatus,
                attachment_id: null,
                product_id: numProdId
            });
            if (upsertRes.error) {
                console.warn('Could not auto-create or sync product_stock entry:', upsertRes.error);
            }
        } catch (e) {
            console.warn('Could not auto-create product_stock entry:', e);
        }
    }

    return true;
}
window.saveNewProductToDB = saveNewProductToDB;

// ---- Update an existing product in Supabase ----
async function updateProductInDB(productId, updates, clientTagNumber = null) {
    if (!productId && !clientTagNumber) {
        console.warn('updateProductInDB: no productId or clientTagNumber provided to locate record');
        return false;
    }
    let res = null;
    if (productId) {
        const filter = { 'product_id': `eq.${productId}` };
        res = await sbUpdate(window.PRODUCTS_TABLE, filter, updates);
    }
    if ((!res || res.error) && clientTagNumber) {
        res = await sbUpdate(window.PRODUCTS_TABLE, { 'client_tag_number': `eq.${clientTagNumber}` }, updates);
    }
    if (res && res.error) {
        alert(getFriendlyDBErrorMessage(res.error, 'update'));
        return false;
    }
    if (!res) {
        return false;
    }
    return true;
}
window.updateProductInDB = updateProductInDB;

// ---- Hook: reload products on navigation & bind save handler ----
document.addEventListener('DOMContentLoaded', () => {
    // Always pre-fetch & render products from DB on every page load/refresh.
    // This ensures the Products table is populated whether the user lands on
    // the Dashboard first or navigates directly to Products after login.
    loadProductsFromDB();

    // Bind save button in stock-modal
    const stockSaveBtn = document.getElementById('stock-modal-save-btn')
        || document.querySelector('#stock-modal .modal-footer .btn-primary');
    if (stockSaveBtn && !stockSaveBtn.getAttribute('data-bound')) {
        stockSaveBtn.setAttribute('data-bound', '1');
        stockSaveBtn.onclick = handleProductModalSave;
    }
});

// ======== PRODUCT ID GENERATION ========
function generateProductId({ category, brand, variant, sequenceNumber }) {
    // Helper to get uppercase prefix, default to 'X' if attribute is missing
    const getPrefix = (text, length = 3) => {
        if (!text) return 'X'.repeat(length);
        return text.trim().replace(/[^a-zA-Z0-9]/g, '').slice(0, length).toUpperCase();
    };

    const catCode = getPrefix(category, 3);
    const brandCode = getPrefix(brand, 3);
    const variantCode = getPrefix(variant, 2);

    // Pad the sequence number with leading zeros (e.g., 7 becomes 0007)
    const sequenceCode = String(sequenceNumber || 1).padStart(4, '0');

    // Combine elements with hyphens
    return `${catCode}-${brandCode}-${variantCode}-${sequenceCode}`;
}
window.generateProductId = generateProductId;

// Function to auto-generate and populate the field in the modal sequentially (pure / non-destructive)
function autoGenerateCurrentProductId() {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`; // 6-digit YYMMDD

    const products = Array.isArray(window._allMasterProducts) ? window._allMasterProducts : [];

    // Find highest sequence number for today from cached products
    let maxSeq = 0;
    products.forEach(p => {
        const tag = String(p.client_tag_number || p.stock_id || '').trim();
        // Match format: YYMMDD-XXXX or YYMMDD-PREFIX-XXXX (e.g. 260902-0001, 260902-ABC-0001)
        const match = tag.match(/^(\d{6})(?:-[A-Za-z0-9]+)*-(\d+)$/i);
        if (match) {
            const tagDate = match[1];
            const seqNum = parseInt(match[2], 10);
            if (tagDate === datePrefix && !isNaN(seqNum) && seqNum > maxSeq) {
                maxSeq = seqNum;
            }
        }
    });

    // Also check visible table rows in DOM as a fallback
    document.querySelectorAll('#products-tbody tr, #stock-tbody tr').forEach(tr => {
        const tag = (tr.cells?.[0]?.textContent || tr.dataset?.productTag || '').trim();
        const match = tag.match(/^(\d{6})(?:-[A-Za-z0-9]+)*-(\d+)$/i);
        if (match) {
            const tagDate = match[1];
            const seqNum = parseInt(match[2], 10);
            if (tagDate === datePrefix && !isNaN(seqNum) && seqNum > maxSeq) {
                maxSeq = seqNum;
            }
        }
    });

    const nextSeq = maxSeq + 1;
    const generated = `${datePrefix}-${String(nextSeq).padStart(4, '0')}`;

    const stockIdEl = document.getElementById('stk-stock-id');
    if (stockIdEl) {
        stockIdEl.value = generated;
    }
    return generated;
}
window.autoGenerateCurrentProductId = autoGenerateCurrentProductId;

// Helper to fetch latest products from DB & find the next guaranteed unique tag
async function getNextUniqueClientTag() {
    const now = new Date();
    const yy = now.getFullYear().toString().slice(2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const datePrefix = `${yy}${mm}${dd}`;

    let maxSeq = 0;

    // 1. Check live DB records
    if (typeof sbSelectAll === 'function') {
        try {
            const { data } = await sbSelectAll(window.PRODUCTS_TABLE);
            if (Array.isArray(data)) {
                data.forEach(p => {
                    const tag = String(p.client_tag_number || p.stock_id || '').trim();
                    const match = tag.match(/^(\d{6})(?:-[A-Za-z0-9]+)*-(\d+)$/i);
                    if (match) {
                        const tagDate = match[1];
                        const seqNum = parseInt(match[2], 10);
                        if (tagDate === datePrefix && !isNaN(seqNum) && seqNum > maxSeq) {
                            maxSeq = seqNum;
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('DB check for next tag failed:', e);
        }
    }

    // 2. Check cached products
    const products = Array.isArray(window._allMasterProducts) ? window._allMasterProducts : [];
    products.forEach(p => {
        const tag = String(p.client_tag_number || p.stock_id || '').trim();
        const match = tag.match(/^(\d{6})(?:-[A-Za-z0-9]+)*-(\d+)$/i);
        if (match) {
            const tagDate = match[1];
            const seqNum = parseInt(match[2], 10);
            if (tagDate === datePrefix && !isNaN(seqNum) && seqNum > maxSeq) {
                maxSeq = seqNum;
            }
        }
    });

    // 3. Check visible table rows in DOM
    document.querySelectorAll('#products-tbody tr, #stock-tbody tr').forEach(tr => {
        const tag = (tr.cells?.[0]?.textContent || tr.dataset?.productTag || '').trim();
        const match = tag.match(/^(\d{6})(?:-[A-Za-z0-9]+)*-(\d+)$/i);
        if (match) {
            const tagDate = match[1];
            const seqNum = parseInt(match[2], 10);
            if (tagDate === datePrefix && !isNaN(seqNum) && seqNum > maxSeq) {
                maxSeq = seqNum;
            }
        }
    });

    const nextSeq = maxSeq + 1;
    return `${datePrefix}-${String(nextSeq).padStart(4, '0')}`;
}
window.getNextUniqueClientTag = getNextUniqueClientTag;

// ---- Handle Save / Update from Add/Edit Modal ----
async function handleProductModalSave() {
    const saveBtn = document.getElementById('stock-modal-save-btn')
        || document.querySelector('#stock-modal .modal-footer .btn-primary');

    let clientTag = document.getElementById('stk-stock-id')?.value.trim();
    const itemName = document.getElementById('stk-product-name')?.value.trim();
    const category = document.getElementById('stk-category')?.value.trim();
    const serialNumber = document.getElementById('stk-serial-number')?.value.trim() || null;
    const project = document.getElementById('stk-project')?.value.trim() || null;
    const dateReceived = document.getElementById('stk-date-received')?.value || null;
    const issuedDo = document.getElementById('stk-issued-do')?.value.trim() || null;
    const status = normalizeStatus(document.getElementById('stk-status')?.value || 'In Stock');
    const warranty = document.getElementById('stk-warranty')?.value.trim() || null;
    const remarks = document.getElementById('stk-remarks')?.value.trim() || null;

    if (!itemName || !category) {
        alert('Please fill in at least Item Name and Category.');
        return;
    }

    const editingRow = window._editingStockRow;
    const currentProductId = editingRow ? (editingRow.dataset?.productId || editingRow._productData?.product_id || editingRow._productData?.id) : null;

    // Check for duplicate serial number against fresh cached products before submitting
    const serialKey = (serialNumber || '').trim().toLowerCase();
    if (serialKey) {
        await fetchMasterProductsList(true);

        const existingProducts = Array.isArray(window._allMasterProducts) ? window._allMasterProducts : [];
        const duplicate = existingProducts.find(p => {
            if (!p.serial_number) return false;
            const pId = p.product_id || p.id;
            if (currentProductId && String(pId) === String(currentProductId)) {
                return false; // Skip current record if editing
            }
            return String(p.serial_number).trim().toLowerCase() === serialKey;
        });

        if (duplicate) {
            alert(`Duplicate Serial Number:\nA product ("${duplicate.item_name || 'Item'}" - Tag: ${duplicate.client_tag_number || 'N/A'}) is already registered with Serial Number "${serialNumber}".\n\nPlease enter a unique serial number.`);
            const snInput = document.getElementById('stk-serial-number');
            if (snInput) snInput.focus();
            return;
        }
    }

    // Auto-generate / lock ID on new record save, guaranteeing live DB uniqueness
    if (!window._editingStockRow) {
        if (!clientTag) {
            clientTag = await getNextUniqueClientTag();
            const stockIdEl = document.getElementById('stk-stock-id');
            if (stockIdEl) stockIdEl.value = clientTag;
        } else {
            // Verify against live DB; if an auto-formatted ID collides, resolve to the next available unique sequence
            const isAutoFormat = /^(\d{6})(?:-[A-Za-z0-9]+)*-(\d+)$/i.test(clientTag);
            if (typeof sbSelectAll === 'function') {
                try {
                    const { data: dbRows } = await sbSelectAll(window.PRODUCTS_TABLE, { 'client_tag_number': `ilike.${clientTag}` });
                    const dbDup = dbRows && dbRows.find(p => String(p.client_tag_number || '').trim().toLowerCase() === clientTag.toLowerCase());
                    if (dbDup) {
                        if (isAutoFormat) {
                            clientTag = await getNextUniqueClientTag();
                            const stockIdEl = document.getElementById('stk-stock-id');
                            if (stockIdEl) stockIdEl.value = clientTag;
                        } else {
                            alert(`Duplicate Stock ID:\nA product ("${dbDup.item_name || 'Item'}") is already registered with Stock ID / Client Tag "${clientTag}".\n\nPlease use a unique Stock ID.`);
                            const tagInput = document.getElementById('stk-stock-id');
                            if (tagInput) tagInput.focus();
                            return;
                        }
                    }
                } catch (e) { console.warn('DB duplicate check failed', e); }
            }
        }
    } else {
        // Duplicate check when editing an existing record
        if (clientTag) {
            const origTag = window._originalEditingTag || window._editingStockRow?.cells?.[0]?.textContent.trim() || '';
            const isEditingSameTag = origTag && origTag.toLowerCase() === clientTag.toLowerCase();
            if (!isEditingSameTag) {
                // 1) DB check (live) - only for changed tag
                if (typeof sbSelectAll === 'function') {
                    try {
                        const { data: dbRows } = await sbSelectAll(window.PRODUCTS_TABLE, { 'client_tag_number': `ilike.${clientTag}` });
                        if (dbRows && dbRows.length > 0) {
                            const dbDup = dbRows.find(p => String(p.client_tag_number || '').trim().toLowerCase() === clientTag.toLowerCase());
                            if (dbDup) {
                                alert(`Duplicate Stock ID:\nA product ("${dbDup.item_name || 'Item'}") is already registered with Stock ID / Client Tag "${clientTag}".\n\nPlease use a unique Stock ID.`);
                                const tagInput = document.getElementById('stk-stock-id');
                                if (tagInput) tagInput.focus();
                                return;
                            }
                        }
                    } catch (e) { console.warn('DB duplicate check failed', e); }
                }
                // 2) Cache fallback
                const existingProducts = Array.isArray(window._allMasterProducts) ? window._allMasterProducts : [];
                const duplicateTag = existingProducts.find(p => p.client_tag_number && p.client_tag_number.trim().toLowerCase() === clientTag.toLowerCase());
                if (duplicateTag) {
                    alert(`Duplicate Stock ID:\nA product ("${duplicateTag.item_name || 'Item'}") is already registered with Stock ID / Client Tag "${clientTag}".\n\nPlease use a unique Stock ID.`);
                    const tagInput = document.getElementById('stk-stock-id');
                    if (tagInput) tagInput.focus();
                    return;
                }
            }
        } else {
            clientTag = null;
        }
    }

    const payload = {
        client_tag_number: clientTag || null,
        item_name: itemName,
        category: category,
        serial_number: serialNumber,
        project: project,
        date_received: dateReceived,
        issued_do: issuedDo,
        status: status,
        warranty_description: warranty,
        remarks: remarks
    };

    // Attach file if selected, remove if cleared, or preserve existing
    if (window._stkAttachmentRemoved) {
        payload.attachments = null;
    } else if (window._stkFileBase64 && window._stkFileName) {
        payload.attachments = {
            name: window._stkFileName,
            data: window._stkFileBase64
        };
    } else if (window._editingStockRow && window._editingStockRow._productData && window._editingStockRow._productData.attachments) {
        payload.attachments = window._editingStockRow._productData.attachments;
    }

    // Indicate loading state on button to prevent duplicate clicks
    const originalBtnText = saveBtn ? saveBtn.textContent : '';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.innerHTML = '<i class="ph ph-spinner ph-spin" style="margin-right:6px;"></i>Saving...';
    }

    try {
        if (editingRow) {
            // If editing from Product Stock page (#stock-tbody), update product_stock master instead of products catalog
            const isProductStockRow = !!editingRow.closest('#stock-tbody');
            if (isProductStockRow) {
                const origTag = editingRow.cells?.[0]?.textContent.trim() || window._originalEditingTag || clientTag;
                const stockPayload = {
                    stock_id: clientTag || null,
                    product_name: itemName,
                    category: category,
                    status: status
                };
                const dbFilter = editingRow.dataset?.dbId
                    ? { 'id': `eq.${editingRow.dataset.dbId}` }
                    : (origTag ? { 'stock_id': `eq.${origTag}` } : null);

                if (dbFilter && typeof sbUpdate === 'function') {
                    const { error } = await sbUpdate('product_stock', dbFilter, stockPayload);
                    if (error) { alert('Failed to update Product Stock: ' + (error.message || JSON.stringify(error))); return; }
                }

                // also keep products catalog in sync if client_tag matches or productId exists
                const pId = editingRow.dataset?.productId || editingRow._productData?.product_id || editingRow._productData?.id;
                try {
                    if (pId) {
                        await updateProductInDB(pId, payload, origTag);
                    } else if (origTag) {
                        const { data: prodRows } = await sbSelectAll(window.PRODUCTS_TABLE, { 'client_tag_number': `ilike.${origTag}` });
                        const prod = prodRows && prodRows[0] ? prodRows[0] : null;
                        if (prod) {
                            const foundId = prod.id || prod.product_id;
                            await updateProductInDB(foundId, payload, origTag);
                        }
                    }
                } catch (e) { console.warn('Sync products catalog from product_stock edit failed', e); }
            } else {
                // Update products catalog record
                const productId = editingRow.dataset?.productId || editingRow._productData?.product_id || editingRow._productData?.id;
                const origTag = window._originalEditingTag || editingRow.cells?.[0]?.textContent.trim() || clientTag;
                const ok = await updateProductInDB(productId, payload, origTag);
                if (!ok) return;

                // Fully sync to product_stock table so product_stock has the identical status, name, and category
                if (typeof sbUpdate === 'function') {
                    const stockPayload = {
                        status: status,
                        product_name: itemName,
                        category: category
                    };
                    if (clientTag) stockPayload.stock_id = clientTag;
                    try {
                        if (productId) {
                            await sbUpdate('product_stock', { 'product_id': `eq.${productId}` }, stockPayload);
                        }
                        if (origTag) {
                            await sbUpdate('product_stock', { 'stock_id': `eq.${origTag}` }, stockPayload);
                        }
                        if (clientTag && clientTag !== origTag) {
                            await sbUpdate('product_stock', { 'stock_id': `eq.${clientTag}` }, stockPayload);
                        }
                    } catch (e) { console.warn('Sync to product_stock failed', e); }
                }
            }

            // Sync status and details across movement tables (stock_in, stock_out) for this stock ID
            const syncTag = clientTag || window._originalEditingTag;
            if (syncTag && typeof sbUpdate === 'function') {
                try {
                    await sbUpdate(STOCK_IN_TABLE, { 'stock_id': `eq.${syncTag}` }, { product_name: itemName, category: category, status: status });
                } catch (e) { }
                try {
                    await sbUpdate(STOCK_OUT_TABLE, { 'stock_id': `eq.${syncTag}` }, { product_name: itemName, category: category, status: status });
                } catch (e) { }
                // Recalculate balance and status from stock movements to keep all pages in sync, passing explicit status
                if (typeof window.recalcProductStockByStockId === 'function') {
                    await window.recalcProductStockByStockId(syncTag, status);
                }
            }
        } else {
            // Insert new record
            const ok = await saveNewProductToDB(payload);
            if (!ok) return;
            if (clientTag && typeof window.recalcProductStockByStockId === 'function') {
                await window.recalcProductStockByStockId(clientTag, status);
            }
        }

        // Close modal if applicable
        if (typeof closeStockModal === 'function') closeStockModal();

        // Reload all tables and dashboard stats to guarantee full synchronization across every page
        await loadProductsFromDB();
        if (typeof window.loadProductStockFromDB === 'function') await window.loadProductStockFromDB();
        if (typeof window.loadStockInFromDB === 'function') await window.loadStockInFromDB();
        if (typeof window.loadStockOutFromDB === 'function') await window.loadStockOutFromDB();
        if (typeof window.loadAdjustmentsFromDB === 'function') await window.loadAdjustmentsFromDB();
        if (typeof window.updateDashboardStats === 'function') window.updateDashboardStats();
        if (typeof window.renderStatusDistributionChart === 'function') window.renderStatusDistributionChart();
        await populateLinkedProductDropdowns(true);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalBtnText;
        }
    }
}
window.handleProductModalSave = handleProductModalSave;
