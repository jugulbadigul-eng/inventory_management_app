/**
 * ========================================================
 * INVENTORYFLOW  DASHBOARD, REPORTS, MODALS & CORE ENGINE
 * ========================================================
 */

function getElementValue(id, fallback = '') {
    const element = document.getElementById(id);
    return element ? String(element.value ?? fallback).trim() : fallback;
}

function toInteger(value, fallback = 0) {
    const number = Number.parseInt(String(value ?? '').replace(/,/g, '').trim(), 10);
    return Number.isFinite(number) ? number : fallback;
}

function toNumber(value, fallback = 0) {
    const number = Number.parseFloat(String(value ?? '').replace(/,/g, '').trim());
    return Number.isFinite(number) ? number : fallback;
}

function parseDateToYMD(raw) {
    if (!raw) return null;
    const value = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;

    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
window.parseDateToYMD = parseDateToYMD;

function formatChartLabel(label, maxLength = 20) {
    if (Array.isArray(label)) return label.map(part => formatChartLabel(part, maxLength));
    const value = String(label ?? '');
    return value.length > maxLength ? `${value.slice(0, maxLength - 2)}...` : value;
}

// ======== 1. NAVIGATION ENGINE ========

function navigateToPage(target) {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    const pages = document.querySelectorAll('.page');

    navItems.forEach(n => n.classList.remove('active'));
    pages.forEach(p => p.classList.remove('active'));

    const targetNav = document.querySelector(`.nav-item[data-page="${target}"]`);
    if (targetNav) targetNav.classList.add('active');

    const targetPage = document.getElementById('page-' + target);
    if (targetPage) {
        targetPage.classList.add('active');

        // Trigger page-specific data loaders and chart initializations
        if (target === 'dashboard') {
            loadAllDataFromDB();
            setTimeout(async () => { await initDashboardCharts(); }, 60);
        } else if (target === 'reports') {
            switchReportTab(_currentReportTab || 'current-stock');
            loadAllDataFromDB().then(() => {
                switchReportTab(_currentReportTab || 'current-stock');
            });
        } else if (target === 'products' && typeof window.loadProductsFromDB === 'function') {
            window.loadProductsFromDB();
        } else if (target === 'product-stock') {
            loadProductStockFromDB();
        } else if (target === 'stock-in') {
            loadStockInFromDB();
        } else if (target === 'stock-out') {
            loadStockOutFromDB();
        } else if (target === 'adjustments') {
            loadAdjustmentsFromDB();
        } else if (['add-record'].includes(target) && typeof window.populateLinkedProductDropdowns === 'function') {
            window.populateLinkedProductDropdowns();
        }
    }
}
window.navigateToPage = navigateToPage;
window._dashboardNavigate = navigateToPage; // aliased so auth.js can re-wire to this full version

// Bind sidebar navigation clicks
document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item[data-page]');
    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const target = item.getAttribute('data-page');
            if (target) navigateToPage(target);
        });
    });

    // 1. Load persisted tables from storage first for instant display
    loadAllMovementTables();

    // 2. Fetch live data from Supabase backend in parallel
    loadAllDataFromDB();

    // 3. Pre-fetch master products from DB
    if (typeof window.loadProductsFromDB === 'function') {
        window.loadProductsFromDB();
    } else {
        setTimeout(() => {
            if (typeof window.loadProductsFromDB === 'function') {
                window.loadProductsFromDB();
            }
        }, 300);
    }

    // 4. Auto-init dashboard or reports charts if active on load
    const dashPage = document.getElementById('page-dashboard');
    if (dashPage && dashPage.classList.contains('active')) {
        setTimeout(async () => { await initDashboardCharts(); }, 80);
    }
    const repPage = document.getElementById('page-reports');
    if (repPage && repPage.classList.contains('active')) {
        setTimeout(() => { if (typeof window.switchReportTab === 'function') window.switchReportTab(_currentReportTab || 'current-stock'); }, 80);
    }
});

// Window load fallback: only re-init charts if they weren't created yet
window.addEventListener('load', () => {
    if (!_dashMovementChart || !_dashCategoryChart) {
        const dashPage = document.getElementById('page-dashboard');
        if (dashPage && dashPage.classList.contains('active')) {
            setTimeout(async () => { await initDashboardCharts(); }, 100);
        }
    }
    const repPage = document.getElementById('page-reports');
    if (repPage && repPage.classList.contains('active')) {
        if (!_barChart || !_donutChart) {
            setTimeout(() => { if (typeof window.switchReportTab === 'function') window.switchReportTab(_currentReportTab || 'current-stock'); }, 100);
        }
    }
});



// ======== 2. DYNAMIC STATS & LOCAL PERSISTENCE ========

function saveTableToStorage(tbodyId, storageKey) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    try {
        localStorage.setItem(storageKey, tbody.innerHTML);
    } catch (e) { }
}

function loadTableFromStorage(tbodyId, storageKey) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    try {
        const saved = localStorage.getItem(storageKey);
        if (saved && saved.trim()) {
            tbody.innerHTML = saved;
            // Clean up any duplicate rows that might have been saved in localStorage
            const seen = new Set();
            Array.from(tbody.querySelectorAll('tr')).forEach(r => {
                const sid = (tbodyId === 'stock-out-tbody' || tbodyId === 'stock-tbody' || tbodyId === 'adj-tbody')
                    ? (r.cells[0]?.textContent.trim().toLowerCase() || '')
                    : '';
                const rowKey = sid || r.dataset.id || (
                    (r.cells[0]?.textContent.trim() || '') + '_' +
                    (r.cells[1]?.textContent.trim() || '') + '_' +
                    (r.cells[7]?.textContent.trim() || r.cells[6]?.textContent.trim() || '')
                );
                if (rowKey && seen.has(rowKey)) {
                    r.remove();
                } else if (rowKey) {
                    seen.add(rowKey);
                }
            });
        }
    } catch (e) { }
}

function saveAllMovementTables() {
    saveTableToStorage('stock-in-tbody', 'inventory_stock_in_table_v2');
    saveTableToStorage('stock-out-tbody', 'inventory_stock_out_table_v2');
    saveTableToStorage('adj-tbody', 'inventory_adj_table_v2');
    saveTableToStorage('stock-tbody', 'inventory_stock_table_v2');
}
window.saveAllMovementTables = saveAllMovementTables;

function loadAllMovementTables() {
    loadTableFromStorage('stock-in-tbody', 'inventory_stock_in_table_v2');
    loadTableFromStorage('stock-out-tbody', 'inventory_stock_out_table_v2');
    loadTableFromStorage('adj-tbody', 'inventory_adj_table_v2');
    loadTableFromStorage('stock-tbody', 'inventory_stock_table_v2');
}
window.loadAllMovementTables = loadAllMovementTables;

function updateDashboardStats() {
    const setStat = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    const stockRows = Array.from(document.querySelectorAll('#stock-tbody tr')).filter(r => {
        const name = r.cells[1]?.textContent.trim();
        return name && name !== '' && name !== '-';
    });

    // 1. Calculate Total Stock In directly from Product Stock table
    let totalStockIn = 0;
    stockRows.forEach(tr => {
        const qtyInCell = tr.cells[3]; // Qty In is column 3 on Product Stock
        if (qtyInCell) {
            totalStockIn += parseInt(qtyInCell.textContent.replace(/,/g, '').trim(), 10) || 0;
        }
    });

    // 2. Calculate Total Stock Out (from Stock Out table if logged, or from Product Stock table)
    let totalStockOut = 0;
    const stockOutRows = Array.from(document.querySelectorAll('#stock-out-tbody tr')).filter(r => {
        const name = r.cells[1]?.textContent.trim();
        return name && name !== '' && name !== '-';
    });

    if (stockOutRows.length > 0) {
        stockOutRows.forEach(tr => {
            const qtyOutCell = tr.cells[3]; // Qty Out on Stock Out table
            if (qtyOutCell) {
                totalStockOut += parseInt(qtyOutCell.textContent.replace(/,/g, '').trim(), 10) || 0;
            }
        });
    } else {
        stockRows.forEach(tr => {
            const qtyOutCell = tr.cells[4]; // Qty Out on Product Stock table
            if (qtyOutCell) {
                totalStockOut += parseInt(qtyOutCell.textContent.replace(/,/g, '').trim(), 10) || 0;
            }
        });
    }

    // 3. Calculate Low Stock, Out of Stock, and Total Balance
    let lowStockCount = 0;
    let totalBalance = 0;
    stockRows.forEach(tr => {
        const balCell = tr.cells[5];
        const statusCell = tr.cells[7];
        const bal = balCell ? (parseInt(balCell.textContent.replace(/,/g, '').trim(), 10) || 0) : 0;
        const statusText = statusCell ? statusCell.textContent.toLowerCase() : '';
        totalBalance += bal;

        if (bal <= 0 || statusText.includes('out')) {
            // Keep this as a count for the status panel only.
        } else if (bal <= 20 || statusText.includes('low')) {
            lowStockCount++;
        }
    });
    setStat('dash-low-stock', lowStockCount.toString());
    // 4. Count Total Unique Products
    let totalProducts = 0;
    if (Array.isArray(window._allMasterProducts) && window._allMasterProducts.length > 0) {
        totalProducts = window._allMasterProducts.length;
    } else {
        const prodRows = document.querySelectorAll('#products-tbody tr[data-product-id]');
        if (prodRows.length > 0) {
            totalProducts = prodRows.length;
        } else {
            totalProducts = stockRows.length;
        }
    }

    // 5. Update UI Stat Cards
    setStat('dash-stock-in', totalStockIn.toLocaleString());
    setStat('dash-stock-out', totalStockOut.toLocaleString());
    setStat('dash-total-products', totalProducts.toLocaleString());
    setStat('dash-low-stock', lowStockCount.toString());
    // Calculate current net Total Value on hand (Balance * Price)
    let totalValue = 0;
    stockRows.forEach(tr => {
        const costCell = tr.cells[6]; // product_stock Cost column
        if (costCell) {
            totalValue += parseFloat(costCell.textContent.replace(/[^0-9.]/g, '')) || 0;
        }
    });
    setStat('dash-total-value', totalValue > 0 ? `BND ${totalValue.toLocaleString()}` : `${totalBalance.toLocaleString()} units`);

    // 6. Update Movement Chart live data if initialized
    if (typeof renderDashboardMovementChart === 'function') {
        renderDashboardMovementChart();
    }

    // 7. Update Dashboard Recent Activity & Product Status widgets
    renderDashboardRecentActivity();
    renderDashboardProductStatus();
}
window.updateDashboardStats = updateDashboardStats;

function renderDashboardRecentActivity() {
    const listEl = document.getElementById('dash-recent-activity-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    const logs = Array.isArray(_auditLogs) && _auditLogs.length > 0
        ? _auditLogs.slice(0, 6)
        : [];

    if (logs.length === 0) {
        listEl.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;font-size:0.85rem;">No recent activities logged yet.</div>';
        return;
    }

    logs.forEach(log => {
        const badgeClass = log.module === 'Stock In' ? 'badge-in'
            : log.module === 'Stock Out' ? 'badge-out'
                : log.module === 'Adjustments' ? 'badge-adj'
                    : 'badge-in';

        const item = document.createElement('div');
        item.className = 'activity-item';
        item.innerHTML = `
            <div class="activity-left">
                <div class="activity-name">${escapeHtml(log.recordName || log.module || 'Inventory Record')}</div>
                <div class="activity-meta">${escapeHtml(log.recordId ? log.recordId + '  ' : '')}${escapeHtml(log.timestamp)}  ${escapeHtml(log.user || 'Admin')}</div>
            </div>
            <div class="activity-right">
                <span class="badge ${badgeClass}">${escapeHtml(log.module || log.action)}</span>
            </div>
        `;
        listEl.appendChild(item);
    });
}
window.renderDashboardRecentActivity = renderDashboardRecentActivity;

// ---- Shared Status Badge Renderer ----
if (typeof window.getProductStatusBadge !== 'function') {
    window.getProductStatusBadge = function getProductStatusBadge(status) {
        let s = String(status ?? 'In Stock').trim() || 'In Stock';
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
    };
}


/**
 * Compute stock status from balance, but PRESERVE manual statuses.
 * Manual statuses (Issued, Under Repair, Disposed) are never overwritten by balance calc.
 * Only auto-statuses (In Stock, Low Stock, Out of Stock) are recomputed from balance.
 *
 * @param {number} balance
 * @param {string} existingStatus - current status stored in DB or DOM
 * @returns {string}
 */
function normalizeStatus(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const lower = raw.toLowerCase();
    if (lower === 'available' || lower === 'in stock') return 'In Stock';
    if (lower === 'low stock') return 'Low Stock';
    if (lower === 'out of stock') return 'Out of Stock';
    if (lower === 'under repair') return 'Under Repair';
    if (lower === 'issued') return 'Issued';
    if (lower === 'disposed') return 'Disposed';
    return raw;
}
window.normalizeStatus = normalizeStatus;

function computeStockStatus(balance, existingStatus = '') {
    const numericBalance = Math.max(0, toInteger(balance));
    const currentStatus = normalizeStatus(existingStatus);
    if (currentStatus) return currentStatus;
    // Only derive from balance when the row has no persisted status at all.
    return numericBalance <= 0 ? 'Out of Stock' : numericBalance <= 20 ? 'Low Stock' : 'In Stock';
}
window.computeStockStatus = computeStockStatus;

function resolveEffectiveStatus(balance, savedStatus = '') {
    const explicit = normalizeStatus(savedStatus);
    if (explicit) return explicit;
    return computeStockStatus(balance, '');
}
window.resolveEffectiveStatus = resolveEffectiveStatus;



function renderDashboardProductStatus() {
    const listEl = document.getElementById('dash-product-status-list');
    if (!listEl) return;

    const stockRows = Array.from(document.querySelectorAll('#stock-tbody tr')).filter(r => {
        const name = r.cells[1]?.textContent.trim();
        return name && name !== '' && name !== '-';
    });

    let inStock = 0;
    let lowStock = 0;
    let outOfStock = 0;
    let underRepair = 0;
    let issued = 0;
    let disposed = 0;

    stockRows.forEach(tr => {
        const balCell = tr.cells[5];
        const statusCell = tr.cells[7];
        const bal = balCell ? (parseInt(balCell.textContent.replace(/,/g, '').trim(), 10) || 0) : 0;
        const statusText = statusCell ? statusCell.textContent.toLowerCase() : '';

        if (statusText.includes('repair')) {
            underRepair++;
        } else if (statusText.includes('issued')) {
            issued++;
        } else if (statusText.includes('disposed')) {
            disposed++;
        } else if (bal <= 0 || statusText.includes('out')) {
            outOfStock++;
        } else if (bal <= 20 || statusText.includes('low')) {
            lowStock++;
        } else {
            inStock++;
        }
    });

    let html = `
        <div class="activity-item">
            <div class="activity-left">
                <div class="activity-name">In Stock</div>
                <div class="activity-meta">${inStock} ${inStock === 1 ? 'item' : 'items'}</div>
            </div>
            <div class="activity-right">
                <span class="badge badge-in">Normal</span>
            </div>
        </div>
        <div class="activity-item">
            <div class="activity-left">
                <div class="activity-name">Low Stock</div>
                <div class="activity-meta">${lowStock} ${lowStock === 1 ? 'item' : 'items'}</div>
            </div>
            <div class="activity-right">
                <span class="badge badge-low">Alert</span>
            </div>
        </div>
        <div class="activity-item">
            <div class="activity-left">
                <div class="activity-name">Out of Stock</div>
                <div class="activity-meta">${outOfStock} ${outOfStock === 1 ? 'item' : 'items'}</div>
            </div>
            <div class="activity-right">
                <span class="badge badge-out">Critical</span>
            </div>
        </div>
    `;
    if (underRepair > 0) {
        html += `
        <div class="activity-item">
            <div class="activity-left">
                <div class="activity-name">Under Repair</div>
                <div class="activity-meta">${underRepair} ${underRepair === 1 ? 'item' : 'items'}</div>
            </div>
            <div class="activity-right">
                <span class="badge" style="background:#fee2e2;color:#b91c1c;border:1px solid #fecaca;">Repair</span>
            </div>
        </div>`;
    }
    if (issued > 0) {
        html += `
        <div class="activity-item">
            <div class="activity-left">
                <div class="activity-name">Issued</div>
                <div class="activity-meta">${issued} ${issued === 1 ? 'item' : 'items'}</div>
            </div>
            <div class="activity-right">
                <span class="badge" style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;">Issued</span>
            </div>
        </div>`;
    }
    if (disposed > 0) {
        html += `
        <div class="activity-item">
            <div class="activity-left">
                <div class="activity-name">Disposed</div>
                <div class="activity-meta">${disposed} ${disposed === 1 ? 'item' : 'items'}</div>
            </div>
            <div class="activity-right">
                <span class="badge badge-out">Disposed</span>
            </div>
        </div>`;
    }
    listEl.innerHTML = html;
}
window.renderDashboardProductStatus = renderDashboardProductStatus;


// ======== FULL PAGE & MODAL ADD RECORD HANDLERS ========

const MAX_ATTACHMENT_SIZE = 2 * 1024 * 1024; // 2 MB (2,097,152 bytes)
window.MAX_ATTACHMENT_SIZE = MAX_ATTACHMENT_SIZE;

/**
 * Validates that an uploaded attachment does not exceed the 2 MB limit.
 * @param {File} file 
 * @returns {boolean} true if valid, false if oversized
 */
function validateAttachmentFileSize(file) {
    if (!file) return true;
    if (file.size > MAX_ATTACHMENT_SIZE) {
        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        alert(`Attachment exceeds the maximum allowed size of 2 MB.\n\nFile: "${file.name}"\nSize: ${sizeMb} MB\n\nPlease select an attachment smaller than 2 MB.`);
        return false;
    }
    return true;
}
window.validateAttachmentFileSize = validateAttachmentFileSize;

let _fullPageAttachmentBase64 = null;
let _fullPageAttachmentName = '';

function handleFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!validateAttachmentFileSize(file)) {
        e.target.value = '';
        const prev = document.getElementById('attachment-preview');
        if (prev) { prev.style.display = 'none'; prev.textContent = ''; }
        _fullPageAttachmentBase64 = null;
        _fullPageAttachmentName = '';
        return;
    }

    _fullPageAttachmentName = file.name;
    const reader = new FileReader();
    reader.onload = evt => {
        _fullPageAttachmentBase64 = evt.target.result;
        const prev = document.getElementById('attachment-preview');
        if (prev) {
            prev.style.display = 'block';
            prev.textContent = `Attached: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        }
    };
    reader.readAsDataURL(file);
}
window.handleFileSelected = handleFileSelected;

function handleEditFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!validateAttachmentFileSize(file)) {
        e.target.value = '';
        const prev = document.getElementById('ep-attachment-preview');
        if (prev) { prev.style.display = 'none'; prev.textContent = ''; }
        return;
    }

    const reader = new FileReader();
    reader.onload = evt => {
        window._editProductAttachmentBase64 = evt.target.result;
        window._editProductAttachmentName = file.name;
        const prev = document.getElementById('ep-attachment-preview');
        if (prev) {
            prev.style.display = 'block';
            prev.textContent = `Attached: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        }
    };
    reader.readAsDataURL(file);
}
window.handleEditFileSelected = handleEditFileSelected;

function _parseLinkedProductId(val) {
    if (!val) return null;
    const num = parseInt(val, 10);
    return isNaN(num) ? null : num;
}

function _requireDbSuccess(result, operation) {
    if (result?.error) {
        const message = result.error.message || JSON.stringify(result.error);
        throw new Error(`${operation}: ${message}`);
    }
    return result;
}

async function saveFullPageRecord() {
    const stockId = getElementValue('full-stock-id');
    const category = getElementValue('full-category');
    const productName = getElementValue('full-product-name');
    const linkedProductId = _parseLinkedProductId(document.getElementById('full-linked-product')?.value);

    if (!stockId || !productName || !category) {
        alert('Please fill in Stock ID, Product Name, and Category.');
        return;
    }

    // New records always start with 0 stock (Out of Stock)
    // Stock additions must be logged through the Stock In page
    const qtyIn = 0;
    const qtyOut = 0;
    const balance = 0;
    const status = 'Out of Stock';
    const badgeClass = 'badge-out';
    const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });

    const attachHtml = _buildAttachmentCellHtml(_fullPageAttachmentBase64, _fullPageAttachmentName);

    // Persist to Supabase product_stock table.
    // Keep derived balance in JS only; schema does not allow writing it directly here.
    let insertedId = null;
    if (typeof sbInsert === 'function') {
        const res = await sbInsert(PRODUCT_STOCK_TABLE, {
            stock_id: stockId,
            product_name: productName,
            category: category,
            qty_in: qtyIn,
            qty_out: qtyOut,
            status: status,
            attachment_id: _fullPageAttachmentBase64 ? JSON.stringify({ name: _fullPageAttachmentName, data: _fullPageAttachmentBase64 }) : null,
            product_id: linkedProductId || null
        });
        if (res.data) insertedId = res.data.id;
        if (res?.error) {
            console.warn('Product Stock save error:', res.error.message || res.error);
            alert('Failed to save record to database: ' + (res.error.message || JSON.stringify(res.error)) + '\n\nIt will not persist after refresh.');
            return;
        }
    }

    const tbody = document.getElementById('stock-tbody');
    if (tbody) {
        const tr = document.createElement('tr');
        tr.dataset.id = insertedId;
        tr.innerHTML = `
            <td class="cell-muted">${escapeHtml(stockId)}</td>
            <td class="cell-bold">${escapeHtml(productName)}</td>
            <td class="cell-muted">${escapeHtml(category)}</td>
            <td class="cell-qty-in">${qtyIn}</td>
            <td class="cell-qty-out">${qtyOut}</td>
            <td>${balance}</td>
            <td class="cell-muted">—</td>
            <td><span class="badge ${badgeClass}">${status}</span></td>
            <td>${attachHtml}</td>
            <td class="cell-muted">${now}</td>
            <td><button class="dots-btn" title="More" onclick="openStockMenu(this)"><i class="ph ph-dots-three"></i></button></td>
        `;
        tbody.insertBefore(tr, tbody.firstChild);
    }

    logAudit('Added', 'Product Stock', `${getCurrentUser()} created Stock record "${productName}" (ID: ${stockId}) [Out of Stock - initial registration]`, stockId, productName);

    saveAllMovementTables();
    updateDashboardStats();
    // Reset full form
    const form = document.getElementById('fullAddRecordForm');
    if (form) form.reset();
    _fullPageAttachmentBase64 = null;
    _fullPageAttachmentName = '';
    const prev = document.getElementById('attachment-preview');
    if (prev) prev.style.display = 'none';

    document.getElementById('stock-empty')?.classList.add('hidden');
    navigateToPage('product-stock');
}
window.saveFullPageRecord = saveFullPageRecord;

function openAddRecordModal() {
    _editingStockRow = null;
    const modal = document.getElementById('add-record-modal');
    if (modal) {
        modal.classList.remove('hidden');
        document.getElementById('modal-stock-id').value = '';
        document.getElementById('modal-product-name').value = '';
        document.getElementById('modal-company').value = '';
        document.getElementById('modal-qty-in').value = '0';
        document.getElementById('modal-qty-out').value = '0';
        if (typeof window.populateLinkedProductDropdowns === 'function') window.populateLinkedProductDropdowns();
    }
}
window.openAddRecordModal = openAddRecordModal;

function closeAddRecordModal() {
    const modal = document.getElementById('add-record-modal');
    if (modal) modal.classList.add('hidden');
}
window.closeAddRecordModal = closeAddRecordModal;

function closeModalOnOverlay(e) {
    if (e.target === document.getElementById('add-record-modal')) closeAddRecordModal();
}
window.closeModalOnOverlay = closeModalOnOverlay;

async function saveRecord() {
    const stockId = getElementValue('modal-stock-id');
    const productName = getElementValue('modal-product-name');
    const category = getElementValue('modal-company');
    const qtyIn = Math.max(0, toInteger(document.getElementById('modal-qty-in')?.value));
    const qtyOut = Math.max(0, toInteger(document.getElementById('modal-qty-out')?.value));

    if (!stockId || !productName || !category) {
        alert('Please fill in Stock ID, Product Name, and Category.');
        return;
    }

    const balance = Math.max(0, qtyIn - qtyOut);
    const status = computeStockStatus(balance, '');
    const badgeClass = status === 'In Stock' ? 'badge-in' : status === 'Low Stock' ? 'badge-low' : 'badge-out';
    const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
    let insertedId = null;
    if (typeof sbUpsertByStockId === 'function') {
        const payload = {
            stock_id: stockId,
            product_name: productName,
            category: category,
            qty_in: qtyIn,
            qty_out: qtyOut,
            status: status,
            attachment_id: null,
            product_id: null
        };
        const res = await sbUpsertByStockId(PRODUCT_STOCK_TABLE, payload);
        if (res.data) insertedId = res.data.id;
        if (res?.error) {
            console.warn('Product Stock modal save error:', res.error.message || res.error);
            alert('Failed to save record to database: ' + (res.error.message || JSON.stringify(res.error)) + '\n\nIt will not persist after refresh.');
        }
    } else if (typeof sbInsert === 'function') {
        const res = await sbInsert(PRODUCT_STOCK_TABLE, {
            stock_id: stockId,
            product_name: productName,
            category: category,
            qty_in: qtyIn,
            qty_out: qtyOut,
            status: status,
            attachment_id: null,
            product_id: null
        });
        if (res.data) insertedId = res.data.id;
        if (res?.error) {
            console.warn('Product Stock modal save error:', res.error.message || res.error);
            alert('Failed to save record to database: ' + (res.error.message || JSON.stringify(res.error)) + '\n\nIt will not persist after refresh.');
            return;
        }
    }

    const tbody = document.getElementById('stock-tbody');
    if (tbody) {
        const tr = document.createElement('tr');
        if (insertedId) tr.dataset.id = insertedId;
        tr.innerHTML = `
            <td class="cell-muted">${escapeHtml(stockId)}</td>
            <td class="cell-bold">${escapeHtml(productName)}</td>
            <td class="cell-muted">${escapeHtml(category)}</td>
            <td class="cell-qty-in">${qtyIn}</td>
            <td class="cell-qty-out">${qtyOut}</td>
            <td>${balance}</td>
            <td class="cell-muted">—</td>
            <td><span class="badge ${badgeClass}">${status}</span></td>
            <td><span class="cell-muted"></span></td>
            <td class="cell-muted">${now}</td>
            <td><button class="dots-btn" title="More" onclick="openStockMenu(this)"><i class="ph ph-dots-three"></i></button></td>
        `;
        tbody.insertBefore(tr, tbody.firstChild);
    }

    logAudit('Added', 'Product Stock', `${getCurrentUser()} added Stock record "${productName}" (ID: ${stockId}) [In: ${qtyIn}, Out: ${qtyOut}, Bal: ${balance}]`, stockId, productName);

    saveAllMovementTables();
    updateDashboardStats();
    closeAddRecordModal();
    document.getElementById('stock-empty')?.classList.add('hidden');
}
window.saveRecord = saveRecord;



// ======== 3. DASHBOARD CHARTS ENGINE ========

let _dashMovementChart = null;
let _dashCategoryChart = null;
let _chartInitRetries = 0;

async function initDashboardCharts() {
    if (typeof Chart === 'undefined') {
        if (_chartInitRetries++ < 20) {
            setTimeout(initDashboardCharts, 150);
        } else {
            console.warn('Chart.js not loaded after max retries  charts skipped.');
        }
        return;
    }
    _chartInitRetries = 0;

    const moveCtx = document.getElementById('dashMovementChart');
    const catCtx = document.getElementById('dashCategoryChart');
    if (!moveCtx || !catCtx) return;

    // Calculate current live numbers for the chart
    const inVal = parseInt((document.getElementById('dash-stock-in')?.textContent || '150').replace(/,/g, '')) || 150;
    const outVal = parseInt((document.getElementById('dash-stock-out')?.textContent || '75').replace(/,/g, '')) || 75;
    const maxVal = Math.max(inVal, outVal, 100);

    // 1. Stock Movement Chart (shows product name by default, with monthly toggle)
    renderDashboardMovementChart();

    // 2. Value by Category Donut Chart (dynamic)
    const catData = await buildCategoryDonut();
    if (_dashCategoryChart) {
        _dashCategoryChart.destroy();
        _dashCategoryChart = null;
    }
    _dashCategoryChart = new Chart(catCtx, {
        type: 'doughnut',
        data: catData,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '70%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 10,
                        font: { size: 11, family: 'Inter' }
                    }
                }
            }
        }
    });
}
window.initDashboardCharts = initDashboardCharts;

/**
 * Renders the Stock Movement Chart on the Dashboard.
 * Defaults to "By Product" mode showing canonical product names on the X-axis,
 * with a toggle to switch to "Last 6 Months" timeline view.
 */
function renderDashboardMovementChart() {
    if (typeof Chart === 'undefined') return;
    const moveCtx = document.getElementById('dashMovementChart');
    if (!moveCtx) return;

    const filterEl = document.getElementById('dash-movement-filter');
    const viewMode = filterEl ? filterEl.value : 'by-product';

    const titleEl = document.getElementById('dash-movement-title');
    if (titleEl) {
        titleEl.textContent = viewMode === 'by-product' ? 'Stock Movement by Product' : 'Stock Movement (Last 6 Months)';
    }

    // Similarity matcher to cluster typos/variants under canonical names
    const isSimilar = typeof window.isSimilarProductName === 'function'
        ? window.isSimilarProductName
        : (typeof isSimilarProductName === 'function'
            ? isSimilarProductName
            : (a, b) => a.toLowerCase().trim() === b.toLowerCase().trim());

    // Gather rows from #stock-tbody
    let stockRows = Array.from(document.querySelectorAll('#stock-tbody tr')).filter(r => {
        const name = r.cells[1]?.textContent.trim();
        return name && name !== '' && name !== '-';
    });

    if (stockRows.length === 0) {
        try {
            const cached = localStorage.getItem('inventory_stock_table_v2');
            if (cached) {
                const temp = document.createElement('tbody');
                temp.innerHTML = cached;
                stockRows = Array.from(temp.querySelectorAll('tr')).filter(r => {
                    const name = r.cells[1]?.textContent.trim();
                    return name && name !== '' && name !== '-';
                });
            }
        } catch (e) { }
    }

    // Cluster product stock movements by canonical name
    const productMap = [];

    stockRows.forEach(r => {
        const rawName = r.cells[1]?.textContent.trim() || 'Product';
        const qtyIn = parseInt(r.cells[3]?.textContent.replace(/,/g, '').trim(), 10) || 0;
        const qtyOut = parseInt(r.cells[4]?.textContent.replace(/,/g, '').trim(), 10) || 0;

        let entry = productMap.find(item => isSimilar(item.name, rawName));
        if (!entry) {
            entry = { name: rawName, qtyIn: 0, qtyOut: 0 };
            productMap.push(entry);
        } else {
            // Pick better/cleaner canonical name
            if ((rawName.length > entry.name.length && /^[A-Z]/.test(rawName)) ||
                (!/^[A-Z]/.test(entry.name) && /^[A-Z]/.test(rawName))) {
                entry.name = rawName;
            }
        }
        entry.qtyIn += qtyIn;
        entry.qtyOut += qtyOut;
    });

    // If no products found in stockRows, check stock-in and stock-out tables
    if (productMap.length === 0) {
        const stockInRows = Array.from(document.querySelectorAll('#stock-in-tbody tr')).filter(r => {
            const name = r.cells[1]?.textContent.trim();
            return name && name !== '' && name !== '-';
        });
        const stockOutRows = Array.from(document.querySelectorAll('#stock-out-tbody tr')).filter(r => {
            const name = r.cells[1]?.textContent.trim();
            return name && name !== '' && name !== '-';
        });

        stockInRows.forEach(r => {
            const rawName = r.cells[1]?.textContent.trim() || 'Product';
            const qty = parseInt(r.cells[3]?.textContent.replace(/,/g, '').trim(), 10) || 0;
            let entry = productMap.find(item => isSimilar(item.name, rawName));
            if (!entry) {
                entry = { name: rawName, qtyIn: 0, qtyOut: 0 };
                productMap.push(entry);
            }
            entry.qtyIn += qty;
        });

        stockOutRows.forEach(r => {
            const rawName = r.cells[1]?.textContent.trim() || 'Product';
            const qty = parseInt(r.cells[3]?.textContent.replace(/,/g, '').trim(), 10) || 0;
            let entry = productMap.find(item => isSimilar(item.name, rawName));
            if (!entry) {
                entry = { name: rawName, qtyIn: 0, qtyOut: 0 };
                productMap.push(entry);
            }
            entry.qtyOut += qty;
        });
    }

    // Fallback if still empty: read numbers from summary cards
    if (productMap.length === 0) {
        const inVal = parseInt((document.getElementById('dash-stock-in')?.textContent || '0').replace(/,/g, '')) || 0;
        const outVal = parseInt((document.getElementById('dash-stock-out')?.textContent || '0').replace(/,/g, '')) || 0;
        if (inVal > 0 || outVal > 0) {
            productMap.push({ name: 'Biometric kiosk', qtyIn: inVal, qtyOut: outVal });
        }
    }

    let chartLabels = [];
    let inSeries = [];
    let outSeries = [];
    let tooltipCallbacks = {};

    if (viewMode === 'by-product') {
        // Sort products by total movement volume descending
        productMap.sort((a, b) => (b.qtyIn + b.qtyOut) - (a.qtyIn + a.qtyOut));
        const displayProducts = productMap.slice(0, 10);

        chartLabels = displayProducts.map(p => p.name);
        inSeries = displayProducts.map(p => p.qtyIn);
        outSeries = displayProducts.map(p => p.qtyOut);

        tooltipCallbacks = {
            title: function (tooltipItems) {
                return tooltipItems[0]?.label || '';
            },
            label: function (context) {
                const label = context.dataset.label || '';
                const val = context.parsed.y || 0;
                return ` ${label}: ${val.toLocaleString()} units`;
            }
        };
    } else {
        // 'by-month' (Last 6 Months)
        const nowDt = new Date();
        const monthLabels = [];
        for (let i = 5; i >= 0; i--) {
            const d = new Date(nowDt.getFullYear(), nowDt.getMonth() - i, 1);
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            monthLabels.push(`${y}-${m}`);
        }
        chartLabels = monthLabels;

        const totalIn = productMap.reduce((s, p) => s + p.qtyIn, 0);
        const totalOut = productMap.reduce((s, p) => s + p.qtyOut, 0);

        inSeries = monthLabels.map((lbl, idx) => (idx === monthLabels.length - 1 ? totalIn : 0));
        outSeries = monthLabels.map((lbl, idx) => (idx === monthLabels.length - 1 ? totalOut : 0));

        tooltipCallbacks = {
            title: function (tooltipItems) {
                return `${tooltipItems[0]?.label || ''}`;
            },
            label: function (context) {
                const label = context.dataset.label || '';
                const val = context.parsed.y || 0;
                return ` ${label}: ${val.toLocaleString()} units`;
            },
            afterBody: function () {
                if (productMap.length > 0) {
                    return ['', 'Products:', ...productMap.map(p => ` • ${p.name} (In: ${p.qtyIn}, Out: ${p.qtyOut})`)];
                }
                return [];
            }
        };
    }

    const allVals = [...inSeries, ...outSeries];
    const maxVal = Math.max(...allVals, 50);

    if (_dashMovementChart) {
        _dashMovementChart.destroy();
        _dashMovementChart = null;
    }

    _dashMovementChart = new Chart(moveCtx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                {
                    label: 'Stock In',
                    data: inSeries,
                    backgroundColor: '#14162e',
                    borderRadius: 4,
                    barPercentage: chartLabels.length > 4 ? 0.7 : 0.45,
                    categoryPercentage: chartLabels.length > 4 ? 0.7 : 0.5
                },
                {
                    label: 'Stock Out',
                    data: outSeries,
                    backgroundColor: '#2563eb',
                    borderRadius: 4,
                    barPercentage: chartLabels.length > 4 ? 0.7 : 0.45,
                    categoryPercentage: chartLabels.length > 4 ? 0.7 : 0.5
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: tooltipCallbacks,
                    padding: 10,
                    boxPadding: 4,
                    titleFont: { weight: '600', size: 13 },
                    bodyFont: { size: 12 }
                }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: {
                        color: '#475569',
                        font: { weight: '600', size: 12 },
                        maxRotation: 20,
                        minRotation: 0,
                        callback: function (val, index) {
                            const label = this.getLabelForValue(val);
                            if (typeof label === 'string' && label.length > 24) {
                                return label.substring(0, 22) + '...';
                            }
                            return label;
                        }
                    }
                },
                y: {
                    min: 0,
                    max: Math.ceil((maxVal * 1.2) / 20) * 20,
                    ticks: {
                        stepSize: Math.max(20, Math.ceil((maxVal * 1.2) / 80) * 20),
                        color: '#64748b'
                    },
                    grid: { color: '#f1f5f9' }
                }
            }
        }
    });
}
window.renderDashboardMovementChart = renderDashboardMovementChart;

// Value by Category Donut Chart (dynamic, aggregates product_stock)
async function buildCategoryDonut() {
    if (typeof sbSelectAll !== 'function') {
        return {
            labels: ['Electronics', 'Furniture', 'Office Supplies', 'General'],
            datasets: [{ data: [58, 31, 11, 0], backgroundColor: ['#14162e', '#2563eb', '#10b981', '#f97316'] }]
        };
    }
    const { data: ps } = await sbSelectAll(PRODUCT_STOCK_TABLE);
    const agg = {};
    ps?.forEach(p => {
        const name = (p.category || p.product_name || 'General').trim() || 'General';
        const currentBalance = Number.isFinite(Number(p.balance))
            ? Number(p.balance)
            : Math.max(0, (Number(p.qty_in) || 0) - (Number(p.qty_out) || 0));
        agg[name] = (agg[name] || 0) + Math.max(0, currentBalance);
    });
    const labels = Object.keys(agg);
    const data = Object.values(agg);
    if (labels.length === 0) {
        return {
            labels: ['Electronics', 'Furniture', 'Office Supplies', 'General'],
            datasets: [{
                data: [58, 31, 11, 0],
                backgroundColor: ['#14162e', '#2563eb', '#10b981', '#f97316']
            }]
        };
    }
    return {
        labels,
        datasets: [{
            data,
            backgroundColor: [
                '#14162e', '#2563eb', '#10b981', '#f97316',
                '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'
            ].slice(0, labels.length)
        }]
    };
}

// ======== 3. REPORTS PAGE ENGINE & DYNAMIC CHARTS ========

let _barChart = null;
let _donutChart = null;
let _statusChart = null;
let _currentReportTab = 'current-stock';

const REPORT_CATEGORY_COLORS = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
    '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#6366f1'
];

function getDynamicReportData(tabKey = 'current-stock') {
    const parseRowData = (tr, sidIdx, nameIdx, catIdx, qtyIdx, priceIdx) => {
        const sid = tr.cells[sidIdx]?.textContent.trim() || '—';
        let name = tr.cells[nameIdx]?.textContent.trim() || '';
        let cat = tr.cells[catIdx]?.textContent.trim() || 'General';
        const qtyText = tr.cells[qtyIdx]?.textContent.replace(/,/g, '').trim() || '0';
        const qty = parseInt(qtyText, 10) || 0;
        const priceText = priceIdx !== undefined ? (tr.cells[priceIdx]?.textContent.replace(/BND|,/g, '').trim() || '0') : '0';
        const price = parseFloat(priceText) || 0;

        if (!name || name === '—' || name === '-') {
            name = sid !== '—' ? sid : 'Unnamed Product';
        }
        if (!cat || cat === '—' || cat === '-') {
            cat = 'General';
        }
        return { sid, name, cat, qty, price };
    };

    const isValidDataRow = (tr) => {
        return tr && tr.cells && tr.cells.length >= 4 && !tr.querySelector('td[colspan]');
    };

    if (tabKey === 'current-stock') {
        const items = [];
        const catMap = {};
        let totalItems = 0;

        const stockRows = Array.from(document.querySelectorAll('#stock-tbody tr')).filter(isValidDataRow);

        if (stockRows.length > 0) {
            stockRows.forEach(tr => {
                const row = parseRowData(tr, 0, 1, 2, 5);
                const bal = row.qty;
                const costCell = tr.cells[6];
                const costVal = parseFloat(costCell?.textContent.replace(/[^0-9.]/g, '')) || 0;
                const unitPrice = bal > 0 && costVal > 0 ? Math.round(costVal / bal) : 0;
                items.push({
                    name: row.name,
                    sku: row.sid,
                    category: row.cat,
                    qty: bal,
                    unitPrice: unitPrice,
                    totalVal: costVal
                });
                catMap[row.cat] = (catMap[row.cat] || 0) + bal;
                totalItems += bal;
            });
        } else if (Array.isArray(window._allMasterProducts) && window._allMasterProducts.length > 0) {
            window._allMasterProducts.forEach(p => {
                const tag = (p.client_tag_number || p.serial_number || '—').trim();
                const name = (p.item_name || tag || 'Item').trim();
                const cat = (p.category || 'General').trim();
                const bal = (window._stockBalanceMap && tag && window._stockBalanceMap[tag.toLowerCase()] !== undefined)
                    ? window._stockBalanceMap[tag.toLowerCase()]
                    : (p.status === 'In Stock' ? 1 : 0);

                items.push({
                    name: name,
                    sku: tag,
                    category: cat,
                    qty: bal,
                    unitPrice: 0,
                    totalVal: 0
                });
                catMap[cat] = (catMap[cat] || 0) + bal;
                totalItems += bal;
            });
        }

        items.sort((a, b) => b.qty - a.qty);
        const topItems = items.slice(0, 8);

        const catKeys = Object.keys(catMap);
        const totalCatQty = Object.values(catMap).reduce((a, b) => a + b, 0) || 1;
        const donutLabels = catKeys.length
            ? catKeys.map(c => `${c} (${Math.round((catMap[c] / totalCatQty) * 100)}%)`)
            : ['No Stock (0%)'];
        const donutData = catKeys.length ? catKeys.map(c => catMap[c]) : [1];

        return {
            barTitle: 'Top Products by Current Stock Quantity',
            barLabels: topItems.length ? topItems.map(i => [i.name, i.sku]) : ['No Products'],
            barData: topItems.length ? topItems.map(i => i.qty) : [0],
            barUnit: '',
            donutLabels: donutLabels,
            donutData: donutData,
            donutColors: REPORT_CATEGORY_COLORS.slice(0, Math.max(1, catKeys.length)),
            items: items,
            summaryText: `Total Current Stock: ${totalItems.toLocaleString()} items across ${items.length} product(s)`
        };
    } else if (tabKey === 'stock-in') {
        const productAggMap = {};
        const catMap = {};
        let totalIn = 0;

        const fromDate = document.getElementById('report-from-date')?.value || '';
        const toDate = document.getElementById('report-to-date')?.value || '';

        const siRows = Array.from(document.querySelectorAll('#stock-in-tbody tr')).filter(isValidDataRow);
        const sourceRows = siRows.length > 0 ? siRows : Array.from(document.querySelectorAll('#stock-tbody tr')).filter(isValidDataRow);

        sourceRows.forEach(tr => {
            if (fromDate || toDate) {
                const dateStr = tr.dataset.createdAt || tr.dataset.followupDate || '';
                if (dateStr) {
                    const d = parseDateToYMD(dateStr);
                    if (d && fromDate && d < fromDate) return;
                    if (d && toDate && d > toDate) return;
                }
            }

            const qtyCol = siRows.length > 0 ? 3 : 3;
            const row = parseRowData(tr, 0, 1, 2, qtyCol, siRows.length > 0 ? 5 : undefined);
            if (row.qty <= 0) return;

            const key = `${row.name}__${row.sid}`;
            if (!productAggMap[key]) {
                productAggMap[key] = { name: row.name, sku: row.sid, category: row.cat, qty: 0, unitPrice: row.price };
            }
            productAggMap[key].qty += row.qty;
            catMap[row.cat] = (catMap[row.cat] || 0) + row.qty;
            totalIn += row.qty;
        });

        const items = Object.values(productAggMap).sort((a, b) => b.qty - a.qty);
        const topItems = items.slice(0, 8);

        const catKeys = Object.keys(catMap);
        const totalCatQty = Object.values(catMap).reduce((a, b) => a + b, 0) || 1;
        const donutLabels = catKeys.length
            ? catKeys.map(c => `${c} (${Math.round((catMap[c] / totalCatQty) * 100)}%)`)
            : ['No Stock In (0%)'];
        const donutData = catKeys.length ? catKeys.map(c => catMap[c]) : [1];

        return {
            barTitle: 'Top Products by Stock In Quantity',
            barLabels: topItems.length ? topItems.map(i => [i.name, i.sku]) : ['No Stock In Recorded'],
            barData: topItems.length ? topItems.map(i => i.qty) : [0],
            barUnit: '',
            donutLabels: donutLabels,
            donutData: donutData,
            donutColors: REPORT_CATEGORY_COLORS.slice(0, Math.max(1, catKeys.length)),
            items: items,
            summaryText: `Total Stock In: ${totalIn.toLocaleString()} items received`
        };
    } else if (tabKey === 'stock-out') {
        const productAggMap = {};
        const catMap = {};
        let totalOut = 0;

        const fromDate = document.getElementById('report-from-date')?.value || '';
        const toDate = document.getElementById('report-to-date')?.value || '';

        const soRows = Array.from(document.querySelectorAll('#stock-out-tbody tr')).filter(isValidDataRow);
        const sourceRows = soRows.length > 0 ? soRows : Array.from(document.querySelectorAll('#stock-tbody tr')).filter(isValidDataRow);

        sourceRows.forEach(tr => {
            if (fromDate || toDate) {
                const dateStr = tr.dataset.createdAt || tr.cells[6]?.textContent.trim() || '';
                if (dateStr) {
                    const d = parseDateToYMD(dateStr);
                    if (d && fromDate && d < fromDate) return;
                    if (d && toDate && d > toDate) return;
                }
            }

            const qtyCol = soRows.length > 0 ? 3 : 4;
            const row = parseRowData(tr, 0, 1, 2, qtyCol);
            if (row.qty <= 0) return;

            const key = `${row.name}__${row.sid}`;
            if (!productAggMap[key]) {
                productAggMap[key] = { name: row.name, sku: row.sid, category: row.cat, qty: 0 };
            }
            productAggMap[key].qty += row.qty;
            catMap[row.cat] = (catMap[row.cat] || 0) + row.qty;
            totalOut += row.qty;
        });

        const items = Object.values(productAggMap).sort((a, b) => b.qty - a.qty);
        const topItems = items.slice(0, 8);

        const catKeys = Object.keys(catMap);
        const totalCatQty = Object.values(catMap).reduce((a, b) => a + b, 0) || 1;
        const donutLabels = catKeys.length
            ? catKeys.map(c => `${c} (${Math.round((catMap[c] / totalCatQty) * 100)}%)`)
            : ['No Stock Out (0%)'];
        const donutData = catKeys.length ? catKeys.map(c => catMap[c]) : [1];

        return {
            barTitle: 'Top Products by Stock Out Quantity',
            barLabels: topItems.length ? topItems.map(i => [i.name, i.sku]) : ['No Stock Out Recorded'],
            barData: topItems.length ? topItems.map(i => i.qty) : [0],
            barUnit: '',
            donutLabels: donutLabels,
            donutData: donutData,
            donutColors: REPORT_CATEGORY_COLORS.slice(0, Math.max(1, catKeys.length)),
            items: items,
            summaryText: `Total Stock Out: ${totalOut.toLocaleString()} items dispatched`
        };
    }
    return { barTitle: 'Report', barLabels: [], barData: [], barUnit: '', donutLabels: [], donutData: [], donutColors: [], items: [], summaryText: '' };
}
window.getDynamicReportData = getDynamicReportData;

function renderReportTables(tabKey = 'current-stock', reportData) {
    if (!reportData) return;

    if (tabKey === 'current-stock') {
        const tbody = document.getElementById('tbody-report-current');
        const summary = document.getElementById('report-summary-text');
        if (summary) summary.textContent = reportData.summaryText || 'Total Stock: 0 items';
        if (tbody) {
            tbody.innerHTML = '';
            if (!reportData.items || reportData.items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;"><i class="ph ph-tray" style="margin-right:6px;"></i>No current stock records found.</td></tr>';
            } else {
                reportData.items.forEach(item => {
                    const tr = document.createElement('tr');
                    const unitPriceDisplay = item.unitPrice ? `BND ${item.unitPrice.toLocaleString()}` : '—';
                    const totalValDisplay = item.totalVal ? `BND ${item.totalVal.toLocaleString()}` : (item.qty ? `${item.qty.toLocaleString()} units` : '—');
                    tr.innerHTML = `
                            <td class="cell-bold">${escapeHtml(item.name)}</td>
                            <td class="cell-muted">${escapeHtml(item.sku || '—')}</td>
                            <td class="cell-muted">${escapeHtml(item.category || 'General')}</td>
                            <td class="cell-bold">${item.qty.toLocaleString()}</td>
                            <td class="cell-muted">${unitPriceDisplay}</td>
                            <td class="cell-bold">${totalValDisplay}</td>
                        `;
                    tbody.appendChild(tr);
                });
            }
        }
    } else if (tabKey === 'stock-in') {
        const tbody = document.getElementById('tbody-report-stock-in');
        if (tbody) {
            tbody.innerHTML = '';
            if (!reportData.items || reportData.items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#94a3b8;"><i class="ph ph-tray" style="margin-right:6px;"></i>No stock in records found.</td></tr>';
            } else {
                reportData.items.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                            <td class="cell-bold">${escapeHtml(item.name)}</td>
                            <td class="cell-muted">${escapeHtml(item.sku || '—')}</td>
                            <td class="cell-muted">${escapeHtml(item.category || 'General')}</td>
                            <td class="cell-qty-in" style="font-weight:600;">+${item.qty.toLocaleString()}</td>
                        `;
                    tbody.appendChild(tr);
                });
            }
        }
    } else if (tabKey === 'stock-out') {
        const tbody = document.getElementById('tbody-report-stock-out');
        if (tbody) {
            tbody.innerHTML = '';
            if (!reportData.items || reportData.items.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:24px;color:#94a3b8;"><i class="ph ph-tray" style="margin-right:6px;"></i>No stock out records found.</td></tr>';
            } else {
                reportData.items.forEach(item => {
                    const tr = document.createElement('tr');
                    tr.innerHTML = `
                            <td class="cell-bold">${escapeHtml(item.name)}</td>
                            <td class="cell-muted">${escapeHtml(item.sku || '—')}</td>
                            <td class="cell-muted">${escapeHtml(item.category || 'General')}</td>
                            <td class="cell-qty-out" style="font-weight:600;">-${item.qty.toLocaleString()}</td>
                        `;
                    tbody.appendChild(tr);
                });
            }
        }
    }
}
window.renderReportTables = renderReportTables;

let _reportInitRetries = 0;
function initReports() {
    if (typeof Chart === 'undefined') {
        if (_reportInitRetries++ < 20) {
            setTimeout(initReports, 150);
        }
        return;
    }
    _reportInitRetries = 0;

    const barCtx = document.getElementById('reportBarChart');
    const donutCtx = document.getElementById('reportDonutChart');
    const statusCtx = document.getElementById('reportStatusChart');
    if (!barCtx || !donutCtx) return;

    const currentTab = _currentReportTab || 'current-stock';
    const data = getDynamicReportData(currentTab);
    renderReportTables(currentTab, data);

    const titleEl = document.getElementById('report-bar-title');
    if (titleEl) titleEl.textContent = data.barTitle;

    // 1. Horizontal Bar Chart
    if (_barChart) {
        try { _barChart.destroy(); } catch (e) { }
        _barChart = null;
    }
    _barChart = new Chart(barCtx, {
        type: 'bar',
        data: {
            labels: data.barLabels.map(label => formatChartLabel(label)),
            datasets: [{
                data: data.barData,
                backgroundColor: '#1e293b',
                borderRadius: 4,
                barThickness: 24
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            return (data.barUnit || '') + (ctx.raw || 0).toLocaleString();
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: '#e5e7eb' },
                    ticks: {
                        callback: function (val) {
                            return (data.barUnit || '') + val.toLocaleString();
                        }
                    }
                },
                y: {
                    grid: { display: false }
                }
            }
        }
    });

    // 2. Donut Chart
    if (_donutChart) {
        try { _donutChart.destroy(); } catch (e) { }
        _donutChart = null;
    }
    _donutChart = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
            labels: data.donutLabels,
            datasets: [{
                data: data.donutData,
                backgroundColor: data.donutColors,
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '68%',
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 10,
                        font: { size: 11, family: 'Inter' }
                    }
                }
            }
        }
    });
    // 3. Stock Status Distribution Pie Chart
    renderStatusDistributionChart();
}
window.initReports = initReports;

/**
 * Builds and/or updates the Stock Status Distribution pie chart.
 * Reads status from #stock-tbody rows (column 7 = Status badge).
 */
function renderStatusDistributionChart() {
    const ctx = document.getElementById('reportStatusChart');
    if (!ctx || typeof Chart === 'undefined') return;

    let healthy = 0, low = 0, critical = 0, repair = 0, issued = 0, disposed = 0;
    const stockRows = Array.from(document.querySelectorAll('#stock-tbody tr')).filter(tr =>
        tr.cells && tr.cells.length >= 4 && !tr.querySelector('td[colspan]')
    );

    if (stockRows.length > 0) {
        stockRows.forEach(tr => {
            const bal = parseInt((tr.cells[5]?.textContent || '0').replace(/,/g, '').trim(), 10) || 0;
            const statusText = (tr.cells[7]?.textContent || '').toLowerCase();

            if (statusText.includes('repair')) repair++;
            else if (statusText.includes('issued')) issued++;
            else if (statusText.includes('disposed')) disposed++;
            else if (bal <= 0 || statusText.includes('out') || statusText === 'critical') critical++;
            else if (bal <= 20 || statusText.includes('low')) low++;
            else healthy++;
        });
    } else if (Array.isArray(window._allMasterProducts)) {
        window._allMasterProducts.forEach(p => {
            const s = (p.status || '').toLowerCase();
            if (s.includes('repair')) repair++;
            else if (s.includes('issued')) issued++;
            else if (s.includes('disposed')) disposed++;
            else if (s.includes('out') || s === 'critical') critical++;
            else if (s.includes('low')) low++;
            else healthy++;
        });
    }

    const total = healthy + low + critical + repair + issued + disposed || 1;
    const pct = n => Math.round((n / total) * 100);

    const labels = [];
    const chartData = [];
    const colors = [];

    const addStat = (count, name, color) => {
        // Always show Healthy, Low, and Critical even if 0, but only show others if > 0
        if (count > 0 || name === 'Healthy' || name === 'Low' || name === 'Critical') {
            labels.push(`${name} ${pct(count)}%`);
            chartData.push(count);
            colors.push(color);
        }
    };

    addStat(healthy, 'Healthy', '#10b981');
    addStat(low, 'Low', '#f59e0b');
    addStat(critical, 'Critical', '#ef4444');
    addStat(repair, 'Repair', '#b91c1c');
    addStat(issued, 'Issued', '#b45309');
    addStat(disposed, 'Disposed', '#64748b');

    if (_statusChart) {
        _statusChart.data.labels = labels;
        _statusChart.data.datasets[0].backgroundColor = colors;
        _statusChart.data.datasets[0].data = chartData;
        _statusChart.update();
        return;
    }

    _statusChart = new Chart(ctx, {
        type: 'pie',
        data: {
            labels: labels,
            datasets: [{
                data: chartData,
                backgroundColor: colors,
                borderWidth: 2,
                borderColor: '#ffffff',
                hoverOffset: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        boxWidth: 12,
                        padding: 14,
                        font: { size: 12, family: 'Inter' },
                        color: '#374151'
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function (ctx) {
                            const val = ctx.raw || 0;
                            const t = ctx.chart.data.datasets[0].data.reduce((a, b) => a + b, 0) || 1;
                            return ` ${val} item${val !== 1 ? 's' : ''} (${Math.round((val / t) * 100)}%)`;
                        }
                    }
                }
            }
        }
    });
}
window.renderStatusDistributionChart = renderStatusDistributionChart;

function switchReportTab(tabKey) {
    _currentReportTab = tabKey || 'current-stock';

    // Update Tab Button States
    document.querySelectorAll('.report-tab').forEach(btn => btn.classList.remove('active'));
    const activeBtn = document.getElementById('tab-' + _currentReportTab);
    if (activeBtn) activeBtn.classList.add('active');

    // Date Filters visibility
    const dateFilters = document.getElementById('report-date-filters');
    if (dateFilters) {
        if (_currentReportTab === 'current-stock') {
            dateFilters.classList.add('hidden');
        } else {
            dateFilters.classList.remove('hidden');
        }
    }

    // Switch Table Views
    document.querySelectorAll('.report-view-table').forEach(tbl => tbl.classList.add('hidden'));
    const activeTbl = document.getElementById('report-view-' + _currentReportTab);
    if (activeTbl) activeTbl.classList.remove('hidden');

    // Update Charts & Tables
    const data = getDynamicReportData(_currentReportTab);
    renderReportTables(_currentReportTab, data);

    const titleEl = document.getElementById('report-bar-title');
    if (titleEl) titleEl.textContent = data.barTitle;

    if (!_barChart || !_donutChart) {
        initReports();
    } else {
        _barChart.data.labels = data.barLabels.map(label => formatChartLabel(label));
        _barChart.data.datasets[0].data = data.barData;
        _barChart.options.plugins.tooltip.callbacks.label = function (ctx) {
            return (data.barUnit || '') + (ctx.raw || 0).toLocaleString();
        };
        _barChart.options.scales.x.ticks.callback = function (val) {
            return (data.barUnit || '') + val.toLocaleString();
        };
        _barChart.update();

        _donutChart.data.labels = data.donutLabels;
        _donutChart.data.datasets[0].data = data.donutData;
        _donutChart.data.datasets[0].backgroundColor = data.donutColors;
        _donutChart.update();
    }
    renderStatusDistributionChart();
}
window.switchReportTab = switchReportTab;

function updateReportData() {
    if (_currentReportTab) {
        switchReportTab(_currentReportTab);
    }
}
window.updateReportData = updateReportData;

function exportReportCSV() {
    const activeTbl = document.getElementById('report-view-' + _currentReportTab);
    if (!activeTbl) return;
    const table = activeTbl.querySelector('table');
    if (!table) return;

    let csv = [];
    for (let row of table.rows) {
        let cols = Array.from(row.cells).map(cell => `"${cell.textContent.trim().replace(/"/g, '""')}"`);
        csv.push(cols.join(','));
    }

    const blob = new Blob([csv.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.setAttribute('download', `report-${_currentReportTab}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
window.exportReportCSV = exportReportCSV;

function exportVisibleTableCSV(tableId, filenamePrefix) {
    const table = document.getElementById(tableId);
    if (!table) return;

    const headerCells = Array.from(table.querySelectorAll('thead th'));
    const columns = headerCells
        .map((cell, index) => ({ index, label: cell.textContent.trim() }))
        .filter(column => column.label && !/^(actions|action)$/i.test(column.label));
    const rows = Array.from(table.querySelectorAll('tbody tr'))
        .filter(row => row.style.display !== 'none' && row.cells.length > 0 && !row.querySelector('.table-empty'))
        .map(row => columns.map(column => row.cells[column.index]?.textContent.trim() || ''));

    if (rows.length === 0) {
        alert('There are no visible rows to export.');
        return;
    }

    const escapeCsvCell = value => `"${String(value).replace(/"/g, '""')}"`;
    const csv = [[...columns.map(column => column.label)], ...rows]
        .map(row => row.map(escapeCsvCell).join(','))
        .join('\r\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

function exportProductsCSV() {
    exportVisibleTableCSV('products-table', 'products');
}
window.exportProductsCSV = exportProductsCSV;

function exportStockInCSV() {
    exportVisibleTableCSV('stock-in-table', 'stock-in');
}
window.exportStockInCSV = exportStockInCSV;

function exportStockOutCSV() {
    exportVisibleTableCSV('stock-out-table', 'stock-out');
}
window.exportStockOutCSV = exportStockOutCSV;

function exportAdjustmentsCSV() {
    exportVisibleTableCSV('adj-table', 'adjustments');
}
window.exportAdjustmentsCSV = exportAdjustmentsCSV;

function exportAuditCSV() {
    exportVisibleTableCSV('audit-table', 'audit-trail');
}
window.exportAuditCSV = exportAuditCSV;

function exportProductStockCSV() {
    exportVisibleTableCSV('stock-table', 'product-stock');
}
window.exportProductStockCSV = exportProductStockCSV;


let _editingStockRow = null;
let _stkFileBase64 = null;
let _stkFileName = '';
let _stkAttachmentRemoved = false;

function openAddProductModal() {
    _editingStockRow = null;
    window._editingStockRow = null;
    window._originalEditingTag = '';

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
    setVal('stk-product-name', '');
    setVal('stk-category', '');
    setVal('stk-serial-number', '');
    setVal('stk-project', '');
    setVal('stk-date-received', '');
    setVal('stk-issued-do', '');
    setVal('stk-status', 'In Stock');
    setVal('stk-warranty', '');
    setVal('stk-remarks', '');

    // Auto generate initial Client Tag
    if (typeof window.autoGenerateCurrentProductId === 'function') {
        window.autoGenerateCurrentProductId();
    } else {
        setVal('stk-stock-id', '');
    }

    _stkFileBase64 = null;
    _stkFileName = '';
    window._stkFileBase64 = null;
    window._stkFileName = '';
    _stkAttachmentRemoved = false;
    window._stkAttachmentRemoved = false;

    const card = document.getElementById('stk-attachment-preview-card');
    if (card) card.style.display = 'none';
    const fileInput = document.getElementById('stk-attachment');
    if (fileInput) fileInput.value = '';

    const modal = document.getElementById('stock-modal');
    if (modal) {
        modal.querySelector('.modal-header h2').textContent = 'Add Product';
        const saveBtn = document.getElementById('stock-modal-save-btn') || modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) {
            saveBtn.textContent = 'Save Product';
            saveBtn.disabled = false;
        }
        modal.classList.remove('hidden');
    }
}
window.openAddProductModal = openAddProductModal;

function closeStockModal() {
    _editingStockRow = null;
    window._editingStockRow = null;
    window._originalEditingTag = '';
    _stkFileBase64 = null;
    _stkFileName = '';
    window._stkFileBase64 = null;
    window._stkFileName = '';
    const modal = document.getElementById('stock-modal');
    if (modal) modal.classList.add('hidden');
}
window.closeStockModal = closeStockModal;

function closeStockModalOnOverlay(e) {
    if (e.target === document.getElementById('stock-modal')) closeStockModal();
}
window.closeStockModalOnOverlay = closeStockModalOnOverlay;

function handleStockModalFileSelected(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (!validateAttachmentFileSize(file)) {
        e.target.value = '';
        return;
    }

    _stkAttachmentRemoved = false;
    window._stkAttachmentRemoved = false;
    _stkFileName = file.name;
    window._stkFileName = file.name;

    const reader = new FileReader();
    reader.onload = evt => {
        _stkFileBase64 = evt.target.result;
        window._stkFileBase64 = evt.target.result;
        showModalAttachmentPreview(_stkFileBase64, _stkFileName, file.size);
    };
    reader.readAsDataURL(file);
}
window.handleStockModalFileSelected = handleStockModalFileSelected;

function showModalAttachmentPreview(urlOrBase64, name, sizeBytes) {
    const card = document.getElementById('stk-attachment-preview-card');
    const img = document.getElementById('stk-preview-img');
    const icon = document.getElementById('stk-preview-icon');
    const nameEl = document.getElementById('stk-preview-filename');
    const sizeEl = document.getElementById('stk-preview-filesize');

    if (!card) return;

    if (!urlOrBase64) {
        card.style.display = 'none';
        return;
    }

    const isImg = urlOrBase64.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name || urlOrBase64);

    if (isImg) {
        if (img) {
            img.src = urlOrBase64;
            img.style.display = 'block';
        }
        if (icon) icon.style.display = 'none';
    } else {
        if (img) img.style.display = 'none';
        if (icon) icon.style.display = 'flex';
    }

    if (nameEl) nameEl.textContent = name || 'Attachment';
    if (sizeEl) {
        sizeEl.textContent = sizeBytes ? `${(sizeBytes / 1024).toFixed(1)} KB` : 'Attached';
    }

    card.style.display = 'flex';
}
window.showModalAttachmentPreview = showModalAttachmentPreview;

function clearStockModalAttachment() {
    _stkFileBase64 = null;
    _stkFileName = '';
    window._stkFileBase64 = null;
    window._stkFileName = '';
    _stkAttachmentRemoved = true;
    window._stkAttachmentRemoved = true;

    const fileInput = document.getElementById('stk-attachment');
    if (fileInput) fileInput.value = '';

    const card = document.getElementById('stk-attachment-preview-card');
    if (card) card.style.display = 'none';
}
window.clearStockModalAttachment = clearStockModalAttachment;

function previewModalAttachment() {
    const current = _stkFileBase64 || window._stkFileBase64;
    const name = _stkFileName || window._stkFileName;
    if (!current) return;

    const isImg = current.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name || current);
    if (isImg && typeof window.openLightbox === 'function') {
        window.openLightbox(current);
    } else if (typeof window.openAttachmentOutside === 'function') {
        window.openAttachmentOutside(current, name);
    }
}
window.previewModalAttachment = previewModalAttachment;

function editProductRow(btn) {
    const tr = btn.closest('tr');
    _editingStockRow = tr;
    window._editingStockRow = tr;

    const p = tr._productData || {};
    const cells = tr.cells;

    // Record the original tag so the save handler can detect if it was changed
    window._originalEditingTag = p.client_tag_number || cells[0]?.textContent.trim() || '';

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('stk-stock-id', p.client_tag_number || cells[0]?.textContent.trim() || '');
    setVal('stk-product-name', p.item_name || cells[1]?.textContent.trim() || 'Item');
    setVal('stk-category', p.category || cells[2]?.textContent.trim() || 'General');
    setVal('stk-serial-number', p.serial_number || (false ? '' : cells[3]?.textContent.trim()) || '');
    setVal('stk-project', p.project || (false ? '' : cells[4]?.textContent.trim()) || '');
    setVal('stk-date-received', p.date_received || (false ? '' : cells[5]?.textContent.trim()) || '');
    setVal('stk-issued-do', p.issued_do || (false ? '' : cells[6]?.textContent.trim()) || '');

    let currentStatus = p.status || cells[7]?.textContent.trim() || 'In Stock';
    if (currentStatus.toLowerCase() === 'available') currentStatus = 'In Stock';
    const statusSel = document.getElementById('stk-status');
    if (statusSel) {
        [...statusSel.options].forEach(o => {
            if (o.value.toLowerCase() === 'available' || o.textContent.trim().toLowerCase() === 'available') {
                o.remove();
            }
        });
        let matched = false;
        [...statusSel.options].forEach(o => {
            if (o.value.toLowerCase() === currentStatus.toLowerCase()) {
                o.selected = true;
                matched = true;
            }
        });
        if (!matched && currentStatus && currentStatus.toLowerCase() !== 'available') {
            const opt = new Option(currentStatus, currentStatus, true, true);
            statusSel.add(opt);
        } else if (!matched) {
            statusSel.value = 'In Stock';
        }
    }

    setVal('stk-warranty', p.warranty_description || (false ? '' : cells[8]?.textContent.trim()) || '');
    setVal('stk-remarks', p.remarks || (false ? '' : cells[9]?.textContent.trim()) || '');

    _stkAttachmentRemoved = false;
    window._stkAttachmentRemoved = false;
    _stkFileBase64 = null;
    _stkFileName = '';
    window._stkFileBase64 = null;
    window._stkFileName = '';

    if (p.attachments) {
        let existingUrl = '';
        let existingName = 'Attachment';
        if (typeof p.attachments === 'string') {
            try {
                const parsed = JSON.parse(p.attachments);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    existingUrl = parsed[0].data || parsed[0].url || '';
                    existingName = parsed[0].name || 'Attachment';
                } else if (typeof parsed === 'object' && parsed !== null) {
                    existingUrl = parsed.data || parsed.url || '';
                    existingName = parsed.name || 'Attachment';
                }
            } catch (e) {
                existingUrl = p.attachments;
                existingName = p.attachments.split('/').pop() || 'Attachment';
            }
        } else if (typeof p.attachments === 'object') {
            if (Array.isArray(p.attachments) && p.attachments.length > 0) {
                existingUrl = p.attachments[0].data || p.attachments[0].url || '';
                existingName = p.attachments[0].name || 'Attachment';
            } else {
                existingUrl = p.attachments.data || p.attachments.url || '';
                existingName = p.attachments.name || 'Attachment';
            }
        }

        if (existingUrl) {
            _stkFileBase64 = existingUrl;
            _stkFileName = existingName;
            window._stkFileBase64 = existingUrl;
            window._stkFileName = existingName;
            showModalAttachmentPreview(existingUrl, existingName);
        } else {
            showModalAttachmentPreview(null);
        }
    } else {
        showModalAttachmentPreview(null);
    }

    const fileInput = document.getElementById('stk-attachment');
    if (fileInput) fileInput.value = '';

    const modal = document.getElementById('stock-modal');
    if (modal) {
        modal.querySelector('.modal-header h2').textContent = 'Edit Product';
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) saveBtn.textContent = 'Update Product';
        modal.classList.remove('hidden');
    }
}
window.editProductRow = editProductRow;


// ======== 5. STOCK IN MODAL & CONTEXT MENU ========

let _editingStockInRow = null;
let _siActiveBtn = null;

function openStockInModal() {
    if (typeof window.populateLinkedProductDropdowns === 'function') window.populateLinkedProductDropdowns();
    const modal = document.getElementById('stock-in-modal');
    if (modal) modal.classList.remove('hidden');
}
window.openStockInModal = openStockInModal;

function bindMovementInputListeners() {
    const stockInQtyInput = document.getElementById('si-qty-in');
    if (stockInQtyInput && !stockInQtyInput.dataset.bound) {
        stockInQtyInput.addEventListener('input', () => {
            const balanceEl = document.getElementById('si-balance');
            if (balanceEl) balanceEl.value = Math.max(0, toInteger(stockInQtyInput.value));
        });
        stockInQtyInput.dataset.bound = 'true';
    }

    const stockOutQtyInput = document.getElementById('so-qty-out');
    if (stockOutQtyInput && !stockOutQtyInput.dataset.bound) {
        stockOutQtyInput.addEventListener('input', autoCalculateStockOutBalance);
        stockOutQtyInput.dataset.bound = 'true';
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindMovementInputListeners);
} else {
    bindMovementInputListeners();
}

function closeStockInModal() {
    _editingStockInRow = null;
    resetModalAttachment('si');
    const modal = document.getElementById('stock-in-modal');
    if (modal) {
        modal.classList.add('hidden');
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Add Stock In Record';
        const btn = modal.querySelector('.modal-footer .btn-primary');
        if (btn) btn.textContent = 'Save Record';
    }
    clearStockInModal();
}
window.closeStockInModal = closeStockInModal;

function closeStockInModalOnOverlay(e) {
    if (e.target === document.getElementById('stock-in-modal')) closeStockInModal();
}
window.closeStockInModalOnOverlay = closeStockInModalOnOverlay;

function clearStockInModal() {
    ['si-stock-id', 'si-product-name', 'si-category', 'si-qty-in', 'si-balance', 'si-price', 'si-linked-product', 'si-followup-date', 'si-followup-notes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const idEl = document.getElementById('si-stock-id');
    const nameEl = document.getElementById('si-product-name');
    const catEl = document.getElementById('si-category');
    if (idEl) idEl.readOnly = false;
    if (nameEl) nameEl.readOnly = false;
    if (catEl) catEl.readOnly = false;
}
window.clearStockInModal = clearStockInModal;

async function saveStockInRecord() {
    if (window._savingStockIn) return;
    window._savingStockIn = true;
    const saveBtn = document.querySelector('#stock-in-modal .modal-footer .btn-primary');
    const originalBtnText = saveBtn?.textContent || 'Save Record';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    try {
    const stockId = getElementValue('si-stock-id');
    const name = getElementValue('si-product-name');
    const category = getElementValue('si-category');
    const qtyIn = document.getElementById('si-qty-in')?.value || '0';
    const qtyOut = '0';
    const balance = document.getElementById('si-balance')?.value || '0';
    const price = document.getElementById('si-price')?.value || '0';
    const followupDate = document.getElementById('si-followup-date')?.value || null;
    const followupNotes = document.getElementById('si-followup-notes')?.value.trim() || null;
    const linkedProductId = _parseLinkedProductId(document.getElementById('si-linked-product')?.value);

    if (!stockId || !name || !category) {
        alert('Please fill in Stock ID, Product Name, and Category.');
        return;
    }

    const qtyInNum = Math.max(0, toInteger(qtyIn));
    const qtyOutNum = parseInt(qtyOut) || 0;
    if (qtyInNum <= 0) {
        alert('Qty In must be greater than 0');
        return;
    }
    const balNum = Math.max(0, toInteger(balance, qtyInNum - qtyOutNum));
    const siAttach = getModalAttachment('si');
    const costNum = Math.max(0, toNumber(price));
    const formattedPrice = costNum.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    // Status will be computed by recalcProductStockByStockId after DB writes
    // Pass empty status; recalc will update product_stock, stock_in, stock_out, products tables + DOM
    const dbPayload = {
        stock_id: stockId,
        product_name: name,
        category: category,
        qty_in: qtyInNum,
        qty_out: qtyOutNum,
        status: '',
        attachment_id: siAttach ? JSON.stringify({ name: siAttach.name, data: siAttach.base64 }) : null,
        product_id: linkedProductId || null
    };
    const stockInLogPayload = {
        stock_id: stockId,
        product_name: name,
        category: category,
        qty_in: qtyInNum,
        balance: balNum,
        cost: costNum,
        status: '',
        attachment_id: siAttach ? JSON.stringify({ name: siAttach.name, data: siAttach.base64 }) : null,
        followup_date: followupDate || null,
        followup_notes: followupNotes || null
    };

    let insertedId = stockId;
    if (_editingStockInRow && typeof sbUpdate === 'function') {
        const dbId = _editingStockInRow.dataset.editingId || _editingStockInRow.dataset.id;
        const oldQtyIn = parseInt(_editingStockInRow.cells[3]?.textContent.trim() || '0', 10) || 0;
        const delta = qtyInNum - oldQtyIn; // e.g. 10-50 = -40
        // 1) update stock_in log - RLS disabled, but handle old rows where dataset.id is stock_id not uuid
        if (dbId) {
            let { error: logErr } = await sbUpdate(STOCK_IN_TABLE, { 'id': `eq.${dbId}` }, stockInLogPayload);
            if (logErr && logErr.code === 'NO_MATCH') {
                // fallback: old rows stored stock_id as id, try stock_id filter
                const fb = await sbUpdate(STOCK_IN_TABLE, { 'stock_id': `eq.${stockId}` }, stockInLogPayload);
                logErr = fb.error;
            }
            if (logErr) {
                console.warn('Stock In log update error:', logErr);
                alert('Failed to update Stock In: ' + (logErr.message || JSON.stringify(logErr)));
                return;
            }
        }
    } else if (typeof sbInsert === 'function') {
        // 1) Insert into stock_in log table (this is what Supabase Table Editor shows)
        const logRes = await sbInsert(STOCK_IN_TABLE, stockInLogPayload);
        if (logRes.data) insertedId = logRes.data.id || stockId;
        if (logRes.error) {
            console.warn('Stock In log save error:', logRes.error);
            alert('Failed to save Stock In to database: ' + (logRes.error.message || JSON.stringify(logRes.error)));
            return;
        }

    }

    if (_editingStockInRow) {
        const prevQtyIn = _editingStockInRow.cells[3].textContent.trim();
        _editingStockInRow.cells[0].textContent = stockId;
        _editingStockInRow.cells[1].textContent = name;
        _editingStockInRow.cells[2].textContent = category;
        _editingStockInRow.cells[3].textContent = qtyIn;
        _editingStockInRow.cells[3].className = 'cell-qty-in';
        _editingStockInRow.cells[4].textContent = qtyOut;
        _editingStockInRow.cells[5].textContent = balance;
        _editingStockInRow.cells[6].textContent = 'BND ' + formattedPrice;
        // Status badge will be updated by recalcProductStockByStockId
        _editingStockInRow.dataset.followupDate = followupDate || '';
        _editingStockInRow.dataset.followupNotes = followupNotes || '';
        _editingStockInRow.cells[8].innerHTML = _buildAttachmentCellHtml(siAttach?.base64, siAttach?.name);
        logAudit('Edited', 'Stock In', `${getCurrentUser()} updated Stock In for "${name}" (ID: ${stockId}) [Qty In: ${prevQtyIn}  ${qtyIn}, Balance: ${balance}]`, stockId, name);
        _editingStockInRow = null;
    } else {
        const attachHtml = _buildAttachmentCellHtml(siAttach?.base64, siAttach?.name);
        const tbody = document.getElementById('stock-in-tbody');
        if (tbody) {
            const tr = document.createElement('tr');
            if (insertedId) tr.dataset.id = insertedId;
            tr.dataset.followupDate = followupDate || '';
            tr.dataset.followupNotes = followupNotes || '';
            // Status badge will be updated by recalcProductStockByStockId
            tr.innerHTML = `
                <td class="cell-muted">${escapeHtml(stockId)}</td>
                <td class="cell-bold">${escapeHtml(name)}</td>
                <td class="cell-muted">${escapeHtml(category)}</td>
                <td class="cell-qty-in">${qtyIn}</td>
                <td>${qtyOut}</td>
                <td>${balNum}</td>
                <td class="cell-muted">BND ${formattedPrice}</td>
                <td><span class="badge badge-in">In Stock</span></td>
                <td>${attachHtml}</td>
                <td><button class="dots-btn" title="More" onclick="openStockInMenu(this)"><i class="ph ph-dots-three"></i></button></td>
            `;
            tbody.insertBefore(tr, tbody.firstChild);
        }
        logAudit('Added', 'Stock In', `${getCurrentUser()} logged Stock In for "${name}" (ID: ${stockId}) with Qty In: +${qtyIn}, Balance: ${balNum}, Price: BND ${formattedPrice}`, stockId, name);
    }

    await recalcProductStockByStockId(stockId);

    saveAllMovementTables();
    updateDashboardStats();
    closeStockInModal();
    document.getElementById('stock-in-empty')?.classList.add('hidden');
    } finally {
        window._savingStockIn = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalBtnText;
        }
    }
}
window.saveStockInRecord = saveStockInRecord;

function openStockInMenu(btn) {
    const menu = document.getElementById('stock-in-context-menu');
    if (!menu || !btn) return;
    _siActiveBtn = btn;
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX - menu.offsetWidth + rect.width) + 'px';
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', closeStockInMenuOutside, { once: true }), 10);
}
window.openStockInMenu = openStockInMenu;

function closeStockInMenuOutside(e) {
    const menu = document.getElementById('stock-in-context-menu');
    if (menu && !menu.contains(e.target)) menu.classList.add('hidden');
}
window.closeStockInMenuOutside = closeStockInMenuOutside;

async function deleteStockInRow() {
    if (_siActiveBtn) {
        const row = _siActiveBtn.closest('tr');
        if (row) {
            const dbId = row.dataset.id;
            const sid = row.cells[0]?.textContent.trim();
            const sname = row.cells[1]?.textContent.trim();

            if (!confirm(`Are you sure you want to delete Stock In record for "${sname}" (ID: ${sid})?`)) {
                document.getElementById('stock-in-context-menu')?.classList.add('hidden');
                return;
            }

            if (typeof sbDelete === 'function') {
                if (dbId) {
                    // Guard: prevent negative master if Stock Out already consumed
                    const qtyInVal = parseInt(row.cells[3]?.textContent.trim() || '0', 10) || 0;
                    if (sid && sid !== '' && sid !== '-') {
                        const { data: ps } = await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${sid}` });
                        if (ps) {
                            const wouldBeQtyIn = (ps.qty_in || 0) - qtyInVal;
                            if (wouldBeQtyIn < (ps.qty_out || 0)) {
                                if (!confirm(`Deleting this Stock In (${qtyInVal}) will make stock negative (master qty_in ${ps.qty_in}  ${Math.max(0, wouldBeQtyIn)}, qty_out ${ps.qty_out}). Stock Out already used this stock. Continue?`)) {
                                    document.getElementById('stock-in-context-menu')?.classList.add('hidden');
                                    return;
                                }
                            }
                        }
                    }
                    const { error } = await sbDelete(STOCK_IN_TABLE, { 'id': `eq.${dbId}` });
                    if (error) console.warn('Stock In DB delete error:', error);
                    if (!error && sid && sid !== '' && sid !== '-') {
                        const { data: ps } = await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${sid}` });
                        if (ps) {
                            await recalcProductStockByStockId(sid);
                        }
                    }
                } else if (sid && sid !== '' && sid !== '-') {
                    const { error } = await sbDelete(STOCK_IN_TABLE, { 'stock_id': `eq.${sid}` });
                    if (error) console.warn('Stock In DB delete error:', error);
                }
            }

            row.remove();
            logAudit('Deleted', 'Stock In', `${getCurrentUser()} deleted Stock In entry for "${sname}" (ID: ${sid})`, sid, sname);
            saveAllMovementTables();
            updateDashboardStats();
        }
    }
    document.getElementById('stock-in-context-menu')?.classList.add('hidden');
    const rows = document.querySelectorAll('#stock-in-tbody tr');
    if (rows.length === 0) document.getElementById('stock-in-empty')?.classList.remove('hidden');
}
window.deleteStockInRow = deleteStockInRow;

function editStockInRow() {
    document.getElementById('stock-in-context-menu')?.classList.add('hidden');
    if (!_siActiveBtn) return;
    _editingStockInRow = _siActiveBtn.closest('tr');
    if (!_editingStockInRow) return;

    const cells = _editingStockInRow.cells;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

    setVal('si-stock-id', cells[0]?.textContent.trim());
    setVal('si-product-name', cells[1]?.textContent.trim());
    setVal('si-category', cells[2]?.textContent.trim());
    setVal('si-qty-in', cells[3]?.textContent.trim());
    setVal('si-balance', cells[4]?.textContent.trim());
    setVal('si-price', cells[5]?.textContent.replace('BND', '').replace(/,/g, '').trim());
    setVal('si-followup-date', _editingStockInRow.dataset.followupDate || '');
    setVal('si-followup-notes', _editingStockInRow.dataset.followupNotes || '');

    // Store the database row id for use in update
    _editingStockInRow.dataset.editingId = _editingStockInRow.dataset.id || '';

    // Preload existing attachment if present
    const attachCell = cells[7];
    const imgEl = attachCell ? attachCell.querySelector('img') : null;
    const docEl = attachCell ? attachCell.querySelector('.attachment-thumb[data-url]') : null;

    resetModalAttachment('si');
    if (imgEl && imgEl.src) {
        _modalAttachState['si'] = {
            base64: imgEl.src,
            name: imgEl.alt || 'attachment.jpg',
            removed: false
        };
        _renderModalAttachPreview('si', imgEl.src, imgEl.alt || 'attachment.jpg');
    } else if (docEl && docEl.dataset.url) {
        _modalAttachState['si'] = {
            base64: docEl.dataset.url,
            name: docEl.dataset.name || 'attachment.pdf',
            removed: false
        };
        _renderModalAttachPreview('si', docEl.dataset.url, docEl.dataset.name || 'attachment.pdf');
    }

    if (typeof window.populateLinkedProductDropdowns === 'function') {
        window.populateLinkedProductDropdowns();
    }

    const modal = document.getElementById('stock-in-modal');
    if (modal) {
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Edit Stock In Record';
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) saveBtn.textContent = 'Update Record';
        modal.classList.remove('hidden');
    }
}
window.editStockInRow = editStockInRow;


// ======== 6. STOCK OUT MODAL & CONTEXT MENU ========

let _editingStockOutRow = null;
let _soActiveBtn = null;
let _savingStockOut = false;

async function autoCalculateStockOutBalance() {
    const stockId = document.getElementById('so-stock-id')?.value.trim() || '';
    const qtyOutEl = document.getElementById('so-qty-out');
    const qtyOut = parseInt(qtyOutEl?.value, 10) || 0;
    const balanceInput = document.getElementById('so-balance');
    if (!balanceInput) return;

    let available = 0;
    if (qtyOutEl && qtyOutEl.dataset.available !== undefined && qtyOutEl.dataset.available !== '') {
        available = parseInt(qtyOutEl.dataset.available, 10) || 0;
    } else if (window._stockBalanceMap && stockId && window._stockBalanceMap[stockId.toLowerCase()] !== undefined) {
        available = window._stockBalanceMap[stockId.toLowerCase()];
    } else {
        const stockRows = document.querySelectorAll('#stock-tbody tr');
        for (let tr of stockRows) {
            const sid = tr.cells[0]?.textContent.trim();
            if (sid && stockId && sid.toLowerCase() === stockId.toLowerCase()) {
                const qtyIn = parseInt(tr.cells[3]?.textContent.replace(/,/g, '').trim() || '0', 10) || 0;
                const qtyOutRow = parseInt(tr.cells[4]?.textContent.replace(/,/g, '').trim() || '0', 10) || 0;
                available = Math.max(0, qtyIn - qtyOutRow);
                break;
            }
        }
        // DB fallback if DOM not loaded or stale
        if (available === 0 && stockId && typeof sbSelect === 'function') {
            try {
                const { data: ps } = await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` });
                if (ps) available = Math.max(0, (ps.qty_in || 0) - (ps.qty_out || 0));
            } catch (e) { }
        }
    }

    const calculatedBalance = Math.max(0, available - qtyOut);
    balanceInput.value = calculatedBalance;
}
window.autoCalculateStockOutBalance = autoCalculateStockOutBalance;

function openStockOutModal() {
    _editingStockOutRow = null;
    closeStockOutModal();
    if (typeof window.populateLinkedProductDropdowns === 'function') window.populateLinkedProductDropdowns();
    const modal = document.getElementById('stock-out-modal');
    if (modal) {
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Add Stock Out Record';
        const btn = modal.querySelector('.modal-footer .btn-primary');
        if (btn) btn.textContent = 'Save Record';
        modal.classList.remove('hidden');
    }
    autoCalculateStockOutBalance();
}
window.openStockOutModal = openStockOutModal;

function closeStockOutModal() {
    _editingStockOutRow = null;
    resetModalAttachment('so');
    const modal = document.getElementById('stock-out-modal');
    if (modal) {
        modal.classList.add('hidden');
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Add Stock Out Record';
        const btn = modal.querySelector('.modal-footer .btn-primary');
        if (btn) btn.textContent = 'Save Record';
    }
    ['so-stock-id', 'so-product-name', 'so-category', 'so-qty-out', 'so-balance', 'so-linked-product', 'so-followup-date', 'so-followup-notes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const idEl = document.getElementById('so-stock-id');
    const nameEl = document.getElementById('so-product-name');
    const catEl = document.getElementById('so-category');
    if (idEl) idEl.readOnly = false;
    if (nameEl) nameEl.readOnly = false;
    if (catEl) catEl.readOnly = false;
}
window.closeStockOutModal = closeStockOutModal;

function closeStockOutModalOnOverlay(e) {
    if (e.target === document.getElementById('stock-out-modal')) closeStockOutModal();
}
window.closeStockOutModalOnOverlay = closeStockOutModalOnOverlay;

async function saveStockOutRecord() {
    if (_savingStockOut) return;
    _savingStockOut = true;
    const saveBtn = document.querySelector('#stock-out-modal .btn-primary');
    if (saveBtn) saveBtn.disabled = true;
    let insertedId = null;
    try {
        const stockId = getElementValue('so-stock-id');
        const name = getElementValue('so-product-name');
        const category = getElementValue('so-category');
        const qtyOut = document.getElementById('so-qty-out')?.value || '0';
        const balance = document.getElementById('so-balance')?.value || '0';
        const followupDate = document.getElementById('so-followup-date')?.value || null;
        const followupNotes = document.getElementById('so-followup-notes')?.value.trim() || null;
        const linkedProductId = _parseLinkedProductId(document.getElementById('so-linked-product')?.value);

        if (!stockId || !name || !category) {
            alert('Please fill in Stock ID, Product Name, and Category.');
            return;
        }

        const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        const qtyOutNum = Math.max(0, toInteger(qtyOut));
        const balNum = Math.max(0, toInteger(balance));
        if (qtyOutNum <= 0) {
            alert('Qty Out must be greater than 0');
            return;
        }
        // Edge: prevent over-issue beyond available (new records only)
        if (!_editingStockOutRow && window._stockBalanceMap && stockId) {
            const avail = window._stockBalanceMap[stockId.toLowerCase()];
            if (avail !== undefined && qtyOutNum > avail) {
                alert(`Insufficient stock. Available: ${avail}, requested: ${qtyOutNum}`);
                return;
            }
        }
        const soAttach = getModalAttachment('so');

        // Persist to Supabase stock_out table
        // Status will be computed by recalcProductStockByStockId after DB writes
        const dbPayload = {
            stock_id: stockId,
            product_name: name,
            category: category,
            qty_out: qtyOutNum,
            balance: balNum,
            status: '',
            attachment_id: soAttach ? JSON.stringify({ name: soAttach.name, data: soAttach.base64 }) : null,
            followup_date: followupDate,
            followup_notes: followupNotes,
            product_id: linkedProductId || null
        };
        let existingSoRow = null;
        if (!_editingStockOutRow && typeof sbSelect === 'function') {
            try {
                const { data: existingSoResult } = await sbSelect(STOCK_OUT_TABLE, { 'stock_id': `eq.${stockId}` });
                if (existingSoResult) {
                    existingSoRow = Array.isArray(existingSoResult) ? existingSoResult[0] : existingSoResult;
                }
            } catch (e) { }
        }

        if (_editingStockOutRow && typeof sbUpdate === 'function') {
            // UPDATE existing row matched by database id (primary key), not stock_id
            const dbId = _editingStockOutRow.dataset.editingId || _editingStockOutRow.dataset.id;
            if (dbId) {
                const { error } = await sbUpdate(STOCK_OUT_TABLE, { 'id': `eq.${dbId}` }, dbPayload);
                if (error) {
                    console.warn('Stock Out update error:', error.message || error);
                    alert('Failed to save your changes to the database: ' + (error.message || JSON.stringify(error)) + '\n\nYour edits will not persist after refresh.');
                    return;
                }
            } else {
                // Fallback to stock_id if no db id stored
                const { error } = await sbUpdate(STOCK_OUT_TABLE, { 'stock_id': `eq.${stockId}` }, dbPayload);
                if (error) {
                    console.warn('Stock Out update error (fallback):', error.message || error);
                    alert('Failed to save your changes to the database: ' + (error.message || JSON.stringify(error)) + '\n\nYour edits will not persist after refresh.');
                    return;
                }
            }
        } else if (existingSoRow && typeof sbUpdate === 'function') {
            // A record for this Product / Stock ID already exists: update it instead of creating a duplicate row!
            insertedId = existingSoRow.id ?? null;
            const { error: updateErr } = await sbUpdate(STOCK_OUT_TABLE, { 'id': `eq.${existingSoRow.id}` }, dbPayload);
            if (updateErr) {
                console.warn('Stock Out update existing error:', updateErr);
                alert('Failed to save Stock Out to database: ' + (updateErr.message || JSON.stringify(updateErr)));
                return;
            }
        } else if (typeof sbInsert === 'function') {
            // Ensure product_stock has this stock_id first to satisfy FK constraint
            if (typeof sbSelect === 'function') {
                try {
                    const { data: parentStockResult } = await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` });
                    // Handle both null and empty array - data is already unwrapped
                    const parentStock = parentStockResult && Array.isArray(parentStockResult) && parentStockResult.length > 0
                        ? parentStockResult[0]
                        : (parentStockResult && !Array.isArray(parentStockResult) ? parentStockResult : null);
                    if (!parentStock) {
                        const newBal = 0; // qty_in 0 - qtyOutNum  0
                        const newStatus = computeStockStatus(newBal, '');
                        await sbInsert(PRODUCT_STOCK_TABLE, {
                            stock_id: stockId,
                            product_name: name,
                            category: category,
                            qty_in: 0,
                            qty_out: qtyOutNum,
                            status: newStatus,
                            attachment_id: null,
                            product_id: linkedProductId || null
                        });
                    } else {
                        const currentQtyOut = parentStock.qty_out || 0;
                        const newTotalQtyOut = currentQtyOut + qtyOutNum;
                        const newBal = Math.max(0, (parentStock.qty_in || 0) - newTotalQtyOut);
                        const parentStatus = computeStockStatus(newBal, parentStock.status || '');
                        // Use primary key id for reliable update - prevents updating wrong row and preserves stock_id/product_id
                        const updateFilter = parentStock.id ? { 'id': `eq.${parentStock.id}` } : { 'stock_id': `eq.${stockId}` };
                        const { error: parentErr } = await sbUpdate(PRODUCT_STOCK_TABLE, updateFilter, {
                            qty_out: newTotalQtyOut,
                            status: parentStatus
                        });
                        if (parentErr) console.warn('Stock Out parent update error:', parentErr.message || parentErr);
                    }
                } catch (e) {
                    console.warn('Stock Out sync parent error:', e);
                }
            }

            const res = await sbInsert(STOCK_OUT_TABLE, dbPayload);
            if (res.data) insertedId = res.data.id;
            if (res.error) {
                console.warn('Stock Out save error:', res.error.message || res.error);
                alert('Failed to save Stock Out to database: ' + (res.error.message || JSON.stringify(res.error)));
                return;
            }
        }

        const existingDomRow = !_editingStockOutRow
            ? Array.from(document.querySelectorAll('#stock-out-tbody tr')).find(r => r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase())
            : null;

        if (_editingStockOutRow || existingDomRow) {
            const targetRow = _editingStockOutRow || existingDomRow;
            const prevQtyOut = targetRow.cells[3]?.textContent.trim() || '0';
            targetRow.cells[0].textContent = stockId;
            targetRow.cells[1].textContent = name;
            targetRow.cells[2].textContent = category;
            targetRow.cells[3].textContent = qtyOut;
            targetRow.cells[3].className = 'cell-qty-out';
            targetRow.cells[4].textContent = balance;
            // Status badge will be updated by recalcProductStockByStockId
            targetRow.cells[6].textContent = now;
            if (insertedId) targetRow.dataset.id = insertedId;
            if (soAttach) {
                targetRow.cells[7].innerHTML = _buildAttachmentCellHtml(soAttach.base64, soAttach.name);
            }
            logAudit('Edited', 'Stock Out', `${getCurrentUser()} updated Stock Out for "${name}" (ID: ${stockId}) [Qty Out: ${prevQtyOut} -> ${qtyOut}, Balance: ${balance}]`, stockId, name);
            _editingStockOutRow = null;
        } else {
            const attachHtml = _buildAttachmentCellHtml(soAttach?.base64, soAttach?.name);
            const tbody = document.getElementById('stock-out-tbody');
            if (tbody) {
                const tr = document.createElement('tr');
                tr.dataset.id = insertedId || ('so_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5));
                // Status badge will be updated by recalcProductStockByStockId
                tr.innerHTML = `
                <td class="cell-muted">${escapeHtml(stockId)}</td>
                <td class="cell-bold">${escapeHtml(name)}</td>
                <td class="cell-muted">${escapeHtml(category)}</td>
                <td class="cell-qty-out">${qtyOut}</td>
                <td>${balNum}</td>
                <td><span class="badge badge-in">In Stock</span></td>
                <td class="cell-muted">${now}</td>
                <td>${attachHtml}</td>
                <td><button class="dots-btn" title="More" onclick="openStockOutMenu(this)"><i class="ph ph-dots-three"></i></button></td>
            `;
                tbody.insertBefore(tr, tbody.firstChild);
            }
            logAudit('Added', 'Stock Out', `${getCurrentUser()} logged Stock Out for "${name}" (ID: ${stockId}) with Qty Out: -${qtyOut}, Balance: ${balNum}`, stockId, name);
        }

        await recalcProductStockByStockId(stockId);
        saveAllMovementTables();
        updateDashboardStats();
        closeStockOutModal();
        document.getElementById('stock-out-empty')?.classList.add('hidden');
    } finally {
        _savingStockOut = false;
        if (saveBtn) saveBtn.disabled = false;
    }
}
window.saveStockOutRecord = saveStockOutRecord;

function openStockOutMenu(btn) {
    const menu = document.getElementById('stock-out-context-menu');
    if (!menu || !btn) return;
    _soActiveBtn = btn;
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX - menu.offsetWidth + rect.width) + 'px';
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', closeStockOutMenuOutside, { once: true }), 10);
}
window.openStockOutMenu = openStockOutMenu;

function closeStockOutMenuOutside(e) {
    const menu = document.getElementById('stock-out-context-menu');
    if (menu && !menu.contains(e.target)) menu.classList.add('hidden');
}
window.closeStockOutMenuOutside = closeStockOutMenuOutside;

async function deleteStockOutRow() {
    if (_soActiveBtn) {
        const row = _soActiveBtn.closest('tr');
        if (row) {
            const dbId = row.dataset.id;
            const sid = row.cells[0]?.textContent.trim();
            const sname = row.cells[1]?.textContent.trim();

            if (!confirm(`Are you sure you want to delete Stock Out record for "${sname}" (ID: ${sid})?`)) {
                document.getElementById('stock-out-context-menu')?.classList.add('hidden');
                return;
            }

            if (typeof sbDelete === 'function') {
                if (dbId) {
                    const { error } = await sbDelete(STOCK_OUT_TABLE, { 'id': `eq.${dbId}` });
                    if (error) console.warn('Stock Out DB delete error:', error);
                } else if (sid && sid !== '' && sid !== '-') {
                    const { error } = await sbDelete(STOCK_OUT_TABLE, { 'stock_id': `eq.${sid}` });
                    if (error) console.warn('Stock Out DB delete error:', error);
                }
            }

            row.remove();
            logAudit('Deleted', 'Stock Out', `${getCurrentUser()} deleted Stock Out entry for "${sname}" (ID: ${sid})`, sid, sname);
            if (sid && sid !== '' && sid !== '-') {
                await recalcProductStockByStockId(sid);
            }
            saveAllMovementTables();
            updateDashboardStats();
            if (typeof loadProductStockFromDB === 'function') await loadProductStockFromDB();
        }
    }
    document.getElementById('stock-out-context-menu')?.classList.add('hidden');
    const rows = document.querySelectorAll('#stock-out-tbody tr');
    if (rows.length === 0) document.getElementById('stock-out-empty')?.classList.remove('hidden');
}
window.deleteStockOutRow = deleteStockOutRow;

function editStockOutRow() {
    document.getElementById('stock-out-context-menu')?.classList.add('hidden');
    if (!_soActiveBtn) return;
    _editingStockOutRow = _soActiveBtn.closest('tr');
    if (!_editingStockOutRow) return;

    const cells = _editingStockOutRow.cells;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

    setVal('so-stock-id', cells[0]?.textContent.trim());
    setVal('so-product-name', cells[1]?.textContent.trim());
    setVal('so-category', cells[2]?.textContent.trim());
    setVal('so-qty-out', cells[3]?.textContent.trim());
    setVal('so-balance', cells[4]?.textContent.trim());

    // Store the database row id for use in update
    _editingStockOutRow.dataset.editingId = _editingStockOutRow.dataset.id || '';

    // Preload existing attachment if present (column 7 on stock out)
    const attachCell = cells[7];
    const imgEl = attachCell ? attachCell.querySelector('img') : null;
    const docEl = attachCell ? attachCell.querySelector('.attachment-thumb[data-url]') : null;

    resetModalAttachment('so');
    if (imgEl && imgEl.src) {
        _modalAttachState['so'] = {
            base64: imgEl.src,
            name: imgEl.alt || 'attachment.jpg',
            removed: false
        };
        _renderModalAttachPreview('so', imgEl.src, imgEl.alt || 'attachment.jpg');
    } else if (docEl && docEl.dataset.url) {
        _modalAttachState['so'] = {
            base64: docEl.dataset.url,
            name: docEl.dataset.name || 'attachment.pdf',
            removed: false
        };
        _renderModalAttachPreview('so', docEl.dataset.url, docEl.dataset.name || 'attachment.pdf');
    }

    if (typeof window.populateLinkedProductDropdowns === 'function') {
        window.populateLinkedProductDropdowns();
    }

    const modal = document.getElementById('stock-out-modal');
    if (modal) {
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Edit Stock Out Record';
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) saveBtn.textContent = 'Update Record';
        modal.classList.remove('hidden');
    }
}
window.editStockOutRow = editStockOutRow;


// ======== 7. ADJUSTMENTS MODAL & CONTEXT MENU ========

let _editingAdjustmentRow = null;
let _adjActiveBtn = null;

function openAdjustmentModal() {
    _editingAdjustmentRow = null;
    closeAdjustmentModal();
    if (typeof window.populateLinkedProductDropdowns === 'function') window.populateLinkedProductDropdowns();
    const modal = document.getElementById('adj-modal');
    if (modal) {
        modal.classList.remove('hidden');
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Add Stock Adjustment';
        const btn = modal.querySelector('.modal-footer .btn-primary');
        if (btn) btn.textContent = 'Save Record';
    }
}
window.openAdjustmentModal = openAdjustmentModal;

function closeAdjustmentModal() {
    _editingAdjustmentRow = null;
    resetModalAttachment('adj');
    const modal = document.getElementById('adj-modal');
    if (modal) {
        modal.classList.add('hidden');
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Add Stock Adjustment';
        const btn = modal.querySelector('.modal-footer .btn-primary');
        if (btn) btn.textContent = 'Save Record';
    }
    ['adj-stock-id', 'adj-product-name', 'adj-category', 'adj-new-qty', 'adj-reason', 'adj-linked-product', 'adj-followup-date', 'adj-followup-notes'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const idEl = document.getElementById('adj-stock-id');
    const nameEl = document.getElementById('adj-product-name');
    const catEl = document.getElementById('adj-category');
    if (idEl) idEl.readOnly = false;
    if (nameEl) nameEl.readOnly = false;
    if (catEl) catEl.readOnly = false;
}
window.closeAdjustmentModal = closeAdjustmentModal;

function closeAdjustmentModalOnOverlay(e) {
    if (e.target === document.getElementById('adj-modal')) closeAdjustmentModal();
}
window.closeAdjustmentModalOnOverlay = closeAdjustmentModalOnOverlay;

async function saveAdjustmentRecord() {
    const stockId = getElementValue('adj-stock-id');
    const name = getElementValue('adj-product-name');
    const category = getElementValue('adj-category');
    const newQty = Math.max(0, toInteger(document.getElementById('adj-new-qty')?.value));
    const reason = document.getElementById('adj-reason')?.value || 'Correction';
    const followupDate = document.getElementById('adj-followup-date')?.value || null;
    const followupNotes = document.getElementById('adj-followup-notes')?.value.trim() || null;
    const linkedProductId = _parseLinkedProductId(document.getElementById('adj-linked-product')?.value);

    if (window._savingAdj) return;
    if (!stockId || !name || !category) {
        alert('Please fill in Stock ID, Product Name, and Category.');
        return;
    }
    window._savingAdj = true;
    const saveBtn = document.querySelector('#adj-modal .modal-footer .btn-primary');
    const originalBtnText = saveBtn?.textContent || 'Save Record';
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
    }
    try {

        const now = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
        let oldQty = 0;
        const wasEditing = !!_editingAdjustmentRow;

        let insertedId = null;
        let attachmentPayload = null;
        const currentAdjAttach = getModalAttachment('adj');
        if (currentAdjAttach) {
            attachmentPayload = JSON.stringify({ name: currentAdjAttach.name, data: currentAdjAttach.base64 });
        } else if (_modalAttachState['adj'].removed) {
            attachmentPayload = null;
        } else if (wasEditing && _editingAdjustmentRow) {
            const existingImg = _editingAdjustmentRow.cells[8]?.querySelector('img');
            const existingDoc = _editingAdjustmentRow.cells[8]?.querySelector('.attachment-thumb[data-url]');
            if (existingImg && existingImg.src) {
                attachmentPayload = JSON.stringify({ name: existingImg.alt || 'attachment.jpg', data: existingImg.src });
            } else if (existingDoc && existingDoc.dataset.url) {
                attachmentPayload = JSON.stringify({ name: existingDoc.dataset.name || 'document', data: existingDoc.dataset.url });
            }
        }

        // old_qty resolved below (after DB fetch for insert path, from cell for edit path)
        // It is added to adjDbPayload before inserting/updating so reloads show correct Diff.
        let adjDbPayload = {
            stock_id: stockId,
            product_name: name,
            category: category,
            new_qty: newQty,
            reason: reason,
            attachment_id: attachmentPayload,
            followup_date: followupDate,
            followup_notes: followupNotes,
            product_id: linkedProductId || null
            // old_qty is set below before insert/update
        };

        if (!wasEditing && typeof sbInsert === 'function') {
            let parentStock = null;
            if (typeof sbSelectAll === 'function') {
                try {
                    const { data: psRows } = _requireDbSuccess(
                        await sbSelectAll(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }),
                        'Failed to read Product Stock'
                    );
                    if (!psRows || psRows.length === 0) {
                        const newStatus = computeStockStatus(newQty, '');
                        const { error: parentErr } = await sbInsert(PRODUCT_STOCK_TABLE, {
                            stock_id: stockId,
                            product_name: name,
                            category: category,
                            qty_in: newQty,
                            qty_out: 0,
                            status: newStatus,
                            attachment_id: null,
                            product_id: linkedProductId || null
                        });
                        if (parentErr) {
                            if (String(parentErr.message || '').includes('duplicate') || parentErr.code === '23505') {
                                const { data: retryRows } = _requireDbSuccess(
                                    await sbSelectAll(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }),
                                    'Failed to re-read Product Stock after duplicate detection'
                                );
                                parentStock = retryRows && retryRows[0] ? retryRows[0] : null;
                                if (parentStock) {
                                    _requireDbSuccess(
                                        await sbUpdate(PRODUCT_STOCK_TABLE, { 'id': `eq.${parentStock.id}` }, { qty_in: newQty, status: computeStockStatus(newQty, parentStock.status || ''), product_id: linkedProductId || undefined }),
                                        'Failed to update Product Stock'
                                    );
                                }
                            } else {
                                throw new Error('Failed to link this record to Product Stock: ' + (parentErr.message || JSON.stringify(parentErr)));
                            }
                        }
                    } else {
                        parentStock = psRows[0];
                        // dedup: keep first, delete rest
                        if (psRows.length > 1) {
                            for (let k = 1; k < psRows.length; k++) {
                                _requireDbSuccess(
                                    await sbDelete(PRODUCT_STOCK_TABLE, { 'id': `eq.${psRows[k].id}` }),
                                    'Failed to remove duplicate Product Stock record'
                                );
                            }
                        }
                        const updStatus = computeStockStatus(newQty, parentStock.status || '');
                        _requireDbSuccess(
                            await sbUpdate(PRODUCT_STOCK_TABLE, { 'id': `eq.${parentStock.id}` }, { qty_in: newQty, status: updStatus, product_id: linkedProductId || undefined }),
                            'Failed to update Product Stock'
                        );
                    }
                } catch (e) {
                    throw new Error(`Failed to prepare Product Stock: ${e.message || e}`);
                }
            }

            if (parentStock) {
                oldQty = parseInt(parentStock.qty_in) || 0;
            } else {
                const domStockRow = Array.from(document.querySelectorAll('#stock-tbody tr')).find(r => r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase());
                if (domStockRow) {
                    oldQty = parseInt(domStockRow.cells[3]?.textContent.trim(), 10) || 0;
                }
            }

            // Store old_qty in payload before inserting/updating so reloads show correct Diff
            adjDbPayload.old_qty = oldQty;

            // Check if this stock_id already has an adjustment row in ADJUSTMENTS_TABLE
            let existingAdj = null;
            if (typeof sbSelectAll === 'function') {
                try {
                    const { data: existingRows } = _requireDbSuccess(
                        await sbSelectAll(ADJUSTMENTS_TABLE, { 'stock_id': `eq.${stockId}` }),
                        'Failed to read existing adjustments'
                    );
                    if (existingRows && existingRows.length > 0) {
                        existingAdj = existingRows[0];
                        // If there are multiple existing adjustment rows for this stock_id, clean up older duplicates
                        for (let k = 1; k < existingRows.length; k++) {
                            _requireDbSuccess(
                                await sbDelete(ADJUSTMENTS_TABLE, { 'id': `eq.${existingRows[k].id}` }),
                                'Failed to remove duplicate adjustment'
                            );
                        }
                    }
                } catch (e) {
                    throw new Error(`Failed to prepare adjustment record: ${e.message || e}`);
                }
            }

            if (existingAdj) {
                const res = await sbUpdate(ADJUSTMENTS_TABLE, { 'id': `eq.${existingAdj.id}` }, adjDbPayload);
                insertedId = existingAdj.id;
                if (res?.error) {
                    alert('Failed to update adjustment in database: ' + (res.error.message || JSON.stringify(res.error)));
                    return;
                }
            } else {
                const res = await sbInsert(ADJUSTMENTS_TABLE, adjDbPayload);
                if (res.data) insertedId = res.data.id;
                if (res?.error) {
                    alert('Failed to save the adjustment to the database: ' + (res.error.message || JSON.stringify(res.error)));
                    return;
                }
            }

            // Fetch existing status to preserve manual statuses
            let existingStatus = '';
            if (typeof sbSelect === 'function') {
                const statusResult = _requireDbSuccess(
                    await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }),
                    'Failed to read Product Stock status'
                );
                if (statusResult.data) existingStatus = statusResult.data.status || '';
            }
            const adjStatus = computeStockStatus(newQty, existingStatus);
            const curQtyOut = parentStock ? (parseInt(parentStock.qty_out) || 0) : 0;
            const adjustedQtyIn = newQty + curQtyOut;
            _requireDbSuccess(
                await sbUpdate(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }, { qty_in: adjustedQtyIn, status: adjStatus }),
                'Failed to update Product Stock'
            );
            _requireDbSuccess(
                await sbUpdate(window.PRODUCTS_TABLE, { 'client_tag_number': `eq.${stockId}` }, { status: adjStatus }),
                'Failed to update Products status'
            );
            _requireDbSuccess(
                await sbUpdate(STOCK_IN_TABLE, { 'stock_id': `eq.${stockId}` }, { status: adjStatus }),
                'Failed to update Stock In status'
            );
            _requireDbSuccess(
                await sbUpdate(STOCK_OUT_TABLE, { 'stock_id': `eq.${stockId}` }, { status: adjStatus }),
                'Failed to update Stock Out status'
            );
            if (window._stockBalanceMap) window._stockBalanceMap[stockId.toLowerCase()] = newQty;
        } else if (wasEditing && typeof sbUpdate === 'function') {
            // FIX Bug 3: capture old_qty from current cell before updating
            const editOldQty = parseInt(_editingAdjustmentRow.cells[3]?.textContent.trim()) || 0;
            adjDbPayload.old_qty = editOldQty;

            const dbId = _editingAdjustmentRow?.dataset?.editingId || _editingAdjustmentRow?.dataset?.id;
            _requireDbSuccess(
                dbId
                    ? await sbUpdate(ADJUSTMENTS_TABLE, { 'id': `eq.${dbId}` }, adjDbPayload)
                    : await sbUpdate(ADJUSTMENTS_TABLE, { 'stock_id': `eq.${stockId}` }, adjDbPayload),
                'Failed to save your changes to the database'
            );

            // Fetch existing status to preserve manual statuses
            let existingStatus = '';
            if (typeof sbSelect === 'function') {
                const statusResult = _requireDbSuccess(
                    await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }),
                    'Failed to read Product Stock status'
                );
                if (statusResult.data) existingStatus = statusResult.data.status || '';
            }
            const editStatus = computeStockStatus(newQty, existingStatus);
            let curQtyOut = 0;
            if (typeof sbSelect === 'function') {
                const stockResult = _requireDbSuccess(
                    await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }),
                    'Failed to read Product Stock quantity'
                );
                if (stockResult.data) curQtyOut = parseInt(stockResult.data.qty_out) || 0;
            }
            const editQtyIn = newQty + curQtyOut;
            _requireDbSuccess(
                await sbUpdate(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }, { qty_in: editQtyIn, status: editStatus, product_id: linkedProductId || undefined }),
                'Failed to update Product Stock'
            );
            _requireDbSuccess(
                await sbUpdate(window.PRODUCTS_TABLE, { 'client_tag_number': `eq.${stockId}` }, { status: editStatus }),
                'Failed to update Products status'
            );
            _requireDbSuccess(
                await sbUpdate(STOCK_IN_TABLE, { 'stock_id': `eq.${stockId}` }, { status: editStatus }),
                'Failed to update Stock In status'
            );
            _requireDbSuccess(
                await sbUpdate(STOCK_OUT_TABLE, { 'stock_id': `eq.${stockId}` }, { status: editStatus }),
                'Failed to update Stock Out status'
            );
            if (window._stockBalanceMap) window._stockBalanceMap[stockId.toLowerCase()] = newQty;
        }

        // Update live DOM rows for stock in and stock out if present
        document.querySelectorAll('#stock-in-tbody tr').forEach(r => {
            if (r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase()) {
                if (r.cells[4]) r.cells[4].textContent = newQty;
            }
        });
        document.querySelectorAll('#stock-out-tbody tr').forEach(r => {
            if (r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase()) {
                if (r.cells[4]) r.cells[4].textContent = newQty;
            }
        });

        // FIX Bug 1: remove manual DOM insert — reload from DB as single source of truth.
        // This prevents the double-row that occurred when loadAdjustmentsFromDB() was
        // triggered again (by tab switch or loadProductStockFromDB) right after manual insert.
        if (_editingAdjustmentRow) {
            const editOldQty = parseInt(_editingAdjustmentRow.cells[3]?.textContent.trim()) || 0;
            const diff = newQty - editOldQty;
            const diffStr = (diff >= 0 ? '+' : '') + diff;
            logAudit('Edited', 'Adjustments', `${getCurrentUser()} updated Adjustment for "${name}" (ID: ${stockId}) [New Qty: ${newQty}, Diff: ${diffStr}, Reason: ${reason}]`, stockId, name);
            _editingAdjustmentRow = null;
        } else {
            const diff = newQty - oldQty;
            const diffStr = (diff >= 0 ? '+' : '') + diff;
            logAudit('Added', 'Adjustments', `${getCurrentUser()} logged Adjustment for "${name}" (ID: ${stockId}) [New Qty: ${newQty}, Diff: ${diffStr}, Reason: ${reason}]`, stockId, name);
        }

        updateDashboardStats();
        // Recalculate and sync status/balance across all tables (preserves manual statuses)
        await recalcProductStockByStockId(stockId, '', { throwOnError: true });
        // Refresh visible tables together instead of waiting through four sequential requests.
        await Promise.all([
            typeof loadAdjustmentsFromDB === 'function' ? loadAdjustmentsFromDB() : Promise.resolve(),
            typeof loadProductStockFromDB === 'function' ? loadProductStockFromDB() : Promise.resolve(),
            typeof loadStockInFromDB === 'function' ? loadStockInFromDB() : Promise.resolve(),
            typeof loadStockOutFromDB === 'function' ? loadStockOutFromDB() : Promise.resolve()
        ]);
    } catch (e) {
        const message = e?.message || String(e);
        console.error('saveAdjustmentRecord error:', e);
        alert(`Adjustment save failed or only partially completed.\n\n${message}\n\nPlease refresh the data before trying again.`);
    } finally {
        window._savingAdj = false;
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = originalBtnText;
        }
        closeAdjustmentModal();
    }
}
window.saveAdjustmentRecord = saveAdjustmentRecord;

function openAdjMenu(btn) {
    const menu = document.getElementById('adj-context-menu');
    if (!menu || !btn) return;
    _adjActiveBtn = btn;
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX - menu.offsetWidth + rect.width) + 'px';
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', closeAdjMenuOutside, { once: true }), 10);
}
window.openAdjMenu = openAdjMenu;

function closeAdjMenuOutside(e) {
    const menu = document.getElementById('adj-context-menu');
    if (menu && !menu.contains(e.target)) menu.classList.add('hidden');
}
window.closeAdjMenuOutside = closeAdjMenuOutside;

async function deleteAdjustmentRow() {
    if (_adjActiveBtn) {
        const row = _adjActiveBtn.closest('tr');
        if (row) {
            const dbId = row.dataset.id;
            const sid = row.cells[0]?.textContent.trim();
            const sname = row.cells[1]?.textContent.trim();

            if (!confirm(`Are you sure you want to delete Adjustment record for "${sname}" (ID: ${sid})?`)) {
                document.getElementById('adj-context-menu')?.classList.add('hidden');
                return;
            }

            if (typeof sbDelete === 'function') {
                if (dbId) {
                    const { error } = await sbDelete(ADJUSTMENTS_TABLE, { 'id': `eq.${dbId}` });
                    if (error) console.warn('Adjustment DB delete error:', error);
                } else if (sid && sid !== '' && sid !== '-') {
                    const { error } = await sbDelete(ADJUSTMENTS_TABLE, { 'stock_id': `eq.${sid}` });
                    if (error) console.warn('Adjustment DB delete error:', error);
                }
            }

            row.remove();
            logAudit('Deleted', 'Adjustments', `${getCurrentUser()} deleted Adjustment entry for "${sname}" (ID: ${sid})`, sid, sname);
            if (sid && sid !== '' && sid !== '-') {
                await recalcProductStockByStockId(sid);
            }
            saveAllMovementTables();
            updateDashboardStats();
            if (typeof loadProductStockFromDB === 'function') await loadProductStockFromDB();
        }
    }
    document.getElementById('adj-context-menu')?.classList.add('hidden');
    const rows = document.querySelectorAll('#adj-tbody tr');
    if (rows.length === 0) document.getElementById('adj-empty')?.classList.remove('hidden');
}
window.deleteAdjustmentRow = deleteAdjustmentRow;

function editAdjustmentRow() {
    document.getElementById('adj-context-menu')?.classList.add('hidden');
    if (!_adjActiveBtn) return;
    _editingAdjustmentRow = _adjActiveBtn.closest('tr');
    if (!_editingAdjustmentRow) return;

    const cells = _editingAdjustmentRow.cells;
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

    setVal('adj-stock-id', cells[0]?.textContent.trim());
    setVal('adj-product-name', cells[1]?.textContent.trim());
    setVal('adj-category', cells[2]?.textContent.trim());
    setVal('adj-new-qty', cells[4]?.textContent.trim());
    setVal('adj-reason', cells[6]?.textContent.trim() || 'Correction');
    setVal('adj-followup-date', _editingAdjustmentRow.dataset.followupDate || '');
    setVal('adj-followup-notes', _editingAdjustmentRow.dataset.followupNotes || '');

    // Store the database row id for use in update
    _editingAdjustmentRow.dataset.editingId = _editingAdjustmentRow.dataset.id || '';

    // Preload existing attachment if present (column 8 on adjustments)
    const attachCell = cells[8];
    const imgEl = attachCell ? attachCell.querySelector('img') : null;
    const docEl = attachCell ? attachCell.querySelector('.attachment-thumb[data-url]') : null;

    resetModalAttachment('adj');
    if (imgEl && imgEl.src) {
        _modalAttachState['adj'] = {
            base64: imgEl.src,
            name: imgEl.alt || 'attachment.jpg',
            removed: false
        };
        _renderModalAttachPreview('adj', imgEl.src, imgEl.alt || 'attachment.jpg');
    } else if (docEl && docEl.dataset.url) {
        _modalAttachState['adj'] = {
            base64: docEl.dataset.url,
            name: docEl.dataset.name || 'attachment.pdf',
            removed: false
        };
        _renderModalAttachPreview('adj', docEl.dataset.url, docEl.dataset.name || 'attachment.pdf');
    }

    if (typeof window.populateLinkedProductDropdowns === 'function') {
        window.populateLinkedProductDropdowns();
    }

    const modal = document.getElementById('adj-modal');
    if (modal) {
        const title = modal.querySelector('.modal-header h2');
        if (title) title.textContent = 'Edit Stock Adjustment';
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) saveBtn.textContent = 'Update Record';
        modal.classList.remove('hidden');
    }
}
window.editAdjustmentRow = editAdjustmentRow;


// ======== 8. CONTEXT MENUS & ROW ACTIONS (PRODUCT STOCK) ========

let _stkActiveBtn = null;

function openStockMenu(btn) {
    const menu = document.getElementById('stock-context-menu');
    if (!menu || !btn) return;
    _stkActiveBtn = btn;
    const rect = btn.getBoundingClientRect();
    menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    menu.style.left = (rect.left + window.scrollX - menu.offsetWidth + rect.width) + 'px';
    menu.classList.remove('hidden');
    setTimeout(() => document.addEventListener('click', closeStockMenuOutside, { once: true }), 10);
}
window.openStockMenu = openStockMenu;

function closeStockMenuOutside(e) {
    const menu = document.getElementById('stock-context-menu');
    if (menu && !menu.contains(e.target)) menu.classList.add('hidden');
}
window.closeStockMenuOutside = closeStockMenuOutside;

function editStockRow() {
    document.getElementById('stock-context-menu')?.classList.add('hidden');
    if (!_stkActiveBtn) return;
    _editingStockRow = _stkActiveBtn.closest('tr');
    if (!_editingStockRow) return;

    const cells = _editingStockRow.cells;
    const stockId = cells[0]?.textContent.trim() || '';

    // Find linked master product data if available
    let prodData = _editingStockRow._productData || null;
    if (!prodData && Array.isArray(window._allMasterProducts)) {
        prodData = window._allMasterProducts.find(p =>
            (_editingStockRow.dataset.productId && (String(p.product_id) === String(_editingStockRow.dataset.productId) || String(p.id) === String(_editingStockRow.dataset.productId))) ||
            (p.client_tag_number && p.client_tag_number.trim().toLowerCase() === stockId.toLowerCase())
        );
    }

    if (prodData) {
        _editingStockRow._productData = prodData;
        _editingStockRow.dataset.productId = prodData.product_id || prodData.id || _editingStockRow.dataset.productId || '';
    }

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };
    setVal('stk-stock-id', stockId);
    setVal('stk-product-name', prodData?.item_name || cells[1]?.textContent.trim() || 'Item');
    setVal('stk-category', prodData?.category || cells[2]?.textContent.trim() || 'General');
    setVal('stk-serial-number', prodData?.serial_number || '');
    setVal('stk-project', prodData?.project || '');
    setVal('stk-date-received', prodData?.date_received || '');
    setVal('stk-issued-do', prodData?.issued_do || '');
    setVal('stk-warranty', prodData?.warranty_description || '');
    setVal('stk-remarks', prodData?.remarks || '');

    const badge = cells[7]?.querySelector('.badge');
    let statusVal = badge ? badge.textContent.trim() : (cells[7]?.textContent.trim() || prodData?.status || 'In Stock');
    if (statusVal.toLowerCase() === 'available') statusVal = 'In Stock';
    const sel = document.getElementById('stk-status');
    if (sel) {
        [...sel.options].forEach(o => {
            if (o.value.toLowerCase() === 'available' || o.textContent.trim().toLowerCase() === 'available') {
                o.remove();
            }
        });
        let matched = false;
        [...sel.options].forEach(o => {
            if (o.value.toLowerCase() === statusVal.toLowerCase()) {
                o.selected = true;
                matched = true;
            }
        });
        if (!matched) sel.value = 'In Stock';
    }

    // Store the database row id for use in update
    _editingStockRow.dataset.editingId = _editingStockRow.dataset.dbId || _editingStockRow.dataset.id || '';
    window._originalEditingTag = stockId;
    window._editingStockRow = _editingStockRow;

    _stkAttachmentRemoved = false;
    window._stkAttachmentRemoved = false;
    _stkFileBase64 = null;
    _stkFileName = '';
    window._stkFileBase64 = null;
    window._stkFileName = '';

    // Preload attachment if available from master product
    const pAtt = prodData?.attachments;
    if (pAtt) {
        let existingUrl = '';
        let existingName = 'Attachment';
        if (typeof pAtt === 'string') {
            try {
                const parsed = JSON.parse(pAtt);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    existingUrl = parsed[0].data || parsed[0].url || '';
                    existingName = parsed[0].name || 'Attachment';
                } else if (typeof parsed === 'object' && parsed !== null) {
                    existingUrl = parsed.data || parsed.url || '';
                    existingName = parsed.name || 'Attachment';
                }
            } catch (e) {
                existingUrl = pAtt;
                existingName = pAtt.split('/').pop() || 'Attachment';
            }
        } else if (typeof pAtt === 'object') {
            if (Array.isArray(pAtt) && pAtt.length > 0) {
                existingUrl = pAtt[0].data || pAtt[0].url || '';
                existingName = pAtt[0].name || 'Attachment';
            } else {
                existingUrl = pAtt.data || pAtt.url || '';
                existingName = pAtt.name || 'Attachment';
            }
        }
        if (existingUrl) {
            _stkFileBase64 = existingUrl;
            _stkFileName = existingName;
            window._stkFileBase64 = existingUrl;
            window._stkFileName = existingName;
            if (typeof showModalAttachmentPreview === 'function') showModalAttachmentPreview(existingUrl, existingName);
        } else if (typeof showModalAttachmentPreview === 'function') {
            showModalAttachmentPreview(null);
        }
    } else if (typeof showModalAttachmentPreview === 'function') {
        showModalAttachmentPreview(null);
    }

    const modal = document.getElementById('stock-modal');
    if (modal) {
        modal.querySelector('.modal-header h2').textContent = 'Edit Stock Record';
        const saveBtn = modal.querySelector('.modal-footer .btn-primary');
        if (saveBtn) saveBtn.textContent = 'Update Record';
        modal.classList.remove('hidden');
    }
}
window.editStockRow = editStockRow;

async function deleteStockRow() {
    if (_stkActiveBtn) {
        const row = _stkActiveBtn.closest('tr');
        if (row) {
            const dbId = row.dataset.id;
            const sid = row.cells[0]?.textContent.trim();
            const sname = row.cells[1]?.textContent.trim();

            if (!confirm(`Are you sure you want to delete Product Stock record for "${sname}" (ID: ${sid})?`)) {
                document.getElementById('stock-context-menu')?.classList.add('hidden');
                return;
            }

            if (typeof sbDelete === 'function') {
                const targetId = (sid && sid !== '' && sid !== '-') ? sid : dbId;
                if (targetId) {
                    try { await sbDelete(STOCK_IN_TABLE, { 'stock_id': `eq.${targetId}` }); } catch (e) { }
                    try { await sbDelete(STOCK_OUT_TABLE, { 'stock_id': `eq.${targetId}` }); } catch (e) { }
                    try { await sbDelete(ADJUSTMENTS_TABLE, { 'stock_id': `eq.${targetId}` }); } catch (e) { }
                    const { error } = await sbDelete(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${targetId}` });
                    if (error) {
                        console.warn('Product Stock DB delete error:', error);
                        alert('Failed to delete Stock Record from database: ' + (error.message || JSON.stringify(error)));
                        return;
                    }
                }
            }

            row.remove();
            logAudit('Deleted', 'Stock Record', `${getCurrentUser()} deleted Stock Record for "${sname}" (ID: ${sid})`, sid, sname);
            saveAllMovementTables();
            updateDashboardStats();
            if (typeof window.loadProductsFromDB === 'function') window.loadProductsFromDB();
            if (typeof window.populateLinkedProductDropdowns === 'function') window.populateLinkedProductDropdowns(true);
        }
    }
    document.getElementById('stock-context-menu')?.classList.add('hidden');
    const rows = document.querySelectorAll('#stock-tbody tr');
    if (rows.length === 0) document.getElementById('stock-empty')?.classList.remove('hidden');
}
window.deleteStockRow = deleteStockRow;


// ======== 9. FILTERS ACROSS PAGES WITH SMART NORMALIZED MATCHING ========

function normalizeProductString(str) {
    return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
window.normalizeProductString = normalizeProductString;

function levenshteinDistance(s1, s2) {
    if (s1 === s2) return 0;
    if (!s1.length) return s2.length;
    if (!s2.length) return s1.length;
    const v0 = new Array(s2.length + 1);
    const v1 = new Array(s2.length + 1);
    for (let i = 0; i <= s2.length; i++) v0[i] = i;
    for (let i = 0; i < s1.length; i++) {
        v1[0] = i + 1;
        for (let j = 0; j < s2.length; j++) {
            const cost = s1[i] === s2[j] ? 0 : 1;
            v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost);
        }
        for (let j = 0; j <= s2.length; j++) v0[j] = v1[j];
    }
    return v1[s2.length];
}

function isSimilarWord(w1, w2) {
    if (w1 === w2) return true;
    if (w1.length < 3 || w2.length < 3) return w1 === w2;
    const dist = levenshteinDistance(w1, w2);
    if (dist <= 2 && Math.abs(w1.length - w2.length) <= 1) return true;
    const maxLen = Math.max(w1.length, w2.length);
    return (dist / maxLen) <= 0.25;
}

function isSimilarProductName(name1, name2) {
    if (!name1 || !name2) return false;
    const n1 = normalizeProductString(name1);
    const n2 = normalizeProductString(name2);
    if (n1 === n2) return true;
    if (n1.includes(n2) || n2.includes(n1)) return true;

    const tokens1 = n1.split(' ').filter(t => t.length > 1);
    const tokens2 = n2.split(' ').filter(t => t.length > 1);
    if (!tokens1.length || !tokens2.length) return false;

    let matched = 0;
    tokens1.forEach(t1 => {
        if (tokens2.some(t2 => isSimilarWord(t1, t2))) matched++;
    });
    return (matched / Math.min(tokens1.length, tokens2.length)) >= 0.7;
}
window.isSimilarProductName = isSimilarProductName;

function parseDateToYMD(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        return str.slice(0, 10);
    }
    const dt = new Date(str);
    if (!isNaN(dt.getTime())) {
        const y = dt.getFullYear();
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const d = String(dt.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }
    return null;
}
window.parseDateToYMD = parseDateToYMD;

function clearProductsDateFilter() {
    const fromEl = document.getElementById('products-from-date');
    const toEl = document.getElementById('products-to-date');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    filterProducts();
}
window.clearProductsDateFilter = clearProductsDateFilter;

function clearStockDateFilter() {
    const fromEl = document.getElementById('stock-from-date');
    const toEl = document.getElementById('stock-to-date');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    filterStock();
}
window.clearStockDateFilter = clearStockDateFilter;

function filterProducts() {
    const search = (document.getElementById('products-search')?.value || '').toLowerCase().trim();
    const prodName = document.getElementById('products-name-filter')?.value || '';
    const category = document.getElementById('products-category-filter')?.value || '';
    const status = document.getElementById('products-status-filter')?.value || '';
    const fromDate = document.getElementById('products-from-date')?.value || '';
    const toDate = document.getElementById('products-to-date')?.value || '';
    const rows = document.querySelectorAll('#products-tbody tr');
    let visible = 0;
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        const name = row.cells[1]?.textContent.trim() || 'Item';
        const cat = row.cells[2]?.textContent.trim() || 'General';
        const rowStatus = row.cells[7]?.textContent.trim() || '';
        const matchSearch = !search || text.includes(search) || isSimilarProductName(name, search);
        const matchName = !prodName || isSimilarProductName(name, prodName);
        const matchCat = !category || cat.toLowerCase() === category.toLowerCase();
        const matchStatus = !status || rowStatus.toLowerCase() === status.toLowerCase();

        let matchDate = true;
        if (fromDate || toDate) {
            let dStr = row.dataset.dateReceived || row._productData?.date_received || row.dataset.createdAt || row._productData?.created_at;
            if (!dStr) {
                const cellText = row.cells[5]?.textContent.trim();
                if (cellText && cellText !== '—' && cellText !== '-') {
                    dStr = cellText;
                }
            }
            const rowDate = parseDateToYMD(dStr);
            if (rowDate) {
                if (fromDate && rowDate < fromDate) matchDate = false;
                if (toDate && rowDate > toDate) matchDate = false;
            } else {
                matchDate = false;
            }
        }

        if (matchSearch && matchName && matchCat && matchStatus && matchDate) { row.style.display = ''; visible++; }
        else row.style.display = 'none';
    });
    document.getElementById('products-empty')?.classList.toggle('hidden', visible > 0);
}
window.filterProducts = filterProducts;

function filterStock() {
    const search = (document.getElementById('stock-search')?.value || '').toLowerCase().trim();
    const prodName = document.getElementById('stock-name-filter')?.value || '';
    const category = document.getElementById('stock-category-filter')?.value || '';
    const status = document.getElementById('stock-status-filter')?.value || '';
    const fromDate = document.getElementById('stock-from-date')?.value || '';
    const toDate = document.getElementById('stock-to-date')?.value || '';
    const rows = document.querySelectorAll('#stock-tbody tr');
    let visible = 0;
    rows.forEach(row => {
        const id = row.cells[0]?.textContent.toLowerCase().trim() || '';
        const name = row.cells[1]?.textContent.trim() || 'Item';
        const cat = row.cells[2]?.textContent.trim() || 'General';
        const rowStatus = row.cells[7]?.textContent.trim() || '';
        const matchSearch = !search || id.includes(search) || isSimilarProductName(name, search) || name.toLowerCase().includes(search);
        const matchName = !prodName || isSimilarProductName(name, prodName);
        const matchCat = !category || cat.toLowerCase() === category.toLowerCase();
        const matchStatus = !status || rowStatus.toLowerCase() === status.toLowerCase();

        let matchDate = true;
        if (fromDate || toDate) {
            let dStr = row.dataset.updatedAt || row.dataset.createdAt || row._stockData?.updated_at || row._stockData?.created_at;
            if (!dStr) {
                const cellText = row.cells[9]?.textContent.trim();
                if (cellText && cellText !== '—' && cellText !== '-') {
                    dStr = cellText;
                }
            }
            const rowDate = parseDateToYMD(dStr);
            if (rowDate) {
                if (fromDate && rowDate < fromDate) matchDate = false;
                if (toDate && rowDate > toDate) matchDate = false;
            } else {
                matchDate = false;
            }
        }

        if (matchSearch && matchName && matchCat && matchStatus && matchDate) { row.style.display = ''; visible++; }
        else row.style.display = 'none';
    });
    document.getElementById('stock-empty')?.classList.toggle('hidden', visible > 0);
}
window.filterStock = filterStock;

function clearStockInDateFilter() {
    const fromEl = document.getElementById('stock-in-from-date');
    const toEl = document.getElementById('stock-in-to-date');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    filterStockIn();
}
window.clearStockInDateFilter = clearStockInDateFilter;

function clearStockOutDateFilter() {
    const fromEl = document.getElementById('stock-out-from-date');
    const toEl = document.getElementById('stock-out-to-date');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    filterStockOut();
}
window.clearStockOutDateFilter = clearStockOutDateFilter;

function filterStockIn() {
    const search = (document.getElementById('stock-in-search')?.value || '').toLowerCase().trim();
    const prodName = document.getElementById('stock-in-name-filter')?.value || '';
    const category = document.getElementById('stock-in-category-filter')?.value || '';
    const status = document.getElementById('stock-in-status-filter')?.value || '';
    const fromDate = document.getElementById('stock-in-from-date')?.value || '';
    const toDate = document.getElementById('stock-in-to-date')?.value || '';

    const rows = document.querySelectorAll('#stock-in-tbody tr');
    let visible = 0;
    rows.forEach(row => {
        const id = row.cells[0]?.textContent.toLowerCase().trim() || '';
        const name = row.cells[1]?.textContent.trim() || 'Item';
        const cat = row.cells[2]?.textContent.trim() || 'General';
        const rowStatus = row.cells[7]?.textContent.trim() || '';
        const matchSearch = !search || id.includes(search) || isSimilarProductName(name, search) || name.toLowerCase().includes(search);
        const matchName = !prodName || isSimilarProductName(name, prodName);
        const matchCat = !category || cat.toLowerCase() === category.toLowerCase();
        const matchStatus = !status || rowStatus.toLowerCase() === status.toLowerCase();

        let matchDate = true;
        if (fromDate || toDate) {
            const dateStr = row.dataset.createdAt || row.dataset.followupDate || '';
            if (dateStr) {
                const d = parseDateToYMD(dateStr);
                if (d) {
                    if (fromDate && d < fromDate) matchDate = false;
                    if (toDate && d > toDate) matchDate = false;
                } else {
                    matchDate = false;
                }
            }
        }

        if (matchSearch && matchName && matchCat && matchStatus && matchDate) { row.style.display = ''; visible++; }
        else row.style.display = 'none';
    });
    document.getElementById('stock-in-empty')?.classList.toggle('hidden', visible > 0);
}
window.filterStockIn = filterStockIn;

function filterStockOut() {
    const search = (document.getElementById('stock-out-search')?.value || '').toLowerCase().trim();
    const prodName = document.getElementById('stock-out-name-filter')?.value || '';
    const category = document.getElementById('stock-out-category-filter')?.value || '';
    const status = document.getElementById('stock-out-status-filter')?.value || '';
    const fromDate = document.getElementById('stock-out-from-date')?.value || '';
    const toDate = document.getElementById('stock-out-to-date')?.value || '';

    const rows = document.querySelectorAll('#stock-out-tbody tr');
    let visible = 0;
    rows.forEach(row => {
        const id = row.cells[0]?.textContent.toLowerCase().trim() || '';
        const name = row.cells[1]?.textContent.trim() || 'Item';
        const cat = row.cells[2]?.textContent.trim() || 'General';
        const rowStatus = row.cells[5]?.textContent.trim() || '';
        const matchSearch = !search || id.includes(search) || isSimilarProductName(name, search) || name.toLowerCase().includes(search);
        const matchName = !prodName || isSimilarProductName(name, prodName);
        const matchCat = !category || cat.toLowerCase() === category.toLowerCase();
        const matchStatus = !status || rowStatus.toLowerCase() === status.toLowerCase();

        let matchDate = true;
        if (fromDate || toDate) {
            const dateStr = row.dataset.createdAt || row.cells[6]?.textContent.trim() || '';
            if (dateStr) {
                const d = parseDateToYMD(dateStr);
                if (d) {
                    if (fromDate && d < fromDate) matchDate = false;
                    if (toDate && d > toDate) matchDate = false;
                } else {
                    matchDate = false;
                }
            }
        }

        if (matchSearch && matchName && matchCat && matchStatus && matchDate) { row.style.display = ''; visible++; }
        else row.style.display = 'none';
    });
    document.getElementById('stock-out-empty')?.classList.toggle('hidden', visible > 0);
}
window.filterStockOut = filterStockOut;

function filterAdjustments() {
    const search = (document.getElementById('adj-search')?.value || '').toLowerCase().trim();
    const prodName = document.getElementById('adj-name-filter')?.value || '';
    const category = document.getElementById('adj-category-filter')?.value || '';
    const rows = document.querySelectorAll('#adj-tbody tr');
    let visible = 0;
    rows.forEach(row => {
        const id = row.cells[0]?.textContent.toLowerCase().trim() || '';
        const name = row.cells[1]?.textContent.trim() || 'Item';
        const cat = row.cells[2]?.textContent.trim() || 'General';
        const matchSearch = !search || id.includes(search) || isSimilarProductName(name, search) || name.toLowerCase().includes(search);
        const matchName = !prodName || isSimilarProductName(name, prodName);
        const matchCat = !category || cat.toLowerCase() === category.toLowerCase();
        if (matchSearch && matchName && matchCat) { row.style.display = ''; visible++; }
        else row.style.display = 'none';
    });
    document.getElementById('adj-empty')?.classList.toggle('hidden', visible > 0);
}
window.filterAdjustments = filterAdjustments;


// ======== 10. ATTACHMENT VIEWERS & LIGHTBOX ========

let _currentAttachmentUrl = '';
let _currentAttachmentName = '';

function base64ToBlob(base64Data, contentType = '') {
    const parts = base64Data.split(';base64,');
    const type = contentType || (parts[0] ? parts[0].replace('data:', '') : '');
    const raw = window.atob(parts.length > 1 ? parts[1] : parts[0]);
    const rawLength = raw.length;
    const uInt8Array = new Uint8Array(rawLength);
    for (let i = 0; i < rawLength; ++i) {
        uInt8Array[i] = raw.charCodeAt(i);
    }
    return new Blob([uInt8Array], { type: type || 'application/octet-stream' });
}

function openAttachmentOutside(fileUrl, fileName) {
    const url = fileUrl || _currentAttachmentUrl;
    const name = fileName || _currentAttachmentName || 'file';
    if (!url) return;

    if (url.startsWith('data:')) {
        try {
            const mime = url.substring(url.indexOf(':') + 1, url.indexOf(';'));
            const blob = base64ToBlob(url, mime);
            const blobUrl = URL.createObjectURL(blob);
            window.open(blobUrl, '_blank');
        } catch (e) {
            const win = window.open();
            if (win) win.document.write(`<iframe src="${url}" frameborder="0" style="border:0; top:0; left:0; bottom:0; right:0; width:100%; height:100%;" allowfullscreen></iframe>`);
        }
    } else {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
}
window.openAttachmentOutside = openAttachmentOutside;

function viewAttachment(fileUrl, fileName) {
    _currentAttachmentUrl = fileUrl || '';
    _currentAttachmentName = fileName || 'Attachment';

    const modal = document.getElementById('attachment-modal');
    const title = document.getElementById('attachment-modal-title');
    const body = document.getElementById('attachment-modal-body');
    const downloadBtn = document.getElementById('attachment-modal-download');

    if (!modal || !body) return;

    title.textContent = fileName || 'Attachment Preview';
    downloadBtn.href = fileUrl;
    downloadBtn.download = fileName || 'download';

    const isImage = fileUrl.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(fileName);
    const isPDF = fileUrl.startsWith('data:application/pdf') || /\.pdf$/i.test(fileName);

    if (isImage) {
        body.innerHTML = `<img src="${fileUrl}" alt="${escapeHtml(fileName)}" style="max-width: 100%; max-height: 55vh; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); object-fit: contain; cursor: pointer;" title="Click to open outside" onclick="openAttachmentOutside()">`;
    } else if (isPDF) {
        body.innerHTML = `<iframe src="${fileUrl}" style="width: 100%; height: 55vh; border: 1px solid #cbd5e1; border-radius: 8px;"></iframe>`;
    } else {
        body.innerHTML = `
            <div style="padding: 30px; text-align: center;">
                <i class="ph ph-file-arrow-down" style="font-size: 3.5rem; color: #3b82f6; margin-bottom: 12px; display: block;"></i>
                <div style="font-weight: 600; font-size: 1rem; color: #1e293b; margin-bottom: 6px;">${escapeHtml(fileName)}</div>
                <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 14px;">Preview is not available directly in modal. Click below to view outside or download.</div>
                <button type="button" class="btn-primary" onclick="openAttachmentOutside()" style="display:inline-flex; align-items:center; gap:6px;">
                    <i class="ph ph-arrow-square-out"></i> Open in New Tab
                </button>
            </div>
        `;
    }

    modal.classList.remove('hidden');
}
window.viewAttachment = viewAttachment;

function closeAttachmentModal() {
    const modal = document.getElementById('attachment-modal');
    if (modal) modal.classList.add('hidden');
}
window.closeAttachmentModal = closeAttachmentModal;

function openLightbox(imgSrc) {
    if (!imgSrc) return;
    const lightbox = document.getElementById('attachmentLightbox');
    const imgEl = document.getElementById('lightboxImage');
    if (lightbox && imgEl) {
        imgEl.src = imgSrc;
        lightbox.classList.add('active');
        lightbox.style.display = 'flex';
        return;
    }

    // Fallback dynamic lightbox if static element is missing
    let box = document.getElementById('image-lightbox');
    if (!box) {
        box = document.createElement('div');
        box.id = 'image-lightbox';
        box.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(0,0,0,0.85);z-index:99999;display:flex;align-items:center;justify-content:center;cursor:pointer;';
        box.innerHTML = '<img src="" style="max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 8px 32px rgba(0,0,0,0.5);">';
        box.onclick = () => box.remove();
        document.body.appendChild(box);
    }
    box.querySelector('img').src = imgSrc;
}
window.openLightbox = openLightbox;

function closeLightbox(event) {
    if (event && event.target && event.target.tagName === 'IMG') {
        return; // Don't close if clicking on the image itself
    }
    const lightbox = document.getElementById('attachmentLightbox');
    if (lightbox) {
        lightbox.classList.remove('active');
        lightbox.style.display = 'none';
    }
    const box = document.getElementById('image-lightbox');
    if (box) box.remove();
}
window.closeLightbox = closeLightbox;

// Close lightbox on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeLightbox();
        closeAttachmentModal();
    }
});


// ======== 11. AUDIT TRAIL ENGINE ========

let _auditLogs = [];

function getCurrentUser() {
    try {
        const stored = localStorage.getItem('currentUser');
        if (stored) {
            const userObj = JSON.parse(stored);
            if (userObj && (userObj.username || userObj.email)) {
                return userObj.username || userObj.email;
            }
        }
    } catch (e) { }
    return 'Admin';
}
window.getCurrentUser = getCurrentUser;

function loadAuditLogs() {
    try {
        const stored = localStorage.getItem('inventory_audit_logs');
        if (stored) {
            _auditLogs = JSON.parse(stored);
        } else {
            _auditLogs = [
                {
                    id: 4,
                    timestamp: 'Aug 15, 2026, 10:30:00 PM',
                    module: 'Stock In',
                    action: 'Added',
                    recordId: '1-11',
                    recordName: 'Bluetooth Headphones',
                    details: 'Admin added Stock In record for "Bluetooth Headphones" (ID: 1-11) with Qty In: +120, Price: BND 6,014',
                    user: 'Admin'
                },
                {
                    id: 3,
                    timestamp: 'Aug 14, 2026, 04:15:00 PM',
                    module: 'Stock Out',
                    action: 'Added',
                    recordId: '1-12',
                    recordName: 'Office Desk',
                    details: 'Admin logged Stock Out for "Office Desk" (ID: 1-12) with Qty Out: -4, Balance: 26',
                    user: 'Admin'
                },
                {
                    id: 2,
                    timestamp: 'Aug 12, 2026, 02:00:00 PM',
                    module: 'Adjustments',
                    action: 'Edited',
                    recordId: '1-13',
                    recordName: 'Stapler',
                    details: 'Admin updated Adjustment for "Stapler" (ID: 1-13) [New Qty: 45, Diff: +5, Reason: Recount]',
                    user: 'Admin'
                },
                {
                    id: 1,
                    timestamp: 'Aug 10, 2026, 09:00:00 AM',
                    module: 'Product Stock',
                    action: 'Added',
                    recordId: '1-14',
                    recordName: 'A4 Printer Paper',
                    details: 'Admin created initial record for "A4 Printer Paper" (ID: 1-14)',
                    user: 'Admin'
                }
            ];
            localStorage.setItem('inventory_audit_logs', JSON.stringify(_auditLogs));
        }
    } catch (e) {
        _auditLogs = [];
    }
    renderAuditLogsTable(_auditLogs);
}
window.loadAuditLogs = loadAuditLogs;

function logAudit(action, module, details, recordId = '', recordName = '') {
    const user = getCurrentUser();
    const newLog = {
        id: Date.now(),
        timestamp: new Date().toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', second: '2-digit'
        }),
        module: module,
        action: action,
        recordId: recordId,
        recordName: recordName,
        details: details,
        user: user
    };
    _auditLogs.unshift(newLog);
    try {
        localStorage.setItem('inventory_audit_logs', JSON.stringify(_auditLogs));
    } catch (e) { }
    renderAuditLogsTable(_auditLogs);

    // Also persist to Supabase audit_trail table
    if (typeof sbInsert === 'function') {
        Promise.resolve(sbInsert(AUDIT_TRAIL_TABLE, {
            action_type: action,
            action_description: `[${module}] ${details}`
        })).catch(error => {
            console.warn('Audit log database error:', error);
        });
    }
}
window.logAudit = logAudit;

function renderAuditLogsTable(logs) {
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:#94a3b8;">No audit trail events found.</td></tr>';
        return;
    }

    logs.forEach(log => {
        const tr = document.createElement('tr');
        const badgeColor = log.action === 'Added' ? '#10b981' : log.action === 'Edited' ? '#3b82f6' : '#ef4444';
        const badgeBg = log.action === 'Added' ? '#dcfce7' : log.action === 'Edited' ? '#dbeafe' : '#fee2e2';

        tr.innerHTML = `
            <td class="cell-muted" style="white-space:nowrap;font-size:0.8rem;">${escapeHtml(log.timestamp)}</td>
            <td class="cell-bold">${escapeHtml(log.user)}</td>
            <td><span class="badge" style="background:${badgeBg};color:${badgeColor};font-weight:600;">${escapeHtml(log.action)}</span></td>
            <td><span class="cell-muted" style="font-weight:500;">${escapeHtml(log.module)}</span></td>
            <td style="max-width:320px;white-space:normal;font-size:0.825rem;color:#334155;">${escapeHtml(log.details)}</td>
            <td class="cell-muted" style="font-size:0.8rem;">${escapeHtml(log.recordId || '')}</td>
        `;
        tbody.appendChild(tr);
    });
}

function filterAuditLogs() {
    const search = (document.getElementById('audit-search')?.value || '').toLowerCase().trim();
    const action = document.getElementById('audit-action-filter')?.value || '';
    const module = document.getElementById('audit-module-filter')?.value || '';

    const filtered = _auditLogs.filter(log => {
        const text = `${log.timestamp} ${log.user} ${log.action} ${log.module} ${log.details} ${log.recordId} ${log.recordName}`.toLowerCase();
        const matchSearch = !search || text.includes(search);
        const matchAction = !action || log.action === action;
        const matchModule = !module || log.module === module;
        return matchSearch && matchAction && matchModule;
    });

    renderAuditLogsTable(filtered);
}
window.filterAuditLogs = filterAuditLogs;
window.filterAudit = filterAuditLogs;

async function clearAuditLog() {
    if (!confirm('Are you sure you want to clear all audit logs? This cannot be undone.')) return;
    _auditLogs = [];
    renderAuditLogsTable(_auditLogs);
    try { localStorage.removeItem('inventory_audit_logs'); } catch (e) { }
    if (typeof sbDelete === 'function') {
        try {
            await sbDelete(AUDIT_TRAIL_TABLE, { 'id': 'neq.0' });
        } catch (e) { console.warn('Clear audit DB error:', e); }
    }
}
window.clearAuditLog = clearAuditLog;

function viewRecordHistory(recordId, recordName) {
    const modal = document.getElementById('record-history-modal');
    const title = document.getElementById('history-modal-title');
    const subtitle = document.getElementById('history-modal-subtitle');
    const timeline = document.getElementById('history-timeline');

    if (!modal || !timeline) return;

    title.textContent = `History: ${recordName || recordId}`;
    subtitle.textContent = `Audit events and changes for Record ID #${recordId}`;
    timeline.innerHTML = '';

    const relevant = _auditLogs.filter(l => l.recordId === recordId || (recordName && l.recordName === recordName));

    if (relevant.length === 0) {
        timeline.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;">No audit history found for this item.</div>';
    } else {
        relevant.forEach(log => {
            const item = document.createElement('div');
            item.style.cssText = 'border-left:2px solid #cbd5e1;padding-left:16px;margin-bottom:18px;position:relative;';
            item.innerHTML = `
                <div style="position:absolute;left:-6px;top:0;width:10px;height:10px;border-radius:50%;background:#3b82f6;"></div>
                <div style="font-size:0.75rem;color:#64748b;font-weight:600;">${escapeHtml(log.timestamp)}  by ${escapeHtml(log.user)}</div>
                <div style="font-weight:600;font-size:0.85rem;color:#1e293b;margin:2px 0;">${escapeHtml(log.action)} in ${escapeHtml(log.module)}</div>
                <div style="font-size:0.8rem;color:#475569;">${escapeHtml(log.details)}</div>
            `;
            timeline.appendChild(item);
        });
    }

    modal.classList.remove('hidden');
}
window.viewRecordHistory = viewRecordHistory;

function closeRecordHistoryModal() {
    const modal = document.getElementById('record-history-modal');
    if (modal) modal.classList.add('hidden');
}
window.closeRecordHistoryModal = closeRecordHistoryModal;

function viewHistoryFromContextMenu(moduleName) {
    let btn = null;
    if (moduleName === 'Product Stock') btn = _stkActiveBtn;
    else if (moduleName === 'Stock In') btn = _siActiveBtn;
    else if (moduleName === 'Stock Out') btn = _soActiveBtn;
    else if (moduleName === 'Adjustments') btn = _adjActiveBtn;

    if (btn) {
        const row = btn.closest('tr');
        if (row && row.cells.length >= 2) {
            const stockId = row.cells[0].textContent.trim();
            const name = row.cells[1].textContent.trim();
            document.querySelectorAll('.context-menu').forEach(m => m.classList.add('hidden'));
            viewRecordHistory(stockId, name);
            return;
        }
    }
    document.querySelectorAll('.context-menu').forEach(m => m.classList.add('hidden'));
}
window.viewHistoryFromContextMenu = viewHistoryFromContextMenu;

document.addEventListener('DOMContentLoaded', () => {
    loadAuditLogs();
});


// ======== 12. UTILITY HELPERS ========

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

function handleLogout(event) {
    if (event) event.preventDefault();
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}
window.handleLogout = handleLogout;


// ======== 13. SHARED MODAL ATTACHMENT ENGINE ========
// Handles file upload preview for Stock In (si-), Stock Out (so-), and Adjustments (adj-)
// The Products modal (stk-) has its own handlers already wired in dashboard.js sections 4/5.

// Per-modal attachment state: keyed by prefix ('si', 'so', 'adj')
const _modalAttachState = {
    si: { base64: null, name: '', removed: false },
    so: { base64: null, name: '', removed: false },
    adj: { base64: null, name: '', removed: false }
};

/**
 * Called by onchange="handleModalFileSelected('si', event)" on each file input.
 */
function handleModalFileSelected(prefix, e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    if (typeof validateAttachmentFileSize === 'function' && !validateAttachmentFileSize(file)) {
        e.target.value = '';
        return;
    }

    const state = _modalAttachState[prefix];
    state.name = file.name;
    state.removed = false;

    const reader = new FileReader();
    reader.onload = evt => {
        state.base64 = evt.target.result;
        _renderModalAttachPreview(prefix, state.base64, state.name, file.size);
    };
    reader.readAsDataURL(file);
}
window.handleModalFileSelected = handleModalFileSelected;

/**
 * Drag-and-drop handler for modal upload dropzones.
 */
function handleModalDrop(prefix, e) {
    e.preventDefault();
    const files = e.dataTransfer ? e.dataTransfer.files : null;
    if (!files || files.length === 0) return;
    const file = files[0];

    if (typeof validateAttachmentFileSize === 'function' && !validateAttachmentFileSize(file)) {
        return;
    }

    const fileInput = document.getElementById(prefix + '-attachment');
    if (fileInput) {
        try {
            const dt = new DataTransfer();
            dt.items.add(file);
            fileInput.files = dt.files;
        } catch (err) {
            // DataTransfer may not be supported in older contexts; proceed
        }
    }

    const state = _modalAttachState[prefix];
    state.name = file.name;
    state.removed = false;

    const reader = new FileReader();
    reader.onload = evt => {
        state.base64 = evt.target.result;
        _renderModalAttachPreview(prefix, state.base64, state.name, file.size);
    };
    reader.readAsDataURL(file);
}
window.handleModalDrop = handleModalDrop;

/**
 * Called by the X button inside each preview card.
 */
function clearModalAttachment(prefix) {
    const state = _modalAttachState[prefix];
    state.base64 = null;
    state.name = '';
    state.removed = true;

    const fileInput = document.getElementById(prefix + '-attachment');
    if (fileInput) fileInput.value = '';

    const card = document.getElementById(prefix + '-attachment-preview-card');
    if (card) card.style.display = 'none';
}
window.clearModalAttachment = clearModalAttachment;

/**
 * Returns current attachment for a modal prefix, or null if none.
 * @returns {{ base64: string, name: string } | null}
 */
function getModalAttachment(prefix) {
    const state = _modalAttachState[prefix];
    if (state && state.base64 && state.name) {
        return { base64: state.base64, name: state.name };
    }
    return null;
}
window.getModalAttachment = getModalAttachment;

/**
 * Resets modal attachment state (called by close/clear handlers).
 */
function resetModalAttachment(prefix) {
    const state = _modalAttachState[prefix];
    if (state) {
        state.base64 = null;
        state.name = '';
        state.removed = false;
    }
    const fileInput = document.getElementById(prefix + '-attachment');
    if (fileInput) fileInput.value = '';
    const card = document.getElementById(prefix + '-attachment-preview-card');
    if (card) card.style.display = 'none';
}
window.resetModalAttachment = resetModalAttachment;

/**
 * Preview attachment from Stock In, Stock Out, or Adjustments modals.
 */
function previewGenericModalAttachment(prefix) {
    const state = _modalAttachState[prefix];
    if (!state || !state.base64) return;
    const isImg = state.base64.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(state.name);
    if (isImg && typeof window.openLightbox === 'function') {
        window.openLightbox(state.base64);
    } else if (typeof window.openAttachmentOutside === 'function') {
        window.openAttachmentOutside(state.base64, state.name);
    }
}
window.previewGenericModalAttachment = previewGenericModalAttachment;

/**
 * Removes attachment from a table row cell and syncs to Supabase.
 */
async function deleteRowAttachment(btn) {
    if (!confirm('Are you sure you want to remove this attachment?')) return;
    const td = btn?.closest('td');
    const tr = btn?.closest('tr');
    if (td) {
        td.innerHTML = '<span class="cell-muted"></span>';
        saveAllMovementTables();
    }
    if (tr && tr.dataset && tr.dataset.id && typeof sbUpdate === 'function') {
        const rowId = tr.dataset.id;
        const parentTbody = tr.closest('tbody');
        const tableByTbodyId = {
            'adj-tbody': ADJUSTMENTS_TABLE,
            'stock-in-tbody': STOCK_IN_TABLE,
            'stock-out-tbody': STOCK_OUT_TABLE,
            'stock-tbody': PRODUCT_STOCK_TABLE
        };
        const table = parentTbody ? tableByTbodyId[parentTbody.id] : null;
        if (table) {
            try {
                await sbUpdate(table, { 'id': `eq.${rowId}` }, { attachment_id: null });
            } catch (err) {
                console.warn('Failed to clear attachment in DB:', err);
            }
        }
    }
}
window.deleteRowAttachment = deleteRowAttachment;

/**
 * Renders the inline preview card (image thumb or file icon + View & Remove buttons) inside a modal.
 */
function _renderModalAttachPreview(prefix, base64, name, sizeBytes) {
    const card = document.getElementById(prefix + '-attachment-preview-card');
    const img = document.getElementById(prefix + '-preview-img');
    const icon = document.getElementById(prefix + '-preview-icon');
    const nameEl = document.getElementById(prefix + '-preview-filename');
    const sizeEl = document.getElementById(prefix + '-preview-filesize');

    if (!card) return;

    if (!base64) {
        card.style.display = 'none';
        return;
    }

    const isImage = base64.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name);

    if (isImage) {
        if (img) { img.src = base64; img.style.display = 'block'; }
        if (icon) icon.style.display = 'none';
    } else {
        if (img) img.style.display = 'none';
        if (icon) icon.style.display = 'flex';
    }

    if (nameEl) nameEl.textContent = name || 'Attachment';
    if (sizeEl) sizeEl.textContent = sizeBytes ? `${(sizeBytes / 1024).toFixed(1)} KB` : 'Attached';

    card.style.display = 'flex';
}

/**
 * Builds the attachment cell HTML for a table row (exact thumbnail + round red trash button).
 */
function _buildAttachmentCellHtml(base64, name) {
    if (!base64 || !name) return '<span class="cell-muted"></span>';

    const isImage = base64.startsWith('data:image/') || /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(name);

    if (isImage) {
        return `
            <div class="attachment-list">
                <div class="attachment-card">
                    <img src="${escapeHtml(base64)}" 
                         class="attachment-thumb" 
                         alt="${escapeHtml(name)}" 
                         title="Click to view full preview: ${escapeHtml(name)}"
                         onclick="openLightbox(this.src)">
                    <button type="button" 
                            class="attachment-delete-btn" 
                            title="Remove attachment"
                            onclick="deleteRowAttachment(this)">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
    } else {
        return `
            <div class="attachment-list">
                <div class="attachment-card">
                    <div class="attachment-thumb" 
                         style="display:flex; align-items:center; justify-content:center; background:#eff6ff; color:#2563eb; font-size:1.3rem; cursor:pointer;"
                         title="Click to open ${escapeHtml(name)}"
                         data-url="${escapeHtml(base64)}"
                         data-name="${escapeHtml(name)}"
                         onclick="openAttachmentOutside(this.dataset.url, this.dataset.name)">
                        <i class="ph ph-file-text"></i>
                    </div>
                    <button type="button" 
                            class="attachment-delete-btn" 
                            title="Remove attachment"
                            onclick="deleteRowAttachment(this)">
                        <i class="ph ph-trash"></i>
                    </button>
                </div>
            </div>
        `;
    }
}
window._buildAttachmentCellHtml = _buildAttachmentCellHtml;


// ======== 14. SUPABASE DB INTEGRATION ========
// Table names matching the schema exactly.

const PRODUCT_STOCK_TABLE = 'product_stock';
const STOCK_IN_TABLE = 'stock_in';
const STOCK_OUT_TABLE = 'stock_out';
const ADJUSTMENTS_TABLE = 'adjustments';
const AUDIT_TRAIL_TABLE = 'audit_trail';
window.PRODUCT_STOCK_TABLE = window.PRODUCT_STOCK_TABLE || PRODUCT_STOCK_TABLE;
window.PRODUCTS_TABLE = window.PRODUCTS_TABLE || 'products';
window.STOCK_IN_TABLE = window.STOCK_IN_TABLE || STOCK_IN_TABLE;
window.STOCK_OUT_TABLE = window.STOCK_OUT_TABLE || STOCK_OUT_TABLE;
window.ADJUSTMENTS_TABLE = window.ADJUSTMENTS_TABLE || ADJUSTMENTS_TABLE;
window.AUDIT_TRAIL_TABLE = AUDIT_TRAIL_TABLE;

/**
 * Orchestrates all Supabase DB loads in parallel and then refreshes stats.
 */
let _isFetchingAllData = false;
async function loadAllDataFromDB() {
    if (_isFetchingAllData) return;
    _isFetchingAllData = true;
    try {
        await Promise.allSettled([
            loadProductStockFromDB(),
            loadStockInFromDB(),
            loadStockOutFromDB(),
            loadAdjustmentsFromDB(),
            loadAuditFromDB()
        ]);
        updateDashboardStats();
        const repPage = document.getElementById('page-reports');
        if (repPage && repPage.classList.contains('active')) {
            if (typeof window.switchReportTab === 'function') {
                window.switchReportTab(_currentReportTab || 'current-stock');
            }
        }
    } finally {
        _isFetchingAllData = false;
    }
}
window.loadAllDataFromDB = loadAllDataFromDB;

/**
 * Loads product_stock rows  renders #stock-tbody (Product Stock page).
 * Columns: stock_id, product_name, category, qty_in, qty_out, balance,
 *          status, attachment_id, followup_date, followup_notes, created_at, updated_at, product_id
 */
async function loadProductStockFromDB() {
    if (typeof sbSelectAll !== 'function') return;
    const tbody = document.getElementById('stock-tbody');
    if (!tbody) return;

    const { data, error } = await sbSelectAll(PRODUCT_STOCK_TABLE);
    if (error) { console.warn('loadProductStockFromDB error:', error); return; }

    // Deduplicate by stock_id to handle any DB duplicates
    const uniqueData = [];
    const seenIds = new Set();
    if (data) {
        data.forEach(row => {
            const sid = (row.stock_id || '').toString().trim().toLowerCase();
            if (sid) {
                if (!seenIds.has(sid)) {
                    seenIds.add(sid);
                    uniqueData.push(row);
                }
            } else {
                // If no stock_id, fallback to deduplicating by id
                const rid = (row.id || '').toString();
                if (rid && !seenIds.has(rid)) {
                    seenIds.add(rid);
                    uniqueData.push(row);
                } else if (!rid) {
                    uniqueData.push(row);
                }
            }
        });
    }

    tbody.innerHTML = '';
    const emptyEl = document.getElementById('stock-empty');

    if (uniqueData.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        saveTableToStorage('stock-tbody', 'inventory_stock_table_v2');
        return;
    }

    // Build price/cost map from stock_in for Cost = balance * cost
    const priceMap = {};
    try {
        const { data: siData } = await sbSelectAll(STOCK_IN_TABLE);
        siData?.forEach(si => {
            const sid = String(si.stock_id || '').toLowerCase();
            if (sid) priceMap[sid] = parseFloat(si.cost) || priceMap[sid] || 0;
        });
    } catch (e) { }

    if (emptyEl) emptyEl.classList.add('hidden');
    uniqueData.forEach(row => {
        const balance = Math.max(0, toInteger(
            row.balance !== undefined && row.balance !== null
                ? row.balance
                : toInteger(row.qty_in) - toInteger(row.qty_out)
        ));
        const updatedAt = row.updated_at
            ? new Date(row.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
            : (row.created_at ? new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

        // Parse attachment stored as URL or JSON string
        let attachHtml = '<span class="cell-muted"></span>';
        const attVal = row.attachment_url || row.attachment_id;
        if (attVal) {
            try {
                const att = typeof attVal === 'string' && attVal.startsWith('{') ? JSON.parse(attVal) : attVal;
                attachHtml = _buildAttachmentCellHtml(att.data || att.url || att, att.name || 'Attachment');
            } catch (e) {
                attachHtml = _buildAttachmentCellHtml(attVal, 'Attachment');
            }
        }

        const tr = document.createElement('tr');
        tr.dataset.id = row.stock_id || row.id;
        tr.dataset.dbId = row.id || '';
        tr.dataset.stockId = row.stock_id || '';
        const matchedProd = Array.isArray(window._allMasterProducts)
            ? window._allMasterProducts.find(p =>
                (row.product_id && (String(p.product_id) === String(row.product_id) || String(p.id) === String(row.product_id))) ||
                (row.stock_id && String(p.client_tag_number || '').trim().toLowerCase() === String(row.stock_id || '').trim().toLowerCase())
            )
            : null;
        const resolvedProductId = row.product_id || matchedProd?.product_id || matchedProd?.id || '';
        if (resolvedProductId) tr.dataset.productId = resolvedProductId;
        if (matchedProd) tr._productData = matchedProd;
        tr._stockData = row;
        tr.dataset.updatedAt = row.updated_at || '';
        tr.dataset.createdAt = row.created_at || '';
        tr.dataset.followupDate = row.followup_date || '';

        let rawStatus = String(row.status ?? matchedProd?.status ?? '').trim();
        const status = resolveEffectiveStatus(balance, rawStatus);
        const unitPrice = priceMap[String(row.stock_id || '').toLowerCase()] || 0;
        const stockValue = unitPrice * balance;
        const priceDisplay = unitPrice ? `BND ${stockValue.toLocaleString()}` : '—';

        tr.innerHTML = `
            <td class="cell-muted">${escapeHtml(row.stock_id || '')}</td>
            <td class="cell-bold">${escapeHtml(row.product_name || '')}</td>
            <td class="cell-muted">${escapeHtml(row.category || '')}</td>
            <td class="cell-qty-in">${row.qty_in ?? 0}</td>
            <td class="cell-qty-out">${row.qty_out ?? 0}</td>
            <td>${balance}</td>
            <td class="cell-muted">${priceDisplay}</td>
            <td>${getProductStatusBadge(status)}</td>
            <td>${attachHtml}</td>
            <td class="cell-muted">${escapeHtml(updatedAt)}</td>
            <td><button class="dots-btn" title="More" onclick="openStockMenu(this)"><i class="ph ph-dots-three"></i></button></td>
        `;
        tbody.appendChild(tr);
    });

    saveTableToStorage('stock-tbody', 'inventory_stock_table_v2');
    // Stats are updated by the caller (loadAllDataFromDB) after all parallel loads finish.
    // Also refresh the status distribution chart on the Reports page if it's visible.
    if (typeof renderStatusDistributionChart === 'function') renderStatusDistributionChart();
}
window.loadProductStockFromDB = loadProductStockFromDB;

/**
 * Stock In page is a filtered view of product_stock (rows where qty_in > 0).
 * Renders into #stock-in-tbody.
 */
async function loadStockInFromDB() {
    if (typeof sbSelectAll !== 'function') return;
    const tbody = document.getElementById('stock-in-tbody');
    if (!tbody) return;

    // Stock In is stored in stock_in table (not product_stock filtered view)
    let { data, error } = await sbSelectAll(STOCK_IN_TABLE);
    if (error) { console.warn('loadStockInFromDB error:', error); return; }
    console.log('loadStockInFromDB count:', data ? data.length : 0, data);

    tbody.innerHTML = '';
    const emptyEl = document.getElementById('stock-in-empty');

    if (!data || data.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        saveTableToStorage('stock-in-tbody', 'inventory_stock_in_table_v2');
        return;
    }

    // Build live status and balance map from product_stock
    const stockMap = {};
    try {
        const { data: psData } = await sbSelectAll(PRODUCT_STOCK_TABLE);
        psData?.forEach(ps => {
            const sid = String(ps.stock_id || '').trim().toLowerCase();
            if (sid) {
                const bal = ps.balance != null ? ps.balance : Math.max(0, (parseInt(ps.qty_in) || 0) - (parseInt(ps.qty_out) || 0));
                stockMap[sid] = {
                    balance: bal,
                    status: computeStockStatus(bal, ps.status || '')
                };
            }
        });
    } catch (e) { }

    if (window._stockBalanceMap) {
        Object.keys(window._stockBalanceMap).forEach(k => {
            const sid = k.trim().toLowerCase();
            if (sid && (!stockMap[sid] || stockMap[sid].balance == null)) {
                const bal = window._stockBalanceMap[k];
                stockMap[sid] = {
                    balance: bal,
                    status: computeStockStatus(bal, '')
                };
            }
        });
    }

    const masterMap = {};
    if (Array.isArray(window._allMasterProducts)) {
        window._allMasterProducts.forEach(p => {
            const tag = String(p.client_tag_number || '').trim().toLowerCase();
            if (tag) masterMap[tag] = p;
        });
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    // Stock In is a transaction log - deduplicate only by primary key id, allow same stock_id multiple times
    const seenIds = new Set();
    const unique = data.filter(r => {
        if (!r.id) return true;
        if (seenIds.has(r.id)) return false;
        seenIds.add(r.id);
        return true;
    });
    unique.forEach(row => {
        const sid = String(row.stock_id || '').trim().toLowerCase();
        const stockInfo = stockMap[sid];
        const masterInfo = masterMap[sid];
        const balance = (stockInfo != null && stockInfo.balance != null)
            ? stockInfo.balance
            : (row.balance != null && row.balance !== 0 ? row.balance : (row.qty_in ?? 0));
        let rawStatus = stockInfo?.status || masterInfo?.status || row.status || '';
        const status = resolveEffectiveStatus(balance, rawStatus);

        let attachHtml = '<span class="cell-muted"></span>';
        const attVal = row.attachment_url || row.attachment_id;
        if (attVal) {
            try {
                const att = typeof attVal === 'string' && attVal.startsWith('{') ? JSON.parse(attVal) : attVal;
                attachHtml = _buildAttachmentCellHtml(att.data || att.url || att, att.name || 'Attachment');
            } catch (e) {
                attachHtml = _buildAttachmentCellHtml(attVal, 'Attachment');
            }
        }

        const tr = document.createElement('tr');
        tr.dataset.id = row.id;
        tr.dataset.stockId = row.stock_id || '';
        tr.dataset.followupDate = row.followup_date || '';
        tr.dataset.followupNotes = row.followup_notes || '';
        tr.dataset.createdAt = row.created_at || '';
        const costDisplay = row.cost != null && row.cost !== '' ? `BND ${parseFloat(row.cost).toLocaleString()}` : '';
        tr.innerHTML = `
            <td class="cell-muted">${escapeHtml(row.stock_id || '')}</td>
            <td class="cell-bold">${escapeHtml(row.product_name || '')}</td>
            <td class="cell-muted">${escapeHtml(row.category || '')}</td>
            <td class="cell-qty-in">${row.qty_in ?? 0}</td>
            <td>${row.qty_out ?? 0}</td>
            <td>${balance}</td>
            <td class="cell-muted">${costDisplay}</td>
            <td>${getProductStatusBadge(status)}</td>
            <td>${attachHtml}</td>
            <td><button class="dots-btn" title="More" onclick="openStockInMenu(this)"><i class="ph ph-dots-three"></i></button></td>
        `;
        tbody.appendChild(tr);
    });

    saveTableToStorage('stock-in-tbody', 'inventory_stock_in_table_v2');
}
window.loadStockInFromDB = loadStockInFromDB;

// Recompute product_stock master from stock_in/stock_out aggregates linked by stock_id (and product_id)
async function recalcProductStockByStockId(stockId, preferredStatus = '', options = {}) {
    if (!stockId || typeof sbSelectAll !== 'function') return;
    try {
        const { data: ins } = await sbSelectAll(STOCK_IN_TABLE, { 'stock_id': `eq.${stockId}` });
        const { data: outs } = await sbSelectAll(STOCK_OUT_TABLE, { 'stock_id': `eq.${stockId}` });
        const sumIn = (ins || []).reduce((s, r) => s + (parseInt(r.qty_in) || 0), 0);
        const sumOut = (outs || []).reduce((s, r) => s + (parseInt(r.qty_out) || 0), 0);
        let finalBal = Math.max(0, sumIn - sumOut);
        let finalQtyIn = sumIn;

        // Only trust a logged Adjustment if it's still the MOST RECENT event for this
        // stock_id. sbSelectAll always orders by created_at DESC, so [0] is the latest row
        // in each result set. Previously this applied the adjustment's new_qty as a
        // permanent override whenever ANY adjustment existed, which froze the balance/status
        // forever and silently ignored every Stock In/Out logged afterward. Now the
        // adjustment only wins when nothing has moved since it was made.
        try {
            const { data: adjRows } = await sbSelectAll(ADJUSTMENTS_TABLE, { 'stock_id': `eq.${stockId}` });
            const latestAdj = adjRows && adjRows[0];
            if (latestAdj && latestAdj.new_qty != null) {
                const adjTime = latestAdj.created_at ? new Date(latestAdj.created_at).getTime() : 0;
                const latestInTime = ins && ins[0]?.created_at ? new Date(ins[0].created_at).getTime() : 0;
                const latestOutTime = outs && outs[0]?.created_at ? new Date(outs[0].created_at).getTime() : 0;
                const latestMovementTime = Math.max(latestInTime, latestOutTime);

                if (adjTime >= latestMovementTime) {
                    finalBal = parseInt(latestAdj.new_qty) || 0;
                    finalQtyIn = finalBal + sumOut;
                }
                // else: Stock In/Out happened after this adjustment — the ledger sums
                // above (sumIn/sumOut) already supersede it.
            }
        } catch (e) { }

        // Fetch existing status from product_stock to preserve manual statuses.
        // If the caller explicitly passed a newly-saved status, honor that value instead
        // of re-deriving it from the current balance, which would overwrite the user choice.
        const { data: ps } = _requireDbSuccess(
            await sbSelect(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }),
            'Failed to read Product Stock during recalculation'
        );
        const currentProductStock = Array.isArray(ps) ? ps[0] : ps || null;
        const existingStatus = normalizeStatus(currentProductStock?.status || '');
        const explicitStatus = normalizeStatus(preferredStatus || existingStatus || '');
        const status = explicitStatus || computeStockStatus(finalBal, existingStatus);

        // upsert product_stock
        if (currentProductStock && currentProductStock.id) {
            _requireDbSuccess(
                await sbUpdate(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }, { qty_in: finalQtyIn, qty_out: sumOut, status }),
                'Failed to update Product Stock during recalculation'
            );
        } else if (Array.isArray(ps) && ps.length > 0) {
            _requireDbSuccess(
                await sbUpdate(PRODUCT_STOCK_TABLE, { 'stock_id': `eq.${stockId}` }, { qty_in: finalQtyIn, qty_out: sumOut, status }),
                'Failed to update Product Stock during recalculation'
            );
        } else if (finalQtyIn > 0 || sumOut > 0) {
            // create if not exists and has movements
            _requireDbSuccess(
                await sbInsert(PRODUCT_STOCK_TABLE, { stock_id: stockId, product_name: (ins?.[0]?.product_name || outs?.[0]?.product_name || stockId), category: (ins?.[0]?.category || outs?.[0]?.category || ''), qty_in: finalQtyIn, qty_out: sumOut, status }),
                'Failed to create Product Stock during recalculation'
            );
        }
        // sync status to stock_in and stock_out tables
        _requireDbSuccess(
            await sbUpdate(STOCK_IN_TABLE, { 'stock_id': `eq.${stockId}` }, { status }),
            'Failed to update Stock In status during recalculation'
        );
        _requireDbSuccess(
            await sbUpdate(STOCK_OUT_TABLE, { 'stock_id': `eq.${stockId}` }, { status }),
            'Failed to update Stock Out status during recalculation'
        );
        // sync to products table as well so status is consistent on Products page
        _requireDbSuccess(
            await sbUpdate(window.PRODUCTS_TABLE, { 'client_tag_number': `eq.${stockId}` }, { status }),
            'Failed to update Products status during recalculation'
        );
        // update cached master products
        if (Array.isArray(window._allMasterProducts)) {
            const found = window._allMasterProducts.find(p => String(p.client_tag_number || '').trim().toLowerCase() === stockId.toLowerCase());
            if (found) found.status = status;
        }
        // update live row on Products table if present
        const prodRow = Array.from(document.querySelectorAll('#products-tbody tr')).find(r => (r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase()));
        if (prodRow && prodRow.cells[7]) {
            prodRow.cells[7].innerHTML = getProductStatusBadge(status);
        }
        // update live row on Product Stock table if present
        const stockRow = Array.from(document.querySelectorAll('#stock-tbody tr')).find(r => (r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase()));
        if (stockRow) {
            if (stockRow.cells[3]) stockRow.cells[3].textContent = sumIn;
            if (stockRow.cells[4]) stockRow.cells[4].textContent = sumOut;
            if (stockRow.cells[5]) stockRow.cells[5].textContent = finalBal;
            if (stockRow.cells[7]) stockRow.cells[7].innerHTML = getProductStatusBadge(status);
        }
        // update live rows on Stock In table if present
        document.querySelectorAll('#stock-in-tbody tr').forEach(r => {
            if (r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase()) {
                if (r.cells[4]) r.cells[4].textContent = finalBal;
                if (r.cells[6]) r.cells[6].innerHTML = getProductStatusBadge(status);
            }
        });
        // update live rows on Stock Out table if present
        document.querySelectorAll('#stock-out-tbody tr').forEach(r => {
            if (r.cells[0]?.textContent.trim().toLowerCase() === stockId.toLowerCase()) {
                if (r.cells[4]) r.cells[4].textContent = finalBal;
                if (r.cells[5]) r.cells[5].innerHTML = getProductStatusBadge(status);
            }
        });
        // keep window balance map in sync
        if (window._stockBalanceMap) window._stockBalanceMap[stockId.toLowerCase()] = finalBal;
        // refresh status distribution chart
        if (typeof renderStatusDistributionChart === 'function') renderStatusDistributionChart();
    } catch (e) {
        console.warn('recalcProductStock error:', e);
        if (options.throwOnError) throw e;
    }
}
window.recalcProductStockByStockId = recalcProductStockByStockId;


/**
 * Loads stock_out rows  renders #stock-out-tbody.
 * Columns: id, stock_id, stock_name, category, qty_out, balance,
 *          followup_date, followup_notes, created_at, product_id
 */
async function loadStockOutFromDB() {
    if (typeof sbSelectAll !== 'function') return;
    const tbody = document.getElementById('stock-out-tbody');
    if (!tbody) return;

    const { data, error } = await sbSelectAll(STOCK_OUT_TABLE);
    if (error) { console.warn('loadStockOutFromDB error:', error); return; }

    tbody.innerHTML = '';
    const emptyEl = document.getElementById('stock-out-empty');

    if (!data || data.length === 0) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        saveTableToStorage('stock-out-tbody', 'inventory_stock_out_table_v2');
        return;
    }

    // Build balance and status map from product_stock
    const stockMap = {};
    try {
        const { data: psData } = await sbSelectAll(PRODUCT_STOCK_TABLE);
        psData?.forEach(ps => {
            const sid = String(ps.stock_id || '').trim().toLowerCase();
            if (sid) {
                const bal = ps.balance != null ? ps.balance : Math.max(0, (parseInt(ps.qty_in) || 0) - (parseInt(ps.qty_out) || 0));
                stockMap[sid] = {
                    balance: bal,
                    status: computeStockStatus(bal, ps.status || '')
                };
            }
        });
    } catch (e) { }

    if (window._stockBalanceMap) {
        Object.keys(window._stockBalanceMap).forEach(k => {
            const sid = k.trim().toLowerCase();
            if (sid && (!stockMap[sid] || stockMap[sid].balance == null)) {
                const bal = window._stockBalanceMap[k];
                stockMap[sid] = {
                    balance: bal,
                    status: computeStockStatus(bal, '')
                };
            }
        });
    }

    const masterMap = {};
    if (Array.isArray(window._allMasterProducts)) {
        window._allMasterProducts.forEach(p => {
            const tag = String(p.client_tag_number || '').trim().toLowerCase();
            if (tag) masterMap[tag] = p;
        });
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    // Deduplicate stock_out rows by stock_id so each product ID appears only once on the Stock Out page
    const seenStockIds = new Set();
    const uniqueData = data.filter(r => {
        const sid = String(r.stock_id || '').trim().toLowerCase();
        const dedupeKey = sid || r.id;
        if (dedupeKey && seenStockIds.has(dedupeKey)) return false;
        if (dedupeKey) seenStockIds.add(dedupeKey);
        return true;
    });
    uniqueData.forEach(row => {
        const sid = String(row.stock_id || '').trim().toLowerCase();
        const stockInfo = stockMap[sid];
        const masterInfo = masterMap[sid];
        const balance = (stockInfo != null && stockInfo.balance != null)
            ? stockInfo.balance
            : (row.balance != null ? row.balance : 0);
        let rawStatus = stockInfo?.status || masterInfo?.status || row.status || '';
        const status = resolveEffectiveStatus(balance, rawStatus);
        const createdAt = row.created_at
            ? new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
            : '';
        const displayName = row.product_name || row.stock_name || '';

        let attachHtml = '<span class="cell-muted"></span>';
        const attVal = row.attachment_url || row.attachment_id;
        if (attVal) {
            try {
                const att = typeof attVal === 'string' && attVal.startsWith('{') ? JSON.parse(attVal) : attVal;
                attachHtml = _buildAttachmentCellHtml(att.data || att.url || att, att.name || 'Attachment');
            } catch (e) {
                attachHtml = _buildAttachmentCellHtml(attVal, 'Attachment');
            }
        }

        const tr = document.createElement('tr');
        tr.dataset.id = row.id;
        tr.dataset.createdAt = row.created_at || '';
        tr.innerHTML = `
            <td class="cell-muted">${escapeHtml(row.stock_id || '')}</td>
            <td class="cell-bold">${escapeHtml(displayName)}</td>
            <td class="cell-muted">${escapeHtml(row.category || '')}</td>
            <td class="cell-qty-out">${row.qty_out ?? 0}</td>
            <td>${balance}</td>
            <td>${getProductStatusBadge(status)}</td>
            <td class="cell-muted">${escapeHtml(createdAt)}</td>
            <td>${attachHtml}</td>
            <td><button class="dots-btn" title="More" onclick="openStockOutMenu(this)"><i class="ph ph-dots-three"></i></button></td>
        `;
        tbody.appendChild(tr);
    });

    saveTableToStorage('stock-out-tbody', 'inventory_stock_out_table_v2');
}
window.loadStockOutFromDB = loadStockOutFromDB;

/**
 * Loads adjustments rows  renders #adj-tbody.
 * Columns: id, stock_id, product_name, category, new_qty, reason,
 *          followup_date, followup_notes, created_at, product_id
 */
let _isLoadingAdjustments = false;
async function loadAdjustmentsFromDB() {
    if (_isLoadingAdjustments) return;
    _isLoadingAdjustments = true;
    try {
        if (typeof sbSelectAll !== 'function') return;
        const tbody = document.getElementById('adj-tbody');
        if (!tbody) return;

        const { data, error } = await sbSelectAll(ADJUSTMENTS_TABLE);
        if (error) { console.warn('loadAdjustmentsFromDB error:', error); return; }

        tbody.innerHTML = '';
        const emptyEl = document.getElementById('adj-empty');

        if (!data || data.length === 0) {
            if (emptyEl) emptyEl.classList.remove('hidden');
            saveTableToStorage('adj-tbody', 'inventory_adj_table_v2');
            return;
        }

        // Build stock map from product_stock to resolve parent stock and old qty
        const stockMap = {};
        try {
            const { data: psData } = await sbSelectAll(PRODUCT_STOCK_TABLE);
            psData?.forEach(ps => {
                const sid = String(ps.stock_id || '').toLowerCase();
                if (sid) stockMap[sid] = ps;
            });
        } catch (e) { }

        if (emptyEl) emptyEl.classList.add('hidden');

        // Deduplicate adjustments rows by stock_id so each product appears only once (latest adjustment)
        const seenStockIds = new Set();
        const unique = [];
        const duplicateIdsToDelete = [];
        data.forEach(r => {
            const sid = String(r.stock_id || '').trim().toLowerCase();
            const dedupeKey = sid || r.id;
            if (dedupeKey && seenStockIds.has(dedupeKey)) {
                if (r.id) duplicateIdsToDelete.push(r.id);
                return;
            }
            if (dedupeKey) seenStockIds.add(dedupeKey);
            unique.push(r);
        });

        // Clean up redundant duplicate adjustment records in DB asynchronously
        if (duplicateIdsToDelete.length > 0 && typeof sbDelete === 'function') {
            duplicateIdsToDelete.forEach(dupId => {
                try { sbDelete(ADJUSTMENTS_TABLE, { 'id': `eq.${dupId}` }); } catch (e) { }
            });
        }

        unique.forEach(row => {
            const createdAt = row.created_at
                ? new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
                : '';
            const newQty = row.new_qty ?? 0;
            const sid = String(row.stock_id || '').toLowerCase();
            const parentStock = stockMap[sid];
            const oldQty = (row.old_qty != null && row.old_qty !== '')
                ? (parseInt(row.old_qty) || 0)
                : (parentStock ? (parseInt(parentStock.qty_in) || 0) : 0);
            const diff = newQty - oldQty;
            const diffStr = (diff >= 0 ? '+' : '') + diff;
            const diffColor = diff < 0 ? '#ef4444' : '#10b981';

            const tr = document.createElement('tr');
            tr.dataset.id = row.id;
            tr.dataset.followupDate = row.followup_date || '';
            tr.dataset.followupNotes = row.followup_notes || '';
            let adjAttachHtml = '<span class="cell-muted"></span>';
            const adjAttVal = row.attachment_id || row.attachment_url;
            if (adjAttVal) {
                try {
                    const att = typeof adjAttVal === 'string' && adjAttVal.startsWith('{') ? JSON.parse(adjAttVal) : adjAttVal;
                    adjAttachHtml = _buildAttachmentCellHtml(att.data || att.url || att, att.name || 'Attachment');
                } catch (e) { adjAttachHtml = _buildAttachmentCellHtml(adjAttVal, 'Attachment'); }
            }
            tr.innerHTML = `
                <td class="cell-muted">${escapeHtml(row.stock_id || '')}</td>
                <td class="cell-bold">${escapeHtml(row.product_name || '')}</td>
                <td class="cell-muted">${escapeHtml(row.category || '')}</td>
                <td>${oldQty}</td>
                <td>${newQty}</td>
                <td><span style="font-weight:600;color:${diffColor}">${diffStr}</span></td>
                <td class="cell-muted">${escapeHtml(row.reason || 'Correction')}</td>
                <td class="cell-muted">${escapeHtml(createdAt)}</td>
                <td>${adjAttachHtml}</td>
                <td><button class="dots-btn" title="More" onclick="openAdjMenu(this)"><i class="ph ph-dots-three"></i></button></td>
            `;
            tbody.appendChild(tr);
        });

        saveTableToStorage('adj-tbody', 'inventory_adj_table_v2');
    } finally {
        _isLoadingAdjustments = false;
    }
}
window.loadAdjustmentsFromDB = loadAdjustmentsFromDB;

/**
 * Loads audit_trail rows  merges with localStorage audit log and re-renders.
 * Columns: id, action_type, action_description, created_at
 */
async function loadAuditFromDB() {
    if (typeof sbSelectAll !== 'function') return;

    const { data, error } = await sbSelectAll(AUDIT_TRAIL_TABLE);
    if (error) { console.warn('loadAuditFromDB error:', error); return; }
    if (!data || data.length === 0) return;

    // Convert DB rows to the same shape as local audit log entries
    const dbLogs = data.map(row => ({
        id: row.id,
        timestamp: row.created_at
            ? new Date(row.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
            : '',
        action: row.action_type || 'Added',
        module: (row.action_description || '').replace(/^\[([^\]]+)\].*/, '$1') || 'System',
        details: (row.action_description || '').replace(/^\[[^\]]+\]\s*/, ''),
        user: 'Admin',
        recordId: '',
        recordName: ''
    }));

    // Merge DB logs with any local-only logs, avoiding duplicates by id
    const localIds = new Set(_auditLogs.map(l => String(l.id)));
    dbLogs.forEach(log => {
        if (!localIds.has(String(log.id))) {
            _auditLogs.push(log);
        }
    });

    // Sort descending by timestamp
    _auditLogs.sort((a, b) => {
        const dateA = new Date(a.timestamp).getTime();
        const dateB = new Date(b.timestamp).getTime();
        return (Number.isFinite(dateB) ? dateB : 0) - (Number.isFinite(dateA) ? dateA : 0);
    });
    renderAuditLogsTable(_auditLogs);
}
window.loadAuditFromDB = loadAuditFromDB;
