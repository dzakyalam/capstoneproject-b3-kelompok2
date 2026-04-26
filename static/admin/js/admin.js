// ============================================
// FraudGuard Admin - admin.js (FINAL)
// ============================================

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getStatusBadge(status) {
    const s = String(status || 'Pending').trim();

    if (s === 'Fraud') {
        return '<span class="bg-red-50 text-red-600 px-3 py-1 rounded-full text-xs font-bold">Fraud</span>';
    }
    if (s === 'Diproses') {
        return '<span class="bg-orange-50 text-orange-600 px-3 py-1 rounded-full text-xs font-bold">Diproses</span>';
    }
    if (s === 'Aman') {
        return '<span class="bg-emerald-50 text-emerald-600 px-3 py-1 rounded-full text-xs font-bold">Aman</span>';
    }
    return '<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-xs font-bold">Pending</span>';
}

function getRiskTextClass(score) {
    const n = Number(score || 0);
    if (n >= 70) return 'text-red-600';
    if (n >= 40) return 'text-orange-500';
    return 'text-emerald-600';
}

function getRiskBarClass(score) {
    const n = Number(score || 0);
    if (n >= 70) return 'bg-red-600';
    if (n >= 40) return 'bg-orange-500';
    return 'bg-emerald-600';
}

function showToast(message, type = 'info') {
    const existing = document.getElementById('admin-toast');
    if (existing) existing.remove();

    const colors = {
        success: 'bg-emerald-600',
        info: 'bg-slate-800',
        error: 'bg-red-600',
    };

    const toast = document.createElement('div');
    toast.id = 'admin-toast';
    toast.className =
        'fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] ' +
        (colors[type] || colors.info) +
        ' text-white px-6 py-3 rounded-xl shadow-xl text-sm font-semibold transition-all';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
        toast.style.opacity = '0';
        setTimeout(function () {
            toast.remove();
        }, 400);
    }, 2500);
}

// ============================================
// DASHBOARD
// ============================================

async function loadAdminSummary() {
    try {
        const res = await fetch('/admin/summary');
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal mengambil summary');
        }

        const totalEl = document.getElementById('summary-total-reports');
        const pendingEl = document.getElementById('summary-pending-reports');
        const highRiskEl = document.getElementById('summary-high-risk-reports');
        const amanEl = document.getElementById('summary-aman-reports');

        if (totalEl) totalEl.textContent = data.total_reports ?? 0;
        if (pendingEl) pendingEl.textContent = data.pending_reports ?? 0;
        if (highRiskEl) highRiskEl.textContent = data.high_risk_reports ?? 0;
        if (amanEl) amanEl.textContent = data.aman_reports ?? 0;
    } catch (err) {
        console.error('loadAdminSummary:', err);
    }
}

function buildTableRow(item) {
    const ticketId = escapeHtml(item.ticket_id || '-');
    const reporterEmail = escapeHtml(item.reporter_email || '-');
    const riskScore = Number(item.risk_score || 0);

    return `
        <tr class="hover:bg-slate-50/50 transition-colors">
            <td class="px-6 py-4 font-bold text-slate-700">${ticketId}</td>
            <td class="px-6 py-4 text-slate-600 text-sm">${reporterEmail}</td>
            <td class="px-6 py-4">
                <div class="flex flex-col items-center">
                    <span class="${getRiskTextClass(riskScore)} font-bold">${riskScore}%</span>
                    <div class="w-16 h-1 bg-slate-100 rounded-full mt-1">
                        <div class="${getRiskBarClass(riskScore)} h-full rounded-full" style="width:${Math.min(riskScore, 100)}%"></div>
                    </div>
                </div>
            </td>
            <td class="px-6 py-4">${getStatusBadge(item.admin_status)}</td>
            <td class="px-6 py-4 text-right">
                <button class="btn-review text-primary font-bold text-sm hover:underline" data-ticket="${ticketId}">
                    Review
                </button>
            </td>
        </tr>
    `;
}

function buildPriorityItem(item) {
    const riskScore = Number(item.risk_score || 0);
    const ticketId = escapeHtml(item.ticket_id || '-');
    const messageText = escapeHtml((item.message_text || '').slice(0, 60) || 'Tidak ada deskripsi');

    return `
        <div class="risk-item group p-3 rounded-xl border border-transparent hover:border-red-100 hover:bg-red-50/30 transition-all cursor-pointer" data-ticket="${ticketId}">
            <div class="flex justify-between items-start">
                <div>
                    <p class="text-xs font-bold text-red-600 uppercase mb-1">Score: ${riskScore}%</p>
                    <p class="font-bold text-slate-800 text-sm">${ticketId}</p>
                    <p class="text-xs text-slate-500">${messageText}</p>
                </div>
                <span class="material-symbols-outlined text-slate-300 group-hover:text-red-400 transition-colors">arrow_forward</span>
            </div>
        </div>
    `;
}

async function loadAdminReports() {
    const tbody = document.getElementById('reports-table-body');
    const tableInfo = document.getElementById('reports-table-info');
    const priorityList = document.getElementById('risk-priority-list');

    if (!tbody) return;

    try {
        const res = await fetch('/admin/reports');
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal mengambil laporan admin');
        }

        if (!Array.isArray(data) || data.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-6 text-center text-slate-400">Belum ada laporan dari user.</td>
                </tr>
            `;
            if (tableInfo) tableInfo.textContent = 'Menampilkan 0 laporan';
            if (priorityList) priorityList.innerHTML = '<div class="text-sm text-slate-400">Belum ada kasus prioritas.</div>';
            return;
        }

        const latestReports = data.slice(0, 10);
        tbody.innerHTML = latestReports.map(buildTableRow).join('');

        if (tableInfo) {
            tableInfo.textContent = `Menampilkan ${latestReports.length} dari ${data.length} laporan`;
        }

        if (priorityList) {
            const highRisk = data
                .filter(item => Number(item.risk_score || 0) >= 70 || item.risk_level === 'High Risk')
                .slice(0, 5);

            priorityList.innerHTML = highRisk.length
                ? highRisk.map(buildPriorityItem).join('')
                : '<div class="text-sm text-slate-400">Belum ada kasus risiko tinggi.</div>';
        }

        bindReviewButtons();
        bindRiskItems();
        bindSearch(data);
    } catch (err) {
        console.error('loadAdminReports:', err);
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-6 py-6 text-center text-red-500">${escapeHtml(err.message)}</td>
            </tr>
        `;
        if (priorityList) {
            priorityList.innerHTML = '<div class="text-sm text-red-500">Gagal memuat prioritas risiko.</div>';
        }
    }
}

function bindReviewButtons() {
    document.querySelectorAll('.btn-review').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const ticketId = btn.getAttribute('data-ticket') || '';
            sessionStorage.setItem('activeTicket', ticketId);
            window.location.href = `/admin/case-review.html?ticket_id=${encodeURIComponent(ticketId)}`;
        });
    });
}

function bindRiskItems() {
    document.querySelectorAll('.risk-item').forEach(function (item) {
        item.addEventListener('click', function () {
            const ticketId = item.getAttribute('data-ticket') || '';
            sessionStorage.setItem('activeTicket', ticketId);
            window.location.href = `/admin/case-review.html?ticket_id=${encodeURIComponent(ticketId)}`;
        });
    });
}

function bindSearch(allData) {
    const searchInput = document.getElementById('admin-search');
    const tbody = document.getElementById('reports-table-body');
    const tableInfo = document.getElementById('reports-table-info');

    if (!searchInput || !tbody) return;

    searchInput.addEventListener('input', function () {
        const keyword = searchInput.value.trim().toLowerCase();

        const filtered = allData.filter(item => {
            const ticket = String(item.ticket_id || '').toLowerCase();
            const email = String(item.reporter_email || '').toLowerCase();
            const message = String(item.message_text || '').toLowerCase();
            return ticket.includes(keyword) || email.includes(keyword) || message.includes(keyword);
        });

        if (!filtered.length) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-6 py-6 text-center text-slate-400">Tidak ada data yang cocok.</td>
                </tr>
            `;
            if (tableInfo) tableInfo.textContent = 'Menampilkan 0 laporan';
            return;
        }

        const rows = filtered.slice(0, 10);
        tbody.innerHTML = rows.map(buildTableRow).join('');
        if (tableInfo) tableInfo.textContent = `Menampilkan ${rows.length} dari ${filtered.length} laporan hasil pencarian`;
        bindReviewButtons();
    });
}

// ============================================
// CASE REVIEW
// ============================================

function getCurrentTicketId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('ticket_id') || sessionStorage.getItem('activeTicket') || '';
}

async function loadCaseReviewDetail() {
    const ticketId = getCurrentTicketId();
    if (!ticketId) return;

    try {
        const res = await fetch(`/admin/report/${encodeURIComponent(ticketId)}`);
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal mengambil detail laporan');
        }

        const ticketText = data.ticket_id || '-';
        const emailText = data.reporter_email || '-';
        const createdText = data.created_at || '-';
        const statusText = data.admin_status || 'Pending';
        const riskScore = Number(data.risk_score || 0);
        const riskLevel = data.risk_level || '-';
        const messageText = data.message_text || '-';
        const urlsText = data.extracted_urls || '-';
        const phonesText = data.extracted_phones || '-';
        const noteText = data.admin_note || '';

        const breadcrumbTicket = document.getElementById('breadcrumb-ticket');
        const pageTitleTicket = document.getElementById('page-title-ticket');
        const reportIdSmall = document.getElementById('report-id-small');
        const detailEmail = document.getElementById('detail-email');
        const detailCreatedAt = document.getElementById('detail-created-at');
        const detailStatus = document.getElementById('detail-status');
        const reportedMsg = document.getElementById('reported-msg');
        const detailUrls = document.getElementById('detail-urls');
        const detailPhones = document.getElementById('detail-phones');
        const adminNote = document.getElementById('admin-note');
        const detailConfidence = document.getElementById('detail-confidence');
        const detailRiskLabel = document.getElementById('detail-risk-label');
        const detailRiskBar = document.getElementById('detail-risk-bar');
        const detailRiskLevel = document.getElementById('detail-risk-level');
        const analysisUrl = document.getElementById('analysis-url');
        const analysisPhone = document.getElementById('analysis-phone');

        if (breadcrumbTicket) breadcrumbTicket.textContent = ticketText;
        if (pageTitleTicket) pageTitleTicket.textContent = ticketText;
        if (reportIdSmall) reportIdSmall.textContent = `ID: ${ticketText}`;
        if (detailEmail) detailEmail.textContent = emailText;
        if (detailCreatedAt) detailCreatedAt.textContent = createdText;
        if (detailStatus) detailStatus.innerHTML = getStatusBadge(statusText);
        if (reportedMsg) reportedMsg.textContent = messageText;
        if (detailUrls) detailUrls.textContent = urlsText || '-';
        if (detailPhones) detailPhones.textContent = phonesText || '-';
        if (adminNote) adminNote.value = noteText;
        if (detailConfidence) detailConfidence.textContent = `${riskScore}% Confidence`;
        if (detailRiskLabel) detailRiskLabel.textContent = `${riskScore}%`;
        if (detailRiskBar) detailRiskBar.style.width = `${Math.min(riskScore, 100)}%`;
        if (detailRiskLevel) detailRiskLevel.textContent = riskLevel;
        if (analysisUrl) analysisUrl.textContent = urlsText || 'Tidak ada URL terdeteksi';
        if (analysisPhone) analysisPhone.textContent = phonesText || 'Tidak ada nomor terdeteksi';

        sessionStorage.setItem('activeTicket', ticketText);
    } catch (err) {
        console.error('loadCaseReviewDetail:', err);
        showToast(err.message, 'error');
    }
}

async function updateAdminStatus(ticketId, status, note = '') {
    try {
        const res = await fetch(`/admin/report/${encodeURIComponent(ticketId)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                admin_status: status,
                admin_note: note
            })
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Gagal memperbarui status');

        showToast('Status berhasil diperbarui.', 'success');
        setTimeout(() => {
            window.location.href = '/admin/dashboard.html';
        }, 900);
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function initPhishingDecision() {
    const btnPhishing = document.getElementById('btn-phishing');
    if (!btnPhishing) return;

    btnPhishing.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = document.getElementById('admin-note')?.value.trim() || 'Kasus ditandai sebagai phishing oleh admin.';
        if (!ticketId) return alert('Ticket tidak ditemukan.');
        if (!confirm('Tandai kasus ini sebagai FRAUD/PHISHING?')) return;
        updateAdminStatus(ticketId, 'Fraud', note);
    });
}

function initEscalation() {
    const btnEskalasi = document.getElementById('btn-eskalasi');
    if (!btnEskalasi) return;

    btnEskalasi.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = document.getElementById('admin-note')?.value.trim() || 'Kasus sedang diproses oleh admin.';
        if (!ticketId) return alert('Ticket tidak ditemukan.');
        updateAdminStatus(ticketId, 'Diproses', note);
    });
}

function initMarkSafe() {
    const btnAman = document.getElementById('btn-aman');
    if (!btnAman) return;

    btnAman.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = document.getElementById('admin-note')?.value.trim() || 'Kasus dinyatakan aman oleh admin.';
        if (!ticketId) return alert('Ticket tidak ditemukan.');
        if (!confirm('Tandai kasus ini sebagai AMAN?')) return;
        updateAdminStatus(ticketId, 'Aman', note);
    });
}

function initSaveNote() {
    const btn = document.getElementById('btn-save-note');
    const textarea = document.getElementById('admin-note');
    if (!btn || !textarea) return;

    btn.addEventListener('click', function () {
        const ticketId = getCurrentTicketId();
        const note = textarea.value.trim();

        if (!ticketId) {
            alert('Ticket tidak ditemukan.');
            return;
        }

        if (!note) {
            alert('Mohon isi catatan sebelum menyimpan.');
            return;
        }

        updateAdminStatus(ticketId, 'Diproses', note);
    });
}

// ============================================
// EXPORT
// ============================================

function initExport() {
    const btns = document.querySelectorAll('.btn-export');
    btns.forEach(function (btn) {
        btn.addEventListener('click', function () {
            window.location.href = '/admin/export/reports';
        });
    });
}

// ============================================
// ANALYTICS
// ============================================

async function loadAnalyticsSummary() {
    const trendEl = document.getElementById('trend-chart');
    if (!trendEl) return;

    try {
        const res = await fetch('/admin/analytics/summary');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Gagal memuat analytics');

        const trend = Array.isArray(data.trend) ? data.trend : [];
        const maxValue = Math.max(...trend.map(item => Number(item.total || 0)), 1);

        trendEl.innerHTML = `
            <div style="position:absolute; inset:0; display:flex; flex-direction:column; justify-content:space-between; pointer-events:none;">
                <div style="border-bottom:1px solid #f1f5f9; width:100%; height:0;"></div>
                <div style="border-bottom:1px solid #f1f5f9; width:100%; height:0;"></div>
                <div style="border-bottom:1px solid #f1f5f9; width:100%; height:0;"></div>
                <div style="border-bottom:1px solid #f1f5f9; width:100%; height:0;"></div>
                <div style="border-bottom:1px solid #f1f5f9; width:100%; height:0;"></div>
            </div>

            ${trend.map(item => {
                const value = Number(item.total || 0);
                const barHeight = value > 0 ? Math.max(18, Math.round((value / maxValue) * 220)) : 8;
                const isPeak = value === maxValue && maxValue > 0;

                return `
                    <div style="
                        flex:1;
                        height:100%;
                        display:flex;
                        flex-direction:column;
                        justify-content:flex-end;
                        align-items:center;
                        position:relative;
                    ">
                        <div
                            title="${value} laporan"
                            style="
                                width:70%;
                                height:${barHeight}px;
                                background:${isPeak ? '#b5000b' : 'rgba(181,0,11,0.20)'};
                                border-top-left-radius:8px;
                                border-top-right-radius:8px;
                                box-shadow:${isPeak ? '0 4px 12px rgba(181,0,11,0.18)' : 'none'};
                            "
                        ></div>

                        <div style="
                            margin-top:10px;
                            font-size:10px;
                            text-align:center;
                            color:${isPeak ? '#1b1c1c' : '#94a3b8'};
                            font-weight:${isPeak ? '700' : '500'};
                        ">
                            ${escapeHtml(item.label)}
                        </div>
                    </div>
                `;
            }).join('')}
        `;
    } catch (err) {
        console.error('loadAnalyticsSummary:', err);
        trendEl.innerHTML = `<div class="text-sm text-red-500">${escapeHtml(err.message)}</div>`;
    }
}

async function loadScamTypes() {
    const listEl = document.getElementById('scam-type-list');
    if (!listEl) return;

    try {
        const res = await fetch('/admin/analytics/scam-types');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Gagal memuat jenis scam');

        listEl.innerHTML = data.map(item => `
            <div class="space-y-2">
                <div class="flex justify-between text-sm font-medium">
                    <span>${escapeHtml(item.name)}</span>
                    <span class="text-primary">${item.percentage}%</span>
                </div>
                <div class="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                    <div class="bg-primary h-full" style="width:${Math.min(item.percentage, 100)}%"></div>
                </div>
            </div>
        `).join('');
    } catch (err) {
        console.error('loadScamTypes:', err);
        listEl.innerHTML = `<div class="text-sm text-red-500">${escapeHtml(err.message)}</div>`;
    }
}

function renderDomainItem(item) {
    return `
        <div class="whitelist-row flex items-center justify-between p-3 border border-slate-100 rounded-lg hover:border-primary/20 transition-all group">
            <div class="flex items-center gap-4">
                <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
                    <span class="material-symbols-outlined text-sm text-slate-400">language</span>
                </div>
                <div>
                    <p class="text-sm font-bold text-on-surface">${escapeHtml(item.domain)}</p>
                    <p class="text-xs text-slate-400">ID: ${item.id}</p>
                </div>
            </div>
            <button class="btn-delete-domain p-2 text-slate-300 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100" data-id="${item.id}">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </div>
    `;
}

function renderPhoneItem(item) {
    return `
        <div class="whitelist-row flex items-center justify-between p-3 border border-slate-100 rounded-lg hover:border-primary/20 transition-all group">
            <div class="flex items-center gap-4">
                <div class="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center border border-slate-100">
                    <span class="material-symbols-outlined text-sm text-slate-400">call</span>
                </div>
                <div>
                    <p class="text-sm font-bold text-on-surface">${escapeHtml(item.phone)}</p>
                    <p class="text-xs text-slate-400">ID: ${item.id}</p>
                </div>
            </div>
            <button class="btn-delete-phone p-2 text-slate-300 hover:text-red-600 transition-colors opacity-0 group-hover:opacity-100" data-id="${item.id}">
                <span class="material-symbols-outlined">delete</span>
            </button>
        </div>
    `;
}

async function loadDomainWhitelist() {
    const listEl = document.getElementById('domain-whitelist-list');
    if (!listEl) return;

    try {
        const res = await fetch('/admin/whitelist/domains');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Gagal memuat domain');

        listEl.innerHTML = data.length
            ? data.map(renderDomainItem).join('')
            : '<div class="text-sm text-slate-400">Belum ada domain whitelist.</div>';

        bindDeleteDomainButtons();
    } catch (err) {
        console.error('loadDomainWhitelist:', err);
        listEl.innerHTML = `<div class="text-sm text-red-500">${escapeHtml(err.message)}</div>`;
    }
}

async function loadPhoneWhitelist() {
    const listEl = document.getElementById('phone-whitelist-list');
    if (!listEl) return;

    try {
        const res = await fetch('/admin/whitelist/phones');
        const data = await res.json();
        if (!res.ok) throw new Error(data.message || 'Gagal memuat nomor');

        listEl.innerHTML = data.length
            ? data.map(renderPhoneItem).join('')
            : '<div class="text-sm text-slate-400">Belum ada nomor whitelist.</div>';

        bindDeletePhoneButtons();
    } catch (err) {
        console.error('loadPhoneWhitelist:', err);
        listEl.innerHTML = `<div class="text-sm text-red-500">${escapeHtml(err.message)}</div>`;
    }
}

function bindDeleteDomainButtons() {
    document.querySelectorAll('.btn-delete-domain').forEach(btn => {
        btn.onclick = async function () {
            const id = btn.getAttribute('data-id');
            if (!confirm('Hapus domain ini dari whitelist?')) return;

            try {
                const res = await fetch(`/admin/whitelist/domain/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Gagal menghapus domain');

                showToast('Domain berhasil dihapus', 'success');
                loadDomainWhitelist();
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
    });
}

function bindDeletePhoneButtons() {
    document.querySelectorAll('.btn-delete-phone').forEach(btn => {
        btn.onclick = async function () {
            const id = btn.getAttribute('data-id');
            if (!confirm('Hapus nomor ini dari whitelist?')) return;

            try {
                const res = await fetch(`/admin/whitelist/phone/${id}`, { method: 'DELETE' });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Gagal menghapus nomor');

                showToast('Nomor berhasil dihapus', 'success');
                loadPhoneWhitelist();
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
    });
}

function initAddWhitelistButtons() {
    const btnDomain = document.getElementById('btn-add-domain');
    const btnPhone = document.getElementById('btn-add-phone');

    if (btnDomain) {
        btnDomain.onclick = async function () {
            const value = prompt('Masukkan domain resmi baru:');
            if (!value) return;

            try {
                const res = await fetch('/admin/whitelist/domain', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ domain: value.trim() })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Gagal menambah domain');

                showToast('Domain berhasil ditambahkan', 'success');
                loadDomainWhitelist();
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
    }

    if (btnPhone) {
        btnPhone.onclick = async function () {
            const value = prompt('Masukkan nomor resmi baru:');
            if (!value) return;

            try {
                const res = await fetch('/admin/whitelist/phone', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: value.trim() })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.message || 'Gagal menambah nomor');

                showToast('Nomor berhasil ditambahkan', 'success');
                loadPhoneWhitelist();
            } catch (err) {
                showToast(err.message, 'error');
            }
        };
    }
}

function initAnalyticsSearch() {
    const searchEl = document.getElementById('analytics-search');
    if (!searchEl) return;

    searchEl.addEventListener('input', function () {
        const keyword = searchEl.value.trim().toLowerCase();

        document.querySelectorAll('#domain-whitelist-list .whitelist-row, #phone-whitelist-list .whitelist-row').forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(keyword) ? '' : 'none';
        });
    });
}

function initAnalyticsPage() {
    if (!document.getElementById('trend-chart')) return;

    loadAnalyticsSummary();
    loadScamTypes();
    loadDomainWhitelist();
    loadPhoneWhitelist();
    initAddWhitelistButtons();
    initAnalyticsSearch();

    const refreshBtn = document.getElementById('btn-refresh-analytics');
    if (refreshBtn) {
        refreshBtn.onclick = function () {
            loadAnalyticsSummary();
            loadScamTypes();
            loadDomainWhitelist();
            loadPhoneWhitelist();
            showToast('Data analytics diperbarui', 'success');
        };
    }
}

// ============================================
// EDUCATION CMS - versi awal yang sudah diperbaiki
// ============================================

let educationArticlesData = [];
let currentEducationFilter = 'all';
let educationModalMode = 'add';

function getEducationImage(imageUrl) {
    return imageUrl && imageUrl.trim()
        ? imageUrl
        : 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?q=80&w=1200&auto=format&fit=crop';
}

function formatEducationDate(dateStr) {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    if (isNaN(date)) return dateStr;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = String(date.getDate()).padStart(2, '0');
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${mins}`;
}

function getEducationStatusBadge(status) {
    if (status === 'Published') {
        return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700">Published</span>`;
    }
    return `<span class="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700">Draft</span>`;
}

function updateEducationStats(data) {
    const totalEl = document.getElementById('education-total-count');
    const publishedEl = document.getElementById('education-published-count');
    const draftEl = document.getElementById('education-draft-count');
    const viewsEl = document.getElementById('education-view-count');

    const total = data.length;
    const published = data.filter(item => item.status === 'Published').length;
    const draft = data.filter(item => item.status === 'Draft').length;

    const estimatedViews = data.reduce((sum, item) => {
        return sum + (item.status === 'Published' ? 320 : 40);
    }, 0);

    if (totalEl) totalEl.textContent = total;
    if (publishedEl) publishedEl.textContent = published;
    if (draftEl) draftEl.textContent = draft;
    if (viewsEl) viewsEl.textContent = estimatedViews >= 1000 ? `${(estimatedViews / 1000).toFixed(1)}k` : `${estimatedViews}`;
}

function updateEducationFilterTabs() {
    document.querySelectorAll('.edu-filter-tab').forEach(tab => {
        const filter = tab.dataset.filter;

        tab.classList.remove('bg-red-50', 'text-red-600', 'font-semibold');
        tab.classList.add('text-slate-500');

        if (filter === currentEducationFilter) {
            tab.classList.add('bg-red-50', 'text-red-600', 'font-semibold');
            tab.classList.remove('text-slate-500');
        }
    });
}

function getBaseFilteredArticles() {
    if (currentEducationFilter === 'published') {
        return educationArticlesData.filter(item => item.status === 'Published');
    }
    if (currentEducationFilter === 'draft') {
        return educationArticlesData.filter(item => item.status === 'Draft');
    }
    return educationArticlesData;
}

function renderEducationRows(rows, infoText) {
    const tbody = document.getElementById('education-article-list');
    const infoEl = document.getElementById('education-table-info');

    if (!tbody) return;
    if (infoEl) infoEl.textContent = infoText;

    if (!rows.length) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-8 text-center text-slate-400">
                    Tidak ada artikel pada filter ini.
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = rows.map(item => `
        <tr class="hover:bg-slate-50/60 transition-colors group">
            <td class="px-6 py-6">
                <div class="flex items-center gap-4">
                    <div class="w-16 h-12 rounded-lg bg-slate-100 overflow-hidden flex-shrink-0">
                        <img src="${escapeHtml(getEducationImage(item.image_url))}" alt="Artikel edukasi" class="w-full h-full object-cover" />
                    </div>
                    <div>
                        <h5 class="font-semibold text-on-surface group-hover:text-primary transition-colors">${escapeHtml(item.title)}</h5>
                        <p class="text-xs text-slate-400 mt-1">${escapeHtml(item.category || 'Artikel')} • ${escapeHtml(item.read_time || '5 mnt baca')}</p>
                    </div>
                </div>
            </td>
            <td class="px-6 py-6">
                ${getEducationStatusBadge(item.status)}
            </td>
            <td class="px-6 py-6 text-slate-500">${escapeHtml(formatEducationDate(item.updated_at))}</td>
            <td class="px-6 py-6 text-right">
                <div class="flex items-center justify-end gap-2">
                    <button
                        class="btn-edit-edu p-2 text-slate-400 hover:text-primary hover:bg-red-50 rounded-lg transition-all"
                        data-id="${item.id}"
                        data-title="${escapeHtml(item.title || '')}"
                        data-category="${escapeHtml(item.category || '')}"
                        data-summary="${escapeHtml(item.summary || '')}"
                        data-content="${escapeHtml(item.content || '')}"
                        data-status="${escapeHtml(item.status || 'Draft')}"
                        data-read-time="${escapeHtml(item.read_time || '5 mnt baca')}"
                        data-image-url="${escapeHtml(item.image_url || '')}"
                        title="Edit"
                    >
                        <span class="material-symbols-outlined text-xl">edit</span>
                    </button>

                    <button
                        class="btn-delete-edu p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        data-id="${item.id}"
                        title="Hapus"
                    >
                        <span class="material-symbols-outlined text-xl">delete</span>
                    </button>
                </div>
            </td>
        </tr>
    `).join('');

    bindEducationActionButtons();
}

function renderEducationArticles() {
    const rows = getBaseFilteredArticles();
    renderEducationRows(
        rows,
        rows.length ? `Menampilkan 1-${rows.length} dari ${rows.length} artikel` : 'Menampilkan 0 artikel'
    );
    updateEducationFilterTabs();
}

async function loadEducationArticles() {
    const tbody = document.getElementById('education-article-list');
    if (!tbody) return;

    try {
        const res = await fetch('/admin/education/articles');
        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal memuat artikel edukasi');
        }

        educationArticlesData = Array.isArray(data) ? data : [];
        updateEducationStats(educationArticlesData);
        renderEducationArticles();
    } catch (err) {
        console.error(err);
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="px-6 py-8 text-center text-red-500">
                    ${escapeHtml(err.message)}
                </td>
            </tr>
        `;
    }
}

function resetEducationForm() {
    document.getElementById('education-id').value = '';
    document.getElementById('education-title').value = '';
    document.getElementById('education-category').value = 'Artikel';
    document.getElementById('education-summary').value = '';
    document.getElementById('education-content').value = '';
    document.getElementById('education-read-time').value = '5 mnt baca';
    document.getElementById('education-status').value = 'Published';
    document.getElementById('education-image-url').value = '';
    updateEducationPreview();
}

function openEducationModal(mode = 'add', data = null) {
    educationModalMode = mode;

    const modal = document.getElementById('education-modal');
    const title = document.getElementById('education-modal-title');
    const badge = document.getElementById('education-modal-badge');
    const submitBtn = document.getElementById('education-submit-btn');

    if (!modal) return;

    if (mode === 'add') {
        title.textContent = 'Tambah Materi Edukasi';
        badge.textContent = 'Tambah Artikel';
        submitBtn.textContent = 'Simpan Materi';
        resetEducationForm();
    } else {
        title.textContent = 'Edit Materi Edukasi';
        badge.textContent = 'Edit Artikel';
        submitBtn.textContent = 'Perbarui Materi';

        document.getElementById('education-id').value = data.id || '';
        document.getElementById('education-title').value = data.title || '';
        document.getElementById('education-category').value = data.category || 'Artikel';
        document.getElementById('education-summary').value = data.summary || '';
        document.getElementById('education-content').value = data.content || '';
        document.getElementById('education-read-time').value = data.read_time || '5 mnt baca';
        document.getElementById('education-status').value = data.status || 'Draft';
        document.getElementById('education-image-url').value = data.image_url || '';
        updateEducationPreview();
    }

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeEducationModal() {
    const modal = document.getElementById('education-modal');
    if (!modal) return;

    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

function updatePreviewStatusBadge(elId, status) {
    const el = document.getElementById(elId);
    if (!el) return;

    el.textContent = status;

    if (status === 'Published') {
        el.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-700';
    } else {
        el.className = 'inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700';
    }
}

function updateEducationPreview() {
    const title = document.getElementById('education-title')?.value?.trim() || 'Judul Materi';
    const category = document.getElementById('education-category')?.value?.trim() || 'Artikel';
    const summary = document.getElementById('education-summary')?.value?.trim() || 'Ringkasan artikel akan tampil di sini.';
    const content = document.getElementById('education-content')?.value?.trim() || 'Isi lengkap materi akan tampil di sini...';
    const readTime = document.getElementById('education-read-time')?.value?.trim() || '5 mnt baca';
    const status = document.getElementById('education-status')?.value || 'Published';
    const imageUrl = document.getElementById('education-image-url')?.value?.trim() || '';

    const previewTitleMain = document.getElementById('preview-title-main');
    const previewTitleSmall = document.getElementById('preview-title-small');
    const previewCategoryBadge = document.getElementById('preview-category-badge');
    const previewSummaryMain = document.getElementById('preview-summary-main');
    const previewSummarySmall = document.getElementById('preview-summary-small');
    const previewContent = document.getElementById('preview-content');
    const previewReadMain = document.getElementById('preview-read-main');
    const previewImageMain = document.getElementById('preview-image-main');

    if (previewTitleMain) previewTitleMain.textContent = title;
    if (previewTitleSmall) previewTitleSmall.textContent = title;
    if (previewCategoryBadge) previewCategoryBadge.textContent = category;
    if (previewSummaryMain) previewSummaryMain.textContent = summary;
    if (previewSummarySmall) previewSummarySmall.textContent = summary;
    if (previewContent) previewContent.textContent = content;
    if (previewReadMain) previewReadMain.textContent = readTime;
    if (previewImageMain) previewImageMain.src = getEducationImage(imageUrl);

    updatePreviewStatusBadge('preview-status-main', status);
    updatePreviewStatusBadge('preview-status-small', status);
}

function initEducationModal() {
    const btnTambah = document.getElementById('btn-tambah-artikel');
    const btnClose = document.getElementById('btn-close-education-modal');
    const btnCancel = document.getElementById('btn-cancel-education-modal');
    const overlay = document.getElementById('education-modal-overlay');

    if (btnTambah) {
        btnTambah.addEventListener('click', () => openEducationModal('add'));
    }

    if (btnClose) btnClose.addEventListener('click', closeEducationModal);
    if (btnCancel) btnCancel.addEventListener('click', closeEducationModal);
    if (overlay) overlay.addEventListener('click', closeEducationModal);

    [
        'education-title',
        'education-category',
        'education-summary',
        'education-content',
        'education-read-time',
        'education-status',
        'education-image-url'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', updateEducationPreview);
            el.addEventListener('change', updateEducationPreview);
        }
    });
}

async function saveEducationArticle(event) {
    event.preventDefault();

    const id = document.getElementById('education-id').value;
    const payload = {
        title: document.getElementById('education-title').value.trim(),
        category: document.getElementById('education-category').value.trim(),
        summary: document.getElementById('education-summary').value.trim(),
        content: document.getElementById('education-content').value.trim(),
        read_time: document.getElementById('education-read-time').value.trim() || '5 mnt baca',
        status: document.getElementById('education-status').value,
        image_url: document.getElementById('education-image-url').value.trim()
    };

    if (!payload.title || !payload.category || !payload.summary || !payload.content) {
        showToast('Semua field penting harus diisi.', 'error');
        return;
    }

    try {
        let url = '/admin/education/article';
        let method = 'POST';

        if (educationModalMode === 'edit' && id) {
            url = `/admin/education/article/${id}`;
            method = 'PUT';
        }

        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.message || 'Gagal menyimpan materi');
        }

        showToast(
            educationModalMode === 'edit'
                ? 'Materi berhasil diperbarui'
                : 'Materi berhasil ditambahkan',
            'success'
        );

        closeEducationModal();
        await loadEducationArticles();
    } catch (err) {
        showToast(err.message, 'error');
    }
}

function bindEducationActionButtons() {
    document.querySelectorAll('.btn-edit-edu').forEach(btn => {
        btn.addEventListener('click', () => {
            openEducationModal('edit', {
                id: btn.dataset.id,
                title: btn.dataset.title,
                category: btn.dataset.category,
                summary: btn.dataset.summary,
                content: btn.dataset.content,
                status: btn.dataset.status,
                read_time: btn.dataset.readTime,
                image_url: btn.dataset.imageUrl
            });
        });
    });

    document.querySelectorAll('.btn-delete-edu').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.id;
            if (!confirm('Hapus artikel ini?')) return;

            try {
                const res = await fetch(`/admin/education/article/${id}`, {
                    method: 'DELETE'
                });

                const data = await res.json();
                if (!res.ok) {
                    throw new Error(data.message || 'Gagal menghapus artikel');
                }

                showToast('Artikel berhasil dihapus', 'success');
                await loadEducationArticles();
            } catch (err) {
                showToast(err.message, 'error');
            }
        });
    });
}

function initEducationFilters() {
    const filterBtn = document.getElementById('btn-filter-education');
    const filterMenu = document.getElementById('education-filter-menu');
    const searchInput = document.getElementById('education-search');

    if (filterBtn && filterMenu) {
        filterBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            filterMenu.classList.toggle('hidden');
        });

        document.addEventListener('click', function (e) {
            if (!filterMenu.contains(e.target) && !filterBtn.contains(e.target)) {
                filterMenu.classList.add('hidden');
            }
        });

        document.querySelectorAll('.education-menu-item').forEach(btn => {
            btn.addEventListener('click', function () {
                currentEducationFilter = btn.dataset.filter;
                filterMenu.classList.add('hidden');
                renderEducationArticles();
            });
        });
    }

    document.querySelectorAll('.edu-filter-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            currentEducationFilter = tab.dataset.filter;
            renderEducationArticles();
        });
    });

    if (searchInput) {
        searchInput.addEventListener('input', function () {
            const keyword = searchInput.value.trim().toLowerCase();
            const tbody = document.getElementById('education-article-list');
            const infoEl = document.getElementById('education-table-info');

            let rows = getBaseFilteredArticles();

            if (keyword) {
                rows = rows.filter(item =>
                    String(item.title || '').toLowerCase().includes(keyword) ||
                    String(item.category || '').toLowerCase().includes(keyword) ||
                    String(item.summary || '').toLowerCase().includes(keyword) ||
                    String(item.content || '').toLowerCase().includes(keyword)
                );
            }

            if (!rows.length) {
                if (tbody) {
                    tbody.innerHTML = `
                        <tr>
                            <td colspan="4" class="px-6 py-8 text-center text-slate-400">
                                Tidak ada artikel yang cocok.
                            </td>
                        </tr>
                    `;
                }
                if (infoEl) infoEl.textContent = 'Menampilkan 0 artikel';
                updateEducationFilterTabs();
                return;
            }

            renderEducationRows(rows, `Menampilkan 1-${rows.length} dari ${rows.length} artikel`);
            updateEducationFilterTabs();
        });
    }
}

// ============================================
// INIT ALL
// ============================================

document.addEventListener('DOMContentLoaded', function () {
    loadAdminSummary();
    loadAdminReports();
    loadCaseReviewDetail();

    initPhishingDecision();
    initEscalation();
    initMarkSafe();
    initSaveNote();

    initExport();
    initAnalyticsPage();

    loadEducationArticles();
    initEducationModal();
    initEducationFilters();

    const form = document.getElementById('education-form');
    if (form) {
        form.addEventListener('submit', saveEducationArticle);
    }

    updateEducationPreview();
});